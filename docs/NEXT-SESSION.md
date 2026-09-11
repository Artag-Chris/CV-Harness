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

## MAQUETACIÓN CORREGIDA + EDICIÓN TIPO CANVA (2026-09-11, 2ª ronda)
- **Solapamiento de texto (bug real)**: el cuerpo se desbordaba sobre la columna
  derecha. Causa: `textAlign: 'justify'` en react-pdf + columnas con `flexGrow`.
  El CV original va alineado a la izquierda, así que se quitó `justify` y las
  columnas pasaron a anchos explícitos (`62%` / `38%`).
- **Espacio en blanco (bug real, medido)**: la columna derecha terminaba en
  y=380 y la izquierda en y=791 → 411pt vacíos. Ahora la columna izquierda lleva
  perfil + experiencia + skills, y la derecha formación + idiomas + soft skills +
  QR: quedan **788 vs 776**. Además se pasó de 2 páginas fijas a **una sola en
  flujo continuo** (react-pdf pagina solo), con pie fijo y numeración; la página
  de continuación ya no arranca pegada al borde (padding de página + margen
  negativo en la banda oscura).
- **Cómo verificarlo sin abrir el navegador**: `pdftotext -bbox` da la caja de
  cada palabra; con eso se detectan solapamientos (intersección en X e Y) y se
  mide el balance de columnas. Cero solapamientos es el criterio de aceptación.
- **Edición tipo Canva**: `ResumeEditor` permite editar titular, resumen, y
  agregar/quitar/reordenar experiencia (con sus viñetas), proyectos, skills,
  soft skills y formación. Vista previa **en pop-out** (`PdfPreviewModal`) con el
  editor a la izquierda y el PDF en vivo a la derecha, antes de guardar.
- **La IA organiza el boceto**: `POST /resumes/:id/refine { instruction }`
  (`modules/resume-edit`). Reordena/acorta/reescribe el JSON completo respetando
  los hechos del perfil, re-renderiza el markdown y conserva la carta. Sin
  proveedor LLM devuelve `applied:false` con un aviso (no rompe).
- `PATCH /resumes/:id` ahora **también guarda la carta** si viene en el body
  (antes solo la preservaba): un solo Guardar persiste todo.

## TAB "PEGAR OFERTA" — HV DESDE TEXTO PEGADO (2026-09-11, 3ª ronda)
Para ofertas que no se pueden scrapear (LinkedIn, portales con login). Se pega el texto y entra
al **mismo pipeline** (`normalize → match → resume`), así que reusa el editor tipo Canva, el
pop-out y las descargas sin cambios.

- **Sin migración**: `Vacancy.sourceId` es NOT NULL, así que hay una `Source` sintética
  (`kind: 'MANUAL'`, `enabled: false`, `selectors: {}`) que el scheduler nunca despacha (solo
  toma `enabled`) y que `GET /sources` oculta. Una sola fila, reutilizada.
- **`POST /vacancies/from-text`** (`modules/manual`): crea o **reusa** la vacante y encola
  NORMALIZE. Dedup: con URL por `sha256(url)` (igual que el scraping); sin URL por
  `sha256('manual:' + texto)` (`fingerprintText`). El texto mínimo son 80 caracteres.
- **Vacante dirigida**: se guarda `vacancy.profileId` y `NormalizeService.targetProfileIds`
  devuelve **solo ese perfil** si está seteado. El scraping siempre crea `profileId: null`, así
  que su fan-out no cambia.
- **Carta automática**: la vacante manual viaja con `raw: { manual: true, autoCoverLetter: true }`
  y `ResumeService` encadena `CoverLetterService.generate` al crear la HV, en `try/catch` (un
  fallo de la carta no rompe la HV). El flujo scrapeado no cambia de costo.
- **Umbral respetado**: si el match no llega a `MATCH_MIN_SCORE` (65), NO se genera HV. Para ese
  caso hay una acción **explícita**: `POST /vacancies/:id/generate-resume?profileId=` encola la
  etapa RESUME igual (exige que exista el `MatchResult` y que el perfil no haya aplicado/ignorado).
  Está expuesta en la tab (tras un margen de gracia de 25 s, para no confundir "generándose" con
  "no alcanzó") y en el detalle de vacante.
- **UI**: tab `Pegar oferta` (`/cv/pegar`) con selector de perfil, textarea, datos opcionales
  (puesto/empresa/URL) y polling cada 4 s que **se detiene al aparecer la HV** (si no, el panel se
  remontaría y se perderían las ediciones sin guardar). Las pegadas se marcan con un chip
  "Manual" en Vacantes y en el detalle.
- **Tests**: +25 (`manual-intake`, `normalize-directed`, `resume-auto-letter`,
  `vacancies-generate-resume`) → **93 en total**. Verificado además el grafo de DI con arranque en
  seco (falla solo al conectar la BD, como corresponde sin Postgres).
- **Ojo al buscar una pegada en Vacantes**: el listado por defecto filtra "Solo buen match ≥70",
  así que una oferta manual con score menor aparece destildando ese filtro.

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
- La **última página** del CV puede quedar con espacio libre si el contenido no
  la llena: es propio de la cantidad de contenido, no un bug de maquetación. La
  página 1 se llena hasta el pie y lo que sobra fluye a la siguiente.

## Recordatorios de entorno
- `npm install` SIEMPRE con `--include=dev` (NODE_ENV=production poda devDeps).
- Tras reiniciar Docker Desktop hay que recrear los standalone:
  `docker run -d --name redis --network microservices-network redis:7-alpine` y
  el `cvharness-fixture` (nginx con `fixtures/www`).
- Migraciones: `npx prisma migrate deploy`; tras cambios de schema, regenerar
  client en el contenedor: `docker compose exec api npx prisma generate`.
- Puertos: api 3100 · dashboard 3001 · postgres 5434 · redis local 6380 · fixture 8090.
- Credenciales harness (CLI/scripts): `admin@cvharness.local` / `admin1234`.
