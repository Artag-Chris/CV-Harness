use serde::Deserialize;

/// Payload publicado por Nest en `scraper:requests`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrapeRequest {
    pub request_id: String,
    pub source_id: Option<String>,
    pub source_name: Option<String>,
    pub base_url: String,
    pub list_url: String,
    pub recipe: Recipe,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recipe {
    pub selectors: Selectors,
    pub limits: Limits,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Selectors {
    pub item: String,
    pub title: Option<String>,
    pub company: Option<String>,
    pub location: Option<String>,
    pub salary: Option<String>,
    pub posted_at: Option<String>,
    pub description: Option<String>,
    pub apply_url: Option<String>,
    pub next_page: Option<String>,
    #[serde(default)]
    pub fetch_detail: bool,
    pub detail: Option<DetailSelectors>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailSelectors {
    pub description: Option<String>,
    pub company: Option<String>,
    pub location: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Limits {
    #[serde(default = "default_max_pages")]
    pub max_pages: u32,
    #[serde(default = "default_delay_ms")]
    pub delay_ms: u64,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
    #[serde(default = "default_user_agent")]
    pub user_agent: String,
    #[serde(default)]
    pub respect_robots: bool,
    /// Cabeceras extra por fuente (ej. `Referer`). Se suman a las de navegador.
    #[serde(default)]
    pub headers: Option<std::collections::HashMap<String, String>>,
    /// Nombre del parámetro de paginación (ej. "page"). Cuando está presente,
    /// el motor construye las URLs `?page=N` en vez de seguir un link "next".
    /// Necesario para portales cuya paginación se dibuja con JavaScript.
    #[serde(default)]
    pub page_param: Option<String>,
}

fn default_max_pages() -> u32 {
    1
}
fn default_delay_ms() -> u64 {
    500
}
fn default_timeout_ms() -> u64 {
    20_000
}
fn default_user_agent() -> String {
    "cv-harness/0.1".to_string()
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_pages: default_max_pages(),
            delay_ms: default_delay_ms(),
            timeout_ms: default_timeout_ms(),
            user_agent: default_user_agent(),
            respect_robots: false,
            headers: None,
            page_param: None,
        }
    }
}

impl Default for Recipe {
    fn default() -> Self {
        Self {
            selectors: Selectors {
                item: ".job-item".into(),
                title: None,
                company: None,
                location: None,
                salary: None,
                posted_at: None,
                description: None,
                apply_url: None,
                next_page: None,
                fetch_detail: false,
                detail: None,
            },
            limits: Limits::default(),
        }
    }
}

/// Un ítem scrapeado; se publica en `scraper:results` (serde camelCase).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrapedItem {
    pub external_id: Option<String>,
    pub url: String,
    pub title: String,
    pub company: Option<String>,
    pub location: Option<String>,
    pub salary: Option<String>,
    pub modality: Option<String>,
    pub posted_at: Option<String>,
    pub description_text: Option<String>,
    pub description_html: Option<String>,
    pub apply_url: Option<String>,
}

/// Payload de resultados para Nest (scraper:results).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrapeResults {
    /// Versión del contrato del stream.
    pub schema_version: Option<String>,
    pub request_id: String,
    pub source_id: Option<String>,
    pub error: Option<String>,
    pub items: Vec<ScrapedItem>,
}

#[derive(Debug, Clone)]
pub struct ScrapeError {
    pub message: String,
}

impl ScrapeError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}
