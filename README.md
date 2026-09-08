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
- **apps/web** — Next.js: dashboard de vacantes, matches, borradores de HV y notificaciones.

## Levantar todo con un comando (docker compose)

Mismo patrón que `atiende`: red externa `microservices-network`, **Redis
compartida** (hostname `redis:6379`) y Postgres dedicado.

### En el server (la Redis compartida ya está corriendo)

```bash
cp .env.example .env     # completar GROQ_API_KEY y JWT_SECRET
docker compose up -d     # postgres + api + scraper + web
docker compose logs -f   # seguir logs
docker compose down
```

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

## Puertos (no chocan con el stack de atiende)

| Servicio | Host | |
|---|---|---|
| API cv-harness | 3100 | `/api/health` |
| Dashboard web | 3001 | |
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
cd apps/web && npm install && npm run dev
```

## Verificación E2E (sin internet)

1. `npm run docker:up:local` (incluye el fixture en `http://localhost:8090/jobs.html`).
2. `POST /api/sources/:id/run` con la fuente sembrada "JobsDev Fixture", o esperar el `crawl-cycle`.
3. Seguir la cadena de eventos en `docker compose logs -f api`.
4. Ver la vacante con match score y el borrador de HV en `http://localhost:3001`.

## Decisiones

- Transporte: BullMQ (jobs repeatable + colas) dentro de Nest; Streams Redis para Nest↔Rust. Nada síncrono.
- LLM: Groq en JSON mode vía adaptador (puerto `LLMProviderPort`, extensible).
- Notificación MVP: bandeja en BD consumida por el dashboard (polling). Email/Telegram en fase 2.
- Cumplimiento: cada fuente configura `respectRobots`; uso personal.
