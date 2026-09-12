//! Diagnóstico: ¿este portal responde al cliente HTTP real del scraper?
//!
//! Sirve para separar "el portal nos bloquea" de "la receta está mal". Usa el
//! mismo cliente que el worker (cabeceras de navegador, cookies, compresión), así
//! que si acá falla, en producción también.
//!
//! Uso:
//!   cargo run --example probe_url -- https://co.computrabajo.com/trabajo-de-...
//!   cargo run --example probe_url -- <url> "<user-agent opcional>"

use cv_harness_scraper::http;
use cv_harness_scraper::recipe::{Limits, Recipe};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let Some(url) = args.next() else {
        eprintln!("Falta la URL. Uso: cargo run --example probe_url -- <url> [user-agent]");
        std::process::exit(2);
    };
    let user_agent = args.next();

    let recipe = Recipe {
        limits: Limits {
            timeout_ms: 25_000,
            user_agent: user_agent.unwrap_or_else(|| {
                // Mismo UA que usan las plantillas del dashboard.
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36".to_string()
            }),
            ..Default::default()
        },
        ..Default::default()
    };

    let client = http::build_client()?;
    let response = http::get(&client, &url, &recipe).send().await?;
    let status = response.status();
    // `text()` descomprime solo (gzip/brotli) gracias a las features del cliente.
    let body = response.text().await?;
    let sample: String = body.chars().take(120).collect::<String>().replace('\n', " ");

    println!("url:    {url}");
    println!("status: {status}");
    println!("bytes:  {}", body.len());
    println!("muestra: {sample}");
    Ok(())
}
