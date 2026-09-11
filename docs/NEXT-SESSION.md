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

## HV Y CARTA EN PDF (2026-09-11)
- **Generación en el NAVEGADOR** (`@react-pdf/renderer`), no en el API: el mismo
  motor sirve para la vista previa y para la descarga, y el PDF sale con texto
  seleccionable (compatible con ATS). No hizo falta Chromium ni tocar Docker.
- Plantilla calcada del CV original `Christian_resume.pdf`: banda de cabecera
  `#413C40`, dos columnas, títulos en mayúscula con línea fina `#A3ABB8`, QR al
  portafolio (`Profile.links` tipo `website`) y páginas extra para proyectos.
  Fuentes descargadas del PDF original: Questrial (nombre/títulos), Raleway
  (cuerpo, 400/700) y Roboto (contacto) — viven en `dashboard/public/fonts/`.
- **Carta de presentación**: `POST /resumes/:id/cover-letter` la genera completa
  con el LLM (o determinística si no hay proveedor); `PATCH` guarda la edición
  manual. Se guarda DENTRO del `content` del `ResumeDraft` → sin migración.
  Regla: `PATCH /resumes/:id` y la regeneración del pipeline **preservan** la
  carta (antes el zod la descartaba al re-renderizar el markdown).
- UI: panel en el detalle de vacante con pestañas HV/Carta, vista previa en vivo,
  resumen editable y descarga de ambos PDF.
- **Verificación sin navegador**: `npm run pdf:check` (en `dashboard/`) renderiza
  ambos PDF con datos de ejemplo. Sirve para comprobar con poppler
  (`pdffonts`) que **todas** las fuentes queden embebidas y que el texto sea
  extraíble. Detectó y se corrigieron: solapamiento del titular con el contacto,
  fuente **Helvetica no embebida** por un `\n` dentro de un `<Text>` (lo resuelve
  `PdfText.tsx`) y caracteres sin glifo (los convierte `sanitize.ts`).

## PENDIENTES / PRÓXIMO
1. ~~**Backfill al activar un CV**~~ **HECHO** (2026-09-11): `ProfileBackfillService`
   re-encola match por (vacante, perfil) de las vacantes ya guardadas sin
   `VacancyProfile` de ese perfil. Se dispara al tildar un sitio
   (`PATCH/PUT /profiles/:id/sources`), al activar una HV ya indexada
   (`POST /resumes/:id/activate`) y al terminar de indexarla
   (`resume-index.worker`). Manual: `POST /profiles/:id/backfill`. Tope de 200
   por corrida (cada match es una llamada de IA) y reporta `remaining`.
2. Cadencia por sitio: usar `ProfileSource.intervalMinutes` en el dispatch
   (campo ya existe; hoy manda `Profile.scheduleMinutes`) + UI opcional.
3. En el server: copiar `JWT_SECRET` de atiende al `.env` del harness y subir
   `FIXTURE_ENABLED=false`, `OPENAI_API_KEY`, `GROQ_API_KEY`, `ADMIN_PASSWORD`.
4. ~~Detalle de vacante (UI): mostrar el bloque `profiles[]`~~ **HECHO**
   (2026-09-11): el detalle tiene selector de perfil, muestra SU match/HV/estado
   y el listado filtra por perfil (`GET /vacancies?profileId=`, también en
   `GET /vacancies/:id?profileId=`). El estado aplicada/ignorada ya viaja con
   `profileId` (antes con varios perfiles el API devolvía 404 al marcarla).
5. Roadmap largo (auditoría): DLQ, feature flags `FEATURE_*`, router LLM con
   fallback + presupuesto, notificación Email/Telegram, fuentes RSS/JSON/LinkedIn,
   tests de pipeline, graceful shutdown del scraper.
6. **Aislamiento por usuario (NO implementado, solo diseñado)**: ver
   `docs/adr-002-aislamiento-por-usuario.md`. Hoy varios perfiles conviven y todos
   los ve quien entre al dashboard; el plan es asociar `Profile.ownerId` al `sub`
   del JWT de atiende para que cada persona vea solo lo suyo. La ADR trae las 4
   fases, la migración aditiva, los snippets y las decisiones abiertas (la
   principal: si `Source` sigue siendo catálogo compartido). No arrancar sin OK
   explícito: la fase 3 es la que rompe.

## Deuda conocida (preexistente, no bloquea)
- ESLint del dashboard tiene 4 errores de las reglas nuevas de React
  (`set-state-in-effect` en `cv/layout.tsx`, detalle de vacante y `usePoll.ts`;
  `refs-during-render` en `usePoll.ts`). No se tocaron: son previos y el build de
  Next pasa igual.
- `npm audit` del dashboard reporta vulnerabilidades en `next`, `postcss`,
  `sharp` (preexistentes) y `nanoid` (llega con `@react-pdf/renderer`). No se
  tocaron: subir `next` es un cambio aparte.

## Recordatorios de entorno
- `npm install` SIEMPRE con `--include=dev` (NODE_ENV=production poda devDeps).
- Tras reiniciar Docker Desktop hay que recrear los standalone:
  `docker run -d --name redis --network microservices-network redis:7-alpine` y
  el `cvharness-fixture` (nginx con `fixtures/www`).
- Migraciones: `npx prisma migrate deploy`; tras cambios de schema, regenerar
  client en el contenedor: `docker compose exec api npx prisma generate`.
- Puertos: api 3100 · dashboard 3001 · postgres 5434 · redis local 6380 · fixture 8090.
- Credenciales harness (CLI/scripts): `admin@cvharness.local` / `admin1234`.
