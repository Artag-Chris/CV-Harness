# ADR-001 — Arquitectura del CV Harness

Estado: aceptado (2026-09-08)

## Contexto

Necesitamos un sistema que detecte vacantes (fuentes configurables en BD), las
evalúe contra el perfil canónico con IA y genere hojas de vida personalizadas,
todo **asíncrono por eventos** y fragmentado en módulos. Hay experiencia previa
exitosa con scraping en **Rust** y con harness NestJS hexagonales (`atiende`).

## Decisiones

1. **Orquestador NestJS 11** (`apps/api`) como monorepo junto a `apps/scraper`
   (Rust) y `apps/web` (Next.js). Patrones heredados de `atiende`: config Zod
   fail-fast, logger JSON, feature flags, workers por dominio.
2. **Transporte de eventos: Redis**.
   - BullMQ + jobs repeatable = el cron (`crawl-cycle`), dentro de Nest.
   - **Redis Streams** = frontera Nest↔Rust (`scraper:requests`,
     `scraper:results`) con grupos de consumo (`scraper`, `ingest`).
   - Sin nada síncrono: el endpoint de disparo manual solo publica el mensaje.
3. **Scraper en Rust** stateless: consume recetas de selectores CSS que llegan
   en el payload del stream (nunca lee la BD de Nest). Cada fuente configura
   límites y politeness. Resultado publicado de vuelta al stream.
4. **LLM: Groq en JSON mode**, detrás de un puerto (`LlmProvider.json`) que
   devuelve `null` en modo `mock` (sin `GROQ_API_KEY` el pipeline corre E2E con
   resultados determinísticos).
5. **Pipeline por etapas** (cada una su cola BullMQ): ingestión (dedup por
   fingerprint sha256 de la URL) → normalización → match (score 0-100 +
   "fórmula de aplicación") → generación de HV (si score ≥ umbral) →
   notificación (bandeja en BD para el dashboard).
6. **Notificación MVP = bandeja web**. Email (Resend) y Telegram quedan como
   adapters futuros del mismo concepto (`NotificationService.create`).

## Consecuencias

- Reprocesar resultados es idempotente (dedup por fingerprint).
- Los mensajes huérfanos se reclaman (`XAUTOCLAIM`) y se reprocesan.
- Cada fuente tiene cadencia propia (`intervalMinutes`) y el cron global
  despacha solo las vencidas.
- MVP en `mock` (sin red); con `GROQ_API_KEY` la calidad de extracción/match
  mejora sin tocar código.

## Notas operativas

- Host ports elegidos para no chocar con el stack de `atiende`: Postgres **5434**
  (atiende usa 5433), Redis **6380**, fixture nginx **8090**, API **3100**.
- En esta máquina el toolchain Rust MSVC no tenía `link.exe`; se usa
  `stable-x86_64-pc-windows-gnu` con Build Tools opcional. Ver README.
