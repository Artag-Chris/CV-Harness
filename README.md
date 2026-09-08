# CV Harness

Harness event-driven que detecta vacantes en bolsas de empleo (fuentes configurables), las evalúa contra tu perfil con IA y te genera una hoja de vida personalizada que cae como notificación en un dashboard web.

## Arquitectura

```
cron (BullMQ repeatable)
  └─ dispatcher → stream Redis scraper:requests
       └─ scraper Rust (worker XREADGROUP) → scrape por receta de selectores
            └─ stream Redis scraper:results
                 └─ Nest ingestion → Vacancy (dedup por fingerprint URL)
                      └─ cola normalize → Groq extrae campos estructurados
                           └─ cola match → Groq puntúa 0-100 + fórmula de aplicación
                                └─ si score ≥ umbral → cola resume → Groq redacta HV
                                     └─ cola notification → bandeja del dashboard web
```

- **apps/api** — NestJS 11: orquestador, cron, pipeline por eventos (BullMQ + Streams Redis), API REST.
- **apps/scraper** — Rust: motor de scraping genérico por receta de selectores (stateless).
- **Frontend** — no se levanta un web propio: la UI es la **pestaña "CV Harness"**
  del dashboard de atiende (proyecto hermano `dashboard/`), que corre en el 3001
  y apunta a la API de cv-harness (`NEXT_PUBLIC_CV_API_URL`).

## Levantar todo con un comando (docker compose)

Mismo patrón que `atiende`: red externa `microservices-network`, **Redis
compartida** (hostname `redis:6379`) y Postgres dedicado.

### En el server (la Redis compartida ya está corriendo)

```bash
cp .env.example .env     # completar GROQ_API_KEY / OPENAI_API_KEY y JWT_SECRET
docker compose up -d     # postgres + api + scraper
docker compose logs -f   # seguir logs
docker compose down
```

El frontend vive en el proyecto hermano `dashboard/` (Next.js): entrá por
`http://localhost:3001`, logueate en atiende y abrí la pestaña **CV Harness**,
donde conectás con el admin del harness (`admin@cvharness.local`).

En el primer boot el api corre `prisma migrate deploy` + el seed idempotente
(admin, perfil canónico y fuentes) y arranca con hot-reload.

### En una máquina sin la Redis compartida (dev local)

```bash
cp .env.example .env
docker compose --profile local-redis up -d          # levanta una redis llamada "redis"
docker compose --profile local-redis --profile fixture up -d   # + fixture E2E
```

> ⚠️ El profile `local-redis` crea un contenedor llamado `redis`. Si tu server
> ya tiene la Redis de atiende, NO uses ese profile ahí.

### Scripts raíz

```bash
npm run docker:up          # compose up -d (server)
npm run docker:up:local    # compose up -d --build + redis local + fixture
npm run docker:down
npm run docker:logs
npm run docker:ps
```

## Perfiles, hojas de vida y match semántico (pgvector)

- **Perfiles & CV** (`/cv/perfiles` en la pestaña CV Harness del dashboard de
  atiende): cargás la hoja de vida de cada
  perfil (PDF o texto/markdown), se trocea, la IA genera los embeddings
  (OpenAI `text-embedding-3-small`) y se guarda en **pgvector** (Postgres del
  stack, extensión `vector`). Una sola HV activa por perfil.
- **Cron por perfil**: cada perfil tiene su cadencia (`scheduleMinutes`). El
  `crawl-cycle` despacha TODAS las fuentes de ese perfil cada X minutos; o
  "Buscar ahora" desde el dashboard.
- **Fuentes por perfil**: se crean con plantilla (Computrabajo CO, fixture E2E)
  pegando la URL del listado y asignándolas a un perfil.
- **Match híbrido**: cada vacante se compara semánticamente (coseno en pgvector)
  contra la HV activa del perfil y el resultado se combina con el análisis de
  Groq: `final = 0.65 · IA + 0.35 · semántico`. El detalle en el dashboard
  muestra el desglose (Análisis IA · Similitud CV · Final).

Sin `OPENAI_API_KEY` los embeddings son mock determinísticos (flujo E2E
funciona, pero la calidad semántica real requiere la key, igual que atiende).

## Puertos (no chocan con el stack de atiende)

| Servicio | Host | |
|---|---|---|
| API cv-harness | 3100 | `/api/health` |
| Pestaña CV Harness (dashboard de atiende) | 3001 | `dashboard/` + `npm run dev` |
| PostgreSQL | 5434 | atiende usa 5433 |
| Redis local (solo profile `local-redis`) | 6380 | adentro siempre 6379 |
| Fixture E2E (solo profile `fixture`) | 8090 | `http://localhost:8090/jobs.html` |

## Credenciales por defecto (seed)

`admin@cvharness.local` / `admin1234` (cambiá `ADMIN_PASSWORD` y `JWT_SECRET` en `.env`).

## Redis compartida

El api acepta `REDIS_URL` directo o la deriva de `REDIS_HOST` / `REDIS_PORT` /
`REDIS_PASSWORD` (mismo patrón que atiende). Las colas usan `QUEUE_PREFIX`
(default `cvharness`) para no pisarse con `atiende:dev`. El worker Rust usa la
misma `REDIS_URL` (default en docker: `redis://redis:6379`).

## Modo LLM

- Sin `GROQ_API_KEY` el pipeline corre en **mock** (resultados determinísticos, sin red).
- Con `GROQ_API_KEY` usa Groq (`llama-3.3-70b-versatile`) para normalizar, matchear y redactar. `LLM_PROVIDER=mock|groq|auto`.

## Desarrollo nativo (sin docker)

```bash
# infra: docker compose --profile local-redis up -d
cd apps/api && npm install && npx prisma migrate dev && npm run seed && npm run start:dev
cd apps/scraper && cargo run
# frontend: en el repo dashboard/ (hermano)
cd ../dashboard && npm install && npm run dev   # http://localhost:3001 → pestaña CV Harness
```

## Verificación E2E (sin internet)

1. `npm run docker:up:local` (incluye el fixture en `http://localhost:8090/jobs.html`).
2. `POST /api/sources/:id/run` con la fuente sembrada "JobsDev Fixture", o esperar el `crawl-cycle`.
3. Seguir la cadena de eventos en `docker compose logs -f api`.
4. Ver la vacante con match score y el borrador de HV en la pestaña CV Harness
   del dashboard de atiende (`http://localhost:3001/cv`).

## Decisiones

- Transporte: BullMQ (jobs repeatable + colas) dentro de Nest; Streams Redis para Nest↔Rust. Nada síncrono.
- LLM: Groq en JSON mode vía adaptador (puerto `LLMProviderPort`, extensible).
- Notificación MVP: bandeja en BD consumida por el dashboard (polling). Email/Telegram en fase 2.
- Cumplimiento: cada fuente configura `respectRobots`; uso personal.
