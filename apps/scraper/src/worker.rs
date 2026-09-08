//! Worker: consume `scraper:requests` (XREADGROUP), ejecuta el motor y
//! publica el resultado en `scraper:results`. Sin dependencia de Nest/BD.

use redis::{cmd, Client};
use serde_json::json;
use std::time::Duration;
use tracing::{error, info, warn};

use crate::engine;
use crate::recipe::{ScrapeRequest, ScrapeResults};

pub struct WorkerConfig {
    pub redis_url: String,
    pub stream_requests: String,
    pub stream_results: String,
    pub group: String,
    pub consumer: String,
    pub poll_ms: u64,
}

impl WorkerConfig {
    pub fn from_env() -> Self {
        Self {
            redis_url: std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://localhost:6380".into()),
            stream_requests: std::env::var("STREAM_REQUESTS")
                .unwrap_or_else(|_| "scraper:requests".into()),
            stream_results: std::env::var("STREAM_RESULTS")
                .unwrap_or_else(|_| "scraper:results".into()),
            group: std::env::var("STREAM_GROUP").unwrap_or_else(|_| "scraper".into()),
            consumer: format!("rust-{}", std::process::id()),
            poll_ms: std::env::var("POLL_MS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(1000),
        }
    }
}

type RawMessage = (String, Vec<(String, String)>);

pub async fn run(cfg: WorkerConfig) -> anyhow::Result<()> {
    let client_redis = Client::open(cfg.redis_url.as_str())?;
    let mut con = client_redis.get_multiplexed_tokio_connection().await?;
    ensure_group(&mut con, &cfg, &cfg.stream_requests).await;
    // El grupo de resultados normalmente lo crea Nest (ingest); aseguramos por robustez.
    ensure_group(&mut con, &cfg, &cfg.stream_results).await;

    let http = reqwest::Client::builder().build()?;

    info!(
        stream = %cfg.stream_requests,
        group = %cfg.group,
        consumer = %cfg.consumer,
        "worker rust escuchando"
    );

    let mut idle_cycles: u64 = 0;
    loop {
        // XREADGROUP sin BLOCK + poll corto: evita dependencias de bloqueo del reactor.
        let result: redis::RedisResult<Option<Vec<(String, Vec<RawMessage>)>>> =
            cmd("XREADGROUP")
                .arg("GROUP")
                .arg(&cfg.group)
                .arg(&cfg.consumer)
                .arg("COUNT")
                .arg(8)
                .arg("STREAMS")
                .arg(&cfg.stream_requests)
                .arg(">")
                .query_async(&mut con)
                .await;

        match result {
            Ok(Some(streams)) => {
                idle_cycles = 0;
                for (_stream, messages) in streams {
                    for (msg_id, fields) in messages {
                        handle_message(&http, &cfg, &mut con, &msg_id, &fields).await;
                    }
                }
            }
            Ok(None) => {
                // Periódicamente, reclamar mensajes huérfanos (worker murió entre
                // XREAD y XACK) para garantizar at-least-once.
                idle_cycles += 1;
                if idle_cycles >= 30 {
                    idle_cycles = 0;
                    claim_orphans(&http, &cfg, &mut con).await;
                }
                tokio::time::sleep(Duration::from_millis(cfg.poll_ms)).await;
            }
            Err(e) => {
                error!(error = %e, "error en XREADGROUP; reintentando");
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        }
    }
}

/// Reclama entradas pendientes del propio grupo que llevan > 120 s sin
/// confirmar (XACK) y las reprocesa. La dedup por fingerprint en Nest hace
/// que re-publicar sea idempotente.
async fn claim_orphans(
    http: &reqwest::Client,
    cfg: &WorkerConfig,
    con: &mut redis::aio::MultiplexedConnection,
) {
    let result: redis::RedisResult<redis::Value> = cmd("XAUTOCLAIM")
        .arg(&cfg.stream_requests)
        .arg(&cfg.group)
        .arg(&cfg.consumer)
        .arg(120_000)
        .arg("0-0")
        .arg("COUNT")
        .arg(20)
        .query_async(con)
        .await;
    let Ok(redis::Value::Array(result)) = result else { return };
    // XAUTOCLAIM → [nextId, entradas, idsBorrados]; entradas: [id, [k,v,k,v…]]
    let Some(redis::Value::Array(entries)) = result.get(1) else { return };
    if entries.is_empty() {
        return;
    }
    let mut reclaimed = 0usize;
    for item in entries {
        let redis::Value::Array(pair) = item else { continue };
        let id = redis_to_string(pair.first());
        let fields = flat_to_pairs(pair.get(1));
        if id.is_empty() {
            continue;
        }
        handle_message(http, cfg, con, &id, &fields).await;
        reclaimed += 1;
    }
    info!(reclaimed, "entradas huérfanas reprocesadas");
}

fn redis_to_string(value: Option<&redis::Value>) -> String {
    match value {
        Some(redis::Value::BulkString(data)) => String::from_utf8_lossy(data).into_owned(),
        Some(redis::Value::Int(i)) => i.to_string(),
        _ => String::new(),
    }
}

/// Convierte una lista plana [k1,v1,k2,v2,…] en pares [(k1,v1),(k2,v2),…].
fn flat_to_pairs(value: Option<&redis::Value>) -> Vec<(String, String)> {
    let Some(redis::Value::Array(items)) = value else { return vec![] };
    let mut pairs = Vec::with_capacity(items.len() / 2);
    let mut iter = items.iter();
    while let (Some(k), Some(v)) = (iter.next(), iter.next()) {
        pairs.push((redis_to_string(Some(k)), redis_to_string(Some(v))));
    }
    pairs
}

async fn handle_message(
    http: &reqwest::Client,
    cfg: &WorkerConfig,
    con: &mut redis::aio::MultiplexedConnection,
    msg_id: &str,
    fields: &[(String, String)],
) {
    let payload = fields.iter().find(|(k, _)| k == "payload").map(|(_, v)| v.as_str());

    let Some(payload) = payload else {
        ack(con, cfg, msg_id).await;
        return;
    };

    let parsed: Option<ScrapeRequest> = serde_json::from_str(payload).ok();
    let Some(req) = parsed else {
        warn!(%msg_id, "payload no parseable; XACK sin procesar");
        ack(con, cfg, msg_id).await;
        return;
    };

    info!(
        request_id = %req.request_id,
        source = ?req.source_name,
        url = %req.list_url,
        "procesando request de scraping"
    );

    let outcome = match engine::run(&req, http).await {
        Ok(items) => ScrapeResults {
            request_id: req.request_id.clone(),
            source_id: req.source_id.clone(),
            error: None,
            items,
        },
        Err(message) => {
            error!(request_id = %req.request_id, error = %message, "scraping falló");
            ScrapeResults {
                request_id: req.request_id.clone(),
                source_id: req.source_id.clone(),
                error: Some(message),
                items: vec![],
            }
        }
    };

    // Publicar resultado y confirmar el mensaje de request.
    let published = publish_result(con, cfg, &outcome).await;
    if published {
        ack(con, cfg, msg_id).await;
    } else {
        warn!(%msg_id, "no se pudo publicar; el mensaje queda pendiente para reclamar");
    }
}

async fn publish_result(
    con: &mut redis::aio::MultiplexedConnection,
    cfg: &WorkerConfig,
    results: &ScrapeResults,
) -> bool {
    let payload = json!(results).to_string();
    let res: redis::RedisResult<String> = cmd("XADD")
        .arg(&cfg.stream_results)
        .arg("*")
        .arg("payload")
        .arg(payload)
        .query_async(con)
        .await;
    match res {
        Ok(_) => {
            info!(
                request_id = %results.request_id,
                items = results.items.len(),
                error = results.error.as_deref().unwrap_or(""),
                "resultado publicado en scraper:results"
            );
            true
        }
        Err(e) => {
            error!(request_id = %results.request_id, error = %e, "XADD de resultado falló");
            false
        }
    }
}

async fn ack(con: &mut redis::aio::MultiplexedConnection, cfg: &WorkerConfig, msg_id: &str) {
    if let Err(e) = cmd("XACK")
        .arg(&cfg.stream_requests)
        .arg(&cfg.group)
        .arg(msg_id)
        .query_async::<()>(con)
        .await
    {
        warn!(%msg_id, error = %e, "XACK falló");
    }
}

async fn ensure_group(con: &mut redis::aio::MultiplexedConnection, cfg: &WorkerConfig, stream: &str) {
    let res: redis::RedisResult<()> = cmd("XGROUP")
        .arg("CREATE")
        .arg(stream)
        .arg(&cfg.group)
        .arg("$")
        .arg("MKSTREAM")
        .query_async(con)
        .await;
    match res {
        Ok(_) => info!(stream, group = %cfg.group, "grupo creado"),
        Err(e) => {
            if !e.to_string().contains("BUSYGROUP") {
                warn!(stream, error = %e, "creación de grupo reportó error");
            }
        }
    }
}
