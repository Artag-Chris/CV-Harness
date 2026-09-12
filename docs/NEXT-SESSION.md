# Constancia — próxima sesión (continuar)

> Estado: 2026-09-12. Proyecto **cv-harness** + pestaña **CV Harness** en el
> front `dashboard/` (hermano de atiende).

## FILTROS DE VACANTES CON FACETS CANÓNICOS + README PORTAFOLIO (2026-09-12)
- **Problema**: `Vacancy.modality` era texto libre ("Híbrido / Remoto", "100%
  remoto", "on-site") y no había filtro; además el extractor determinístico
  clasificaba "Semi Senior" como "Senior" (bug real: `includes('senior')`
  ganaba antes que la comprobación de semisenior).
- **Taxonomía canónica** (`apps/api/src/common/job-facets.ts`): modalidad
  `REMOTE|HYBRID|ONSITE` (multi-valor: un aviso puede ofrecer varias) y
  seniority `TRAINEE|JUNIOR|SEMI_SENIOR|SENIOR|LEAD`. Se conserva el texto
  original en `modality` para mostrarlo. `SENIORITY_LABELS` para la UI.
- **Schema + migración** `20260912000000_vacancy_facets`: columnas
  `modalityTypes TEXT[] @default([])` y `seniorityLevel TEXT?`, índice btree de
  seniority + **GIN** (`@@index([modalityTypes], type: Gin)`), y **backfill** en
  SQL derivando los facets del texto ya guardado.
- **Pipeline**: ingestion setea `modalityTypes` desde el scrape; el normalizer
  setea `modalityTypes` + `seniorityLevel` desde la extracción (LLM o
  determinística) y ya usa `canonicalSeniority` (corrige el bug de semi senior).
- **API**: `GET /vacancies?modality=REMOTE,HYBRID&seniority=SENIOR&location=Bogotá`
  (modalidad inclusiva con `hasSome`; ubicación `contains` insensible).
- **Dashboard**: en Vacantes, selects de **Modalidad** y **Seniority** e input de
  **Ubicación**, más chips de modalidad/seniority por fila
  (`cv-ui.tsx`: `MODALITY_OPTIONS`, `SENIORITY_OPTIONS`, `ModalityChips`).
- **Tests**: +18 (`job-facets`, filtros en `vacancies.service`) → **141 en total**.
  `npx vitest run` verde; `nest build` ok; dashboard `tsc --noEmit` ok y
  `next build` ok (quedan los **4 errores de ESLint preexistentes** de React).
- **README**: reescrito como pieza de portafolio (problema, diagramas Mermaid de
  arquitectura y datos, features, decisiones de diseño, stack, comandos,
  filtros, API, verificación, roadmap).
- **Ojo para el server**: aplicar la migración nueva (`migrate deploy` corre en
  el boot) — el backfill de facets recalcula las vacantes ya guardadas.
- **Fix titular del PDF**: un titular largo se montaba sobre el bloque de
  contacto. Causa: react-pdf mide el ancho con el texto **sin** `textTransform`
  ni `letterSpacing`, así que "cabía" en el cálculo pero se dibujaba más ancho.
  Fix en `ResumeDocument.tsx` (`buildHeadline` + estilo `headline`): mayúsculas
  aplicadas al propio texto, sin tracking, y salto de línea en los separadores
  `| · •`. Verificado con `pdftotext -bbox`: con el estilo viejo el detector
  reporta **3 solapamientos** (`CALLING`/`Y`/`RAG` sobre `www.artagdev.com.co`);
  con el fix, **0**. `scripts/pdf-check.tsx` usa ahora el titular largo como
  regresión permanente. `ats:verify` y `tsc` siguen OK.

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

## MEDIDOR DE ATS + MODO ATS (2026-09-11, 4ª ronda)

**El bug más importante que apareció (y que no se veía a ojo)**: los títulos de sección
llevaban `letterSpacing: 1.7`, y el extractor de texto metía espacios DENTRO de la palabra:
`PROYECTOS` salía como `P R OY EC TO S` y `ACADEMIC BACKGROUND` troceado. Un ATS dejaba de
reconocer esas secciones. Se quitó el tracking de los títulos (afectaba a los DOS modos) y se
agregó un guardián para que no vuelva a pasar en silencio.

- **`npm run ats:verify -- <dir>`** (`dashboard/scripts/ats-verify.mjs`): extrae el texto de los
  PDF con `pdftotext` y comprueba que los 7 encabezados estándar del modo ATS salgan completos y
  **en orden lineal**, que ningún encabezado salga troceado, que el modo heredado conserve los
  suyos, y que el contacto sea reconocible por regex (email en minúsculas, sin `CEL:`).
  Si no hay poppler avisa y no rompe. **Probado contra la regresión real**: con el tracking
  puesto reporta 3 fallos; sin él, `ATS_OK`.

### API — medidor determinístico (`modules/ats`)
Sin IA y sin migración: es un cálculo reproducible y explicable (un ATS no negocia).
- `normalize.ts`: minúsculas, sin acentos, y conserva los caracteres significativos de
  tecnología (`.` de `node.js`, `/` de `ci/cd`, `+` de `c++`, `#` de `c#`). `significantTokens`
  descarta palabras vacías **y genéricas de requisito** (`experiencia`, `conocimiento`, `basic`…):
  si no, cualquier HV "cubriría" cualquier requisito. `ingles`/`english` NO son genéricas: son un
  requisito duro frecuente.
- `synonyms.ts`: alias explícitos (node≡nodejs, postgres≡postgresql, algorithms≡algoritmos…).
- `keywords.ts`: modo **estricto** — además del `enrichment` y del `applicationStrategy`, escanea
  el `descriptionRaw` con el `TECH_DICTIONARY` (ahora compartido en `common/tech-dictionary.ts`
  con el normalizador). Cobertura por frase con alias + tokens significativos + **parejas
  adyacentes compactadas**, para que `fullstack` encuentre "Full Stack".
- `analyzer.ts`: score 0-100 con 4 bloques — **keywords 45%**, estructura 20%, contacto 15%,
  formato 20%. `grade`: PASS ≥80 · RISK 60-79 · FAIL <60. La estructura separa secciones
  **núcleo** (summary/experience/skills/education) de las opcionales, para que una HV casi vacía
  no saque buena nota.
- **`content.atsMode` decide qué encabezados se esperan**: los encabezados viven en la plantilla
  PDF, no en el contenido, así que el medidor tiene que saber en qué modo se va a exportar.
- Endpoints: `POST /resumes/:id/ats` (acepta `content` sin guardar) y
  `POST /resumes/:id/ats/keywords` (propone integración con IA **sin guardar**: se revisa en la
  vista previa y se guarda a mano).

### Dashboard
- **Interruptor "Modo ATS"** en la pestaña ATS: una columna, encabezados estándar (en el idioma
  del contenido) y contacto limpio. Se guarda con el borrador (`content.atsMode`).
- **`AtsPanel`**: score con semáforo, las 4 barras, chips de keywords faltantes, qué puede leer
  mal, qué hacer, y "Ver el texto que lee el ATS" (para que el score no sea una caja negra).
- **Pestaña ATS en la tarjeta** de HV/Carta + badge `ATS <score>` en el encabezado. El pop-out
  sigue siendo CV/Carta.
- Los encabezados estándar están **duplicados a propósito** en la API y en el PDF (repos
  separados): `apps/api/src/modules/ats/headings.ts` y `dashboard/src/lib/pdf/headings.ts`.

**Tests**: +18 (`ats-normalize`, `ats-analyzer`, `ats-keywords-fix`) → **123 en total**. Fijan el
contrato, incluido que **el mismo contenido puntúe mejor en modo ATS** y que no se inventen
faltantes.

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
