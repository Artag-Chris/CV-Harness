# Flujo de eventos

```
[t=0] BullMQ repeatable "crawl-cycle" (cada CRON_INTERVAL_MINUTES)
  └ CrawlWorker: DispatchService.runCycle()
       read Sources (enabled AND nextRunAt ≤ now)
       └ por fuente:
            ScrapeRun (RUNNING, requestId)
            XADD scraper:requests { requestId, sourceId, baseUrl, listUrl,
                                     recipe: { selectors, limits } }
            Source.lastRunAt = now · nextRunAt = now + intervalMinutes

[t=1] Scraper Rust (XREADGROUP scraper:requests, grupo "scraper")
       engine.run(): por página → selectores CSS → items
       (descripción corta → opcional fetchDetail)
       XADD scraper:results { requestId, sourceId, error?, items[] }

[t=2] Nest ResultsConsumer (XREADGROUP scraper:results, grupo "ingest")
       IngestionService.processResult()
         error? → ScrapeRun FAILED + notification SCRAPE_ERROR
         por item: fingerprint = sha256(url)
           ¿existe? → skip   ¿nuevo? → Vacancy(RAW) + job normalize
         ScrapeRun OK (itemsFound / itemsNew)   → XACK

[t=3] NormalizeWorker  (cola normalize)
       cleanDescription + LLM/Groq JSON → enrichment JSONB
       Vacancy → NORMALIZED → job match

[t=4] MatchWorker  (cola match)
       buildProfileSnapshot(perfil canónico) + vacante enriquecida
       LLM/Groq → { score, reasons, gaps, applicationStrategy,
                    coverLetterDraft }
       MatchResult upsert · Vacancy.MATCHED · matchScore
       score ≥ MATCH_MIN_SCORE (65) → job resume

[t=5] ResumeWorker  (cola resume)
       LLM/Groq → ResumeContent (secciones) + markdown renderizado
       ResumeDraft upsert · Vacancy.RESUME_READY → job notification

[t=6] NotificationWorker (cola notification)
       Notification en BD (bandeja) · el dashboard la lee por polling
```

### Puntos de falla y cómo se recuperan

| Falla | Recuperación |
|---|---|
| El worker Rust no responde | El mensaje queda en `scraper:requests` pendiente; otro ciclo con `lastRunAt` vencido reintenta. |
| Nest cae con resultados sin XACK | `XAUTOCLAIM` al boot reprocesa pendientes; dedup idempotente. |
| Error de scraping en Rust | Se publica `error` en el resultado; la corrida se marca FAILED y notifica `SCRAPE_ERROR`. |
| Error de LLM / schema inválido | Retry exponencial del job BullMQ (attempts 4). |
| Cola sin procesar | BullMQ mantiene jobs `waiting` hasta nuevo worker. |
