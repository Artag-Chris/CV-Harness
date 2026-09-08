use cv_harness_scraper::worker::{self, WorkerConfig};
use tracing::info;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,cv_harness_scraper=debug"));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .init();

    let cfg: WorkerConfig = WorkerConfig::from_env();
    info!(
        redis_url = %cfg.redis_url,
        requests = %cfg.stream_requests,
        results = %cfg.stream_results,
        group = %cfg.group,
        "cv-harness scraper arrancando"
    );

    worker::run(cfg).await
}
