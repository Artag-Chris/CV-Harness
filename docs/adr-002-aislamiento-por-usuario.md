# ADR-002 — Aislamiento por usuario (cada persona ve solo lo suyo)

Estado: **propuesto / diferido** — documentado 2026-09-11. **NO implementado.**

> Esta ADR es la base de diseño para cuando queramos que cada usuario de atiende vea
> únicamente sus perfiles. Hoy el harness comparte el JWT de atiende pero **no usa la
> identidad** para filtrar nada: cualquiera que entre al dashboard ve todo.

## Contexto

- El caso de uso aprobado es multiusuario: varias personas (perfiles) con sus HV,
  sus sitios y su cron, **sin mezclarse**.
- El siguiente paso natural es que cada persona entre con **su usuario de atiende**
  y vea solo lo suyo.
- Dato verificado en `atiende/src/modules/auth/auth.service.ts` → `buildTokens()`.
  El **access token** de atiende firma este payload:

  | Claim | Valor | Sirve para |
  | --- | --- | --- |
  | `sub` | `BusinessUser.id` (uuid) | **dueño del perfil** |
  | `email` | email del usuario | mostrar / auditar |
  | `businessId` | `Business.id` (uuid) | agrupar por organización (tenant) |
  | `role` | `ADMIN` \| `SUPER_ADMIN` | ver todo (solo `SUPER_ADMIN`) |

- **Hallazgo importante:** atiende solo tiene dos roles, `ADMIN` y `SUPER_ADMIN`
  (`enum BusinessUserRole`). Como todos los usuarios actuales son `ADMIN`, usar el rol
  como criterio de aislamiento *no aísla nada*: si "ADMIN ve todo", el aislamiento es
  inútil. Por eso el aislamiento debe ser **por usuario (`sub`)**, y solo
  `SUPER_ADMIN` conserva visión global.

## Decisión (cuando se implemente)

1. **La propiedad vive en `Profile`**: `Profile.ownerId = sub` (más `businessId` para
   multi-tenant opcional). Todo lo demás cuelga del perfil, así que se filtra por
   relación, no campo por campo.
2. **`Source` sigue siendo catálogo compartido** (recomendado): scrapear dos veces la
   misma URL es desperdicio y el dedupe por `fingerprint` ya reparte el resultado a
   todos los perfiles suscritos. Lo que es **por usuario** es la *selección*
   (`ProfileSource`) y todo lo derivado (matches, HV, borradores, notificaciones).
3. **Enforcement en 3 capas** (defensa en profundidad):
   - **Guard → contexto**: el guard ya valida el JWT; ahora además se exponen
     `businessId`/`role` y un `@CurrentUser()` para leerlos.
   - **Scoping en los services**: es la seguridad **real**. Todo query HTTP filtra por
     `profile.ownerId`. Un guard solo no alcanza (IDOR: `GET /vacancies/:id` de otro).
   - **RLS de Postgres** (opcional, fase 4): `SET LOCAL app.user_id` por request. Es la
     única capa que protege aunque alguien escriba un query sin filtro.
4. **Los jobs y el cron NO se filtran por usuario**: `crawl-cycle`, `dispatch`,
   `match.worker`, `resume.worker` son trabajo de sistema, sin request. El scoping es
   exclusivamente de la capa HTTP.

### Qué se filtra por qué

| Entidad | Se filtra por | Nota |
| --- | --- | --- |
| `Profile` | `ownerId = sub` | raíz de la propiedad |
| `Resume`, `ResumeDraft` | `profile.ownerId` | vía relación |
| `MatchResult`, `VacancyProfile` | `profile.ownerId` | el match es por perfil |
| `Vacancy` | tiene `VacancyProfile` de un perfil mío **o** su `source` está en mis selecciones | ver decisión abierta #1 |
| `Source` | mis selecciones (`ProfileSource`) | el catálogo no es mío |
| `ScrapeRun` | `source` en mis selecciones | cuelga de `Source` compartido |
| `Notification` | `profileId` (campo nuevo) | hoy es global |

## Modelo de datos (propuesto — NO aplicado)

```prisma
model Profile {
  // ...campos actuales...
  /// BusinessUser.id de atiende (claim `sub`). null = legado/compartido.
  ownerId    String?
  /// Business.id de atiende (claim `businessId`), para agrupar por organización.
  businessId String?

  @@index([ownerId])
  @@index([businessId])
}

model Notification {
  // ...campos actuales...
  /// Perfil destinatario; null = aviso global del sistema.
  profileId String?
  @@index([profileId])
}
```

Migración (aditiva, sin downtime — columnas *nullable*, los datos viejos siguen válidos):

```sql
ALTER TABLE "Profile"      ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Profile"      ADD COLUMN "businessId" TEXT;
CREATE INDEX "Profile_ownerId_idx"    ON "Profile"("ownerId");
CREATE INDEX "Profile_businessId_idx" ON "Profile"("businessId");
ALTER TABLE "Notification" ADD COLUMN "profileId" TEXT;
CREATE INDEX "Notification_profileId_idx" ON "Notification"("profileId");

-- Backfill: reclamar los perfiles existentes para el admin actual.
UPDATE "Profile" SET "ownerId" = '<uuid-del-admin>' WHERE "ownerId" IS NULL;
```

## Cambios por capa (snippets listos — NO aplicados)

**1. Contexto de identidad** (`apps/api/src/modules/auth/`)

