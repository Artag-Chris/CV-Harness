# Constancia — próxima sesión (continuar)

> Estado: 2026-09-09. Proyecto **cv-harness** + pestaña **CV Harness** en el
> front `dashboard/` (hermano de atiende).

## LO ÚLTIMO HECHO (verificado en docker, 2026-09-09)
- **Auth sin 2do login**: la pestaña CV usa la sesión de atiende (`atiende_auth`);
  el harness valida el **mismo JWT** (en el server hay que compartir el
  `JWT_SECRET` de atiende en `cv-harness/.env`). Se eliminó `CvLogin` y la key
  `cvh_auth`; `cv-api.ts` lee el token de atiende.
- **Sitios guardados reutilizables + selección por perfil (N:M)**:
  - Tabla `ProfileSource(profileId, sourceId, enabled, intervalMinutes?)`;
    `Source` ya no tiene `profileId` (dropeada en migración).
  - API: `POST /profiles`, `PUT /profiles/:id/sources {sourceIds}`,
    `PATCH/DELETE /profiles/:profileId/sources/:sourceId`,
    `GET /profiles/:id` → `sources[].source`, `GET /sources` → `selections`.
  - UI: en `Perfiles & CV` se eligen con checkbox los sitios guardados; en
    `Fuentes` se guarda el sitio (plantilla+URL) sin perfil y luego se asigna.
  - Cron por perfil: `crawl-cycle` recorre las selecciones habilitadas del
    perfil cada `scheduleMinutes`; “Buscar ahora”/`runProfile` idem.
- **Vacante↔Perfil N:M** (migración `20260909000000_profiles_sites_vacancy_nm`):
  - `VacancyProfile(vacancyId, profileId, status PENDING|MATCHED|RESUME_READY|
    APPLIED|IGNORED)`; `MatchResult`/`ResumeDraft` con unique compuesto
    `(vacancyId, profileId)`; backfill de datos viejos incluido.
  - Fan-out en normalizer (1 job match por perfil), matcher/resume por perfil,
    agregado global (`vacancies/aggregate.ts`) para `status`/`matchScore`.
  - `POST /vacancies/:id/status` aplica/ignora **por perfil**.
  - E2E verificado: 3 vacantes × 2 perfiles → 2 MatchResults por vacante, HV
    propia por perfil y agregados correctos en el listado.
- Swagger `/api/docs` + DTOs y `schemaVersion` en streams (sesión anterior).

## PENDIENTES / PRÓXIMO
1. **Backfill al activar un CV**: hoy activar CV no re-matchea vacantes viejas
   del perfil (el E2E usó vacantes nuevas). Hacer: al activar, encolar match de
   ese perfil por cada vacante NORMALIZED+ de sus sitios sin `VacancyProfile`
   del perfil (jobId único `match-{vacancy}-{profile}`, patrón ya usado en
   `normalize.service.ts`).
2. Cadencia por sitio: usar `ProfileSource.intervalMinutes` en el dispatch
   (campo ya existe; hoy manda `Profile.scheduleMinutes`) + UI opcional.
3. En el server: copiar `JWT_SECRET` de atiende al `.env` del harness y subir
   `FIXTURE_ENABLED=false`, `OPENAI_API_KEY`, `GROQ_API_KEY`, `ADMIN_PASSWORD`.
4. Detalle de vacante (UI): mostrar el bloque `profiles[]` (ya viaja en la API)
   con sus estados/acciones por perfil; actualizar `cv-types.ts`.
5. Roadmap largo (auditoría): DLQ, feature flags `FEATURE_*`, router LLM con
   fallback + presupuesto, notificación Email/Telegram, fuentes RSS/JSON/LinkedIn,
   tests de pipeline, graceful shutdown del scraper.

## Recordatorios de entorno
- `npm install` SIEMPRE con `--include=dev` (NODE_ENV=production poda devDeps).
- Tras reiniciar Docker Desktop hay que recrear los standalone:
  `docker run -d --name redis --network microservices-network redis:7-alpine` y
  el `cvharness-fixture` (nginx con `fixtures/www`).
- Migraciones: `npx prisma migrate deploy`; tras cambios de schema, regenerar
  client en el contenedor: `docker compose exec api npx prisma generate`.
- Puertos: api 3100 · dashboard 3001 · postgres 5434 · redis local 6380 · fixture 8090.
- Credenciales harness (CLI/scripts): `admin@cvharness.local` / `admin1234`.
