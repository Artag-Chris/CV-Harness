# Constancia — próxima sesión (continuar mañana)

> Estado: 2026-09-08. Proyecto **cv-harness** + pestaña **CV Harness** en el
> front `dashboard/` (hermano de atiende).

## Lo que se terminó hoy (funciona y verificado)
- Pipeline event-driven completo: cron → scraper Rust (recetas HTML) → ingestión
  con dedup → normalización (Groq/mock) → **match híbrido** (semántico pgvector +
  IA, `final = 0.65·IA + 0.35·semántico`) → borrador de HV → notificaciones.
- **CV por perfil**: upload PDF o texto/markdown desde el dashboard, embeddings
  OpenAI (`text-embedding-3-small`) o mock, guardados en **pgvector**
  (Postgres ahora es `pgvector/pgvector:pg16`, extensión `vector` creada).
- **Cron por perfil** (`Profile.scheduleMinutes`) + "Buscar ahora".
- **Fuentes por perfil con plantillas** (computrabajo-co, jobsdev-fixture).
- **Frontend**: la UI es la **pestaña "CV Harness"** en `dashboard/`
  (proyecto hermano), puerto 3001 del host; cv-harness ya NO levanta `apps/web`.
- **Parte 2 de la ampliación (completa y verificada)**:
  - Swagger/OpenAPI en `/api/docs` y `/api/docs-json` (OpenAPI 3.0.0, DTOs en
    `apps/api/src/common/api-dto.ts`).
  - Contratos de eventos versionados: `schemaVersion: "1"` en
    `scraper:requests` y `scraper:results` (Nest y Rust).

## LO PRIMERO MAÑANA: Parte 1 — N:M vacante ↔ perfil (no empezada)
Diseño ya decidido (no tocar sin revisarlo):
1. **Schema** (`apps/api/prisma/schema.prisma`):
   - Nueva tabla `VacancyProfile(vacancyId, profileId, status PENDING|MATCHED|
     RESUME_READY|APPLIED|IGNORED, appliedAt?)` con `@@unique(vacancyId, profileId)`
     y FKs a `Vacancy`/`Profile` (onDelete Cascade).
   - `MatchResult`: quitar `vacancyId @unique` → **unique compuesto
     `@@unique([vacancyId, profileId])`** + columna `profileId` + FKs.
   - `ResumeDraft`: idem → **unique compuesto `(vacancyId, profileId)`**.
   - `Profile`/`Vacancy`: relaciones nuevas (`vacancyProfiles`, `matches`, `drafts`).
2. **Migración + backfill** (método a usar): generar la carpeta con
   `npx prisma migrate dev --create-only --name vacancy_profile_nm` y **pisar el
   migration.sql con SQL manual ordenado**: crear enum/tabla → quitar unique
   viejos → agregar columnas → `UPDATE "MatchResult" SET "profileId" = v."profileId"
   FROM "Vacancy" v ...` → insertar `VacancyProfile` por cada match/resume
   existente (status derivado de `Vacancy.status`: APPLIED→APPLIED,
   IGNORED→IGNORED, RESUME_READY→RESUME_READY, con match→MATCHED, resto PENDING)
   → constraints/FKs/unique. Aplicar con `prisma migrate dev` y regenerar client.
3. **Pipeline** (archivos a tocar):
   - `ingestion`/`normalizer/normalize.service.ts`: al pasar a `NORMALIZED`,
     crear `VacancyProfile` para los perfiles objetivo (owner de la fuente +
     perfiles con CV activo READY; si no hay ninguno → perfil primario) y
     **encolar un job de match por perfil** `{ vacancyId, profileId }`.
   - `matcher/match.service.ts` + `match.worker.ts`: recibir `profileId` en el job;
     snapshot del perfil correcto; semantic search contra **su** CV; upsert
     `MatchResult` compuesto y `VacancyProfile.status = MATCHED`.
   - `resume/resume.service.ts`: upsert `ResumeDraft` por
     `(vacancyId, profileId)`; marcar `VacancyProfile = RESUME_READY`;
     notificación con nombre del perfil.
   - Función **agregado por vacante** (status global = mejor VP; `matchScore` =
     max de scores) para mantener `list`/dashboard sin romper.
   - `vacancies.service.setStatus`: aplicar/ignorar **por perfil**
     (`profileId` en el body; ya está preparado el parámetro).
   - **Backfill al activar CV** (`resumes.service.activate`): encolar match de ese
     perfil para vacantes NORMALIZED+ sin VP, con jobId único por (vacancia, perfil).
4. **Frontend** `dashboard/src/app/(dashboard)/cv/`: el detalle debe mostrar
   **matches agrupados por perfil** (cards por perfil) y acciones APPLIED/IGNORED
   por perfil; listado puede seguir con el score agregado. Actualizar
   `src/lib/cv-types.ts` (shape de `VacancyDetail`).
5. Verificación: `tsc`, `vitest`, correr en docker **con 2 perfiles** (crear 2do
   perfil + CV) y comprobar que una misma vacante tenga 2 `MatchResult`.

## Roadmap futuro (de la auditoría, priorizado)
- [ ] Backfill re-match al activar CV (va dentro de Parte 1).
- [ ] `@nestjs/swagger` → generar **cliente tipado** para el dashboard (hoy
      `cv-types.ts` es manual → drift).
- [ ] Feature flags `FEATURE_*` + pesos de blend/verdicts por env.
- [ ] Router LLM con fallback + circuit breaker + presupuesto USD (patrón atiende).
- [ ] DLQ (dead-letter) + ids de correlación en todo el pipeline.
- [ ] Tabla de transiciones de estado/auditoría.
- [ ] Hardenear HTTP: helmet, throttle en login, CORS por whitelist.
- [ ] Graceful shutdown en el scraper Rust; healthchecks de scraper.
- [ ] Notificación multicanal (Email/Telegram) detrás de un puerto formal.
- [ ] Fuentes RSS/JSON/LinkedIn (`Source.kind` enum) + proxies/anti-bot.

## Cómo levantar y verificar (recordatorio)
```bash
# cv-harness (raíz)
docker compose up -d                     # postgres(5434) + api(3100) + scraper
docker compose --profile local-redis up -d          # + redis local si no hay compartida
docker compose --profile local-redis --profile fixture up -d  # + fixture E2E(8090)
docker compose logs -f api
# dashboard (front hermano, puerto 3001)
cd ../dashboard && npm run dev
# docs API: http://localhost:3100/api/docs
```
- Credenciales harness: `admin@cvharness.local` / `admin1234` (cambiar en server).
- Tests: `apps/api`: `tsc --noEmit` + `npm test`; `apps/scraper`: `cargo test`.
- En esta máquina `NODE_ENV=production` está seteado en el entorno: **todo
  `npm install` debe ir con `--include=dev`** o poda las devDependencies.
- Rust usa toolchain MSVC (Build Tools instalado); si faltara `link.exe`, ver
  `.cargo` config GNU comentado en README.

## URLs y puertos (no chocan con atiende)
| Servicio | Host |
|---|---|
| API cv-harness | 3100 |
| Dashboard (pestaña CV Harness) | 3001 (atiende) |
| PostgreSQL cv-harness | 5434 (atiende usa 5433) |
| Redis local (solo profile local-redis) | 6380 |
| Fixture E2E | 8090 |

Plan original aprobado: `~/.commandcode/plans/cv-harness-vacantes-resumes.md`.