```ts
// auth.guard.ts — refleja los claims reales de atiende (aditivo, no rompe nada).
export interface AuthPayload {
  sub: string;
  email: string;
  businessId?: string;
  role?: 'ADMIN' | 'SUPER_ADMIN';
}

// current-user.decorator.ts (nuevo)
export const CurrentUser = createParamDecorator(
  (_d: unknown, ctx: ExecutionContext): AuthPayload | undefined =>
    ctx.switchToHttp().getRequest<{ auth?: AuthPayload }>().auth,
);
```

**2. Servicio de alcance** (el corazón del diseño — un solo lugar decide qué ve quién)

```ts
@Injectable()
export class AccessScope {
  constructor(private readonly prisma: PrismaService) {}

  isGlobal(user?: AuthPayload): boolean {
    return user?.role === 'SUPER_ADMIN';
  }

  /** Filtro Prisma para Profile (reutilizable vía relación en todo lo demás). */
  profileWhere(user?: AuthPayload): Prisma.ProfileWhereInput {
    if (!user) return { id: '__sin_sesion__' }; // fail-closed
    return this.isGlobal(user) ? {} : { ownerId: user.sub };
  }

  /** Perfiles que puede tocar el usuario (para validar :profileId de una ruta). */
  async assertOwnsProfile(user: AuthPayload | undefined, profileId: string): Promise<void> {
    const found = await this.prisma.profile.findFirst({
      where: { id: profileId, ...this.profileWhere(user) },
      select: { id: true },
    });
    if (!found) throw new NotFoundException(`Profile ${profileId} no existe`);
  }
}
```

**3. Uso en los services** (patrón único; `profileWhere` se compone por relación)

```ts
// Listar solo mis matches, sin tocar el query de negocio.
const matches = await this.prisma.matchResult.findMany({
  where: { profile: this.access.profileWhere(user) },
});

// Detalle: cerrar el IDOR — el id solo no basta.
const vacancy = await this.prisma.vacancy.findFirst({
  where: {
    id,
    vacancyProfiles: { some: { profile: this.access.profileWhere(user) } },
  },
});

// Crear: sellar la propiedad.
await this.prisma.profile.create({
  data: { ...input, ownerId: user.sub, businessId: user.businessId },
});
```

**4. Rutas a tocar** (todas las que devuelven datos de usuario)

| Ruta | Acción |
| --- | --- |
| `GET /profiles` | filtrar `ownerId` |
| `POST /profiles` | sellar `ownerId` + `businessId` |
| `GET /profiles/:id`, `/profiles/primary` | `assertOwnsProfile` (404 si no es mío) |
| `PUT /profiles/:id/sources`, `PATCH/DELETE /profiles/:p/sources/:s` | `assertOwnsProfile` |
| `PATCH /profiles/:id/schedule`, `POST /profiles/:id/run` | `assertOwnsProfile` |
| `GET /sources` | solo mis seleccionadas (o catálogo público) — ver decisión #1 |
| `POST/PATCH/DELETE /sources/:id` | política a decidir (decisión #1) |
| `GET /vacancies`, `GET /vacancies/:id` | vía `VacancyProfile` mío |
| `POST /vacancies/:id/status` | resolver el perfil mío, no el body |
| `GET/POST/DELETE /resumes*` | vía `profile.ownerId` |
| `GET/PATCH /notifications` | vía `Notification.profileId` |
| `GET /sources/templates`, `GET /health` | global (no es dato de usuario) |

## Fases de implementación (cuando toque)

| Fase | Qué | Riesgo |
| --- | --- | --- |
| 0 | **Esta ADR.** Nada de código. | ninguno |
| 1 | Schema aditivo (`ownerId`, `businessId`, `Notification.profileId`) + backfill | bajo: columnas nullable |
| 2 | Plomería de contexto (`AuthPayload`, `@CurrentUser`) **sin** filtrar todavía | bajo: no cambia comportamiento |
| 3 | **Aplicar el scoping** en las rutas de la tabla | **alto: es el cambio que rompe**; una release deliberada |
| 4 | RLS de Postgres + quotas/notificaciones por usuario | medio |

> En fase 3 decidir la política para `ownerId = null`: (a) tratar null como
> público/legado, o (b) reclamarlo para el admin con backfill. Recomendado (b), y
> dejar (a) solo durante la transición.

## Decisiones abiertas (requieren tu OK el día que se implemente)

1. **¿`Source` es catálogo compartido o dato privado?** Compartido ahorra scraping y es
   lo recomendado; privado implica que `GET /sources` y `POST/PATCH/DELETE` se filtren por
   dueño. Con catálogo compartido, alguien podría ver URLs guardadas por otro.
2. **¿`SUPER_ADMIN` ve todo?** Hoy no existe esa distinción en la práctica (todos ADMIN).
3. **¿Notificaciones por perfil?** Requiere el `profileId` nuevo y reasignar las viejas.
4. **¿Borramos el login propio del harness?** `AdminUser` + `POST /auth/login` quedaron
   legados al compartir el JWT de atiende; conviene eliminarlos para no dejar una puerta
   extra.
5. **¿Compartir un perfil entre usuarios?** Si alguna vez hace falta (ej. un coach viendo
   el perfil de otra persona), sería una tabla `ProfileShare` en vez de reabrir `ownerId`.

## Consecuencias

- Aislamiento correcto solo si el filtro se aplica en **todas** las rutas de la tabla;
  por eso el helper central (`AccessScope`) y no filtros sueltos.
- `ownerId` apunta a un id de **atiende**, no del harness: si un usuario se borra allá,
  sus perfiles quedan huérfanos. Decidir `onDelete` (no hay FK cross-database).
- Los jobs siguen siendo globales: el trabajo es el mismo para todos y el reparto ya lo
  hace el fan-out N:M.
- Sin cambios en el front: el dashboard ya manda el token de atiende; al filtrar, cada
  quien simplemente verá menos.
