//! Motor de scraping genérico: recibe la receta (selectores + límites) del
//! stream y devuelve los ítems extraídos. No conoce ningún sitio en particular.

use scraper::{ElementRef, Html, Selector};
use std::time::Duration;
use tracing::{debug, info, warn};
use url::Url;

use crate::extract::html_to_text;
use crate::recipe::{Recipe, ScrapedItem, ScrapeRequest};

struct Parsed {
    item: Selector,
    title: Option<Selector>,
    company: Option<Selector>,
    location: Option<Selector>,
    salary: Option<Selector>,
    posted_at: Option<Selector>,
    description: Option<Selector>,
    apply_url: Option<Selector>,
    next_page: Option<Selector>,
    detail_description: Option<Selector>,
}

impl Parsed {
    fn from_recipe(recipe: &Recipe) -> Result<Self, String> {
        // Un selector OPCIONAL inválido (p.ej. sintaxis de Playwright como
        // `:has-text()`) no debe tumbar toda la receta: se descarta el campo y
        // se sigue. Solo `item`, que es obligatorio, aborta la receta.
        let parse = |s: &Option<String>| -> Option<Selector> {
            let Some(raw) = s else { return None };
            match Selector::parse(raw) {
                Ok(sel) => Some(sel),
                Err(e) => {
                    warn!(selector = %raw, error = %e, "selector opcional inválido: se ignora");
                    None
                }
            }
        };
        Ok(Self {
            item: Selector::parse(&recipe.selectors.item)
                .map_err(|e| format!("selector item inválido: {e}"))?,
            title: parse(&recipe.selectors.title),
            company: parse(&recipe.selectors.company),
            location: parse(&recipe.selectors.location),
            salary: parse(&recipe.selectors.salary),
            posted_at: parse(&recipe.selectors.posted_at),
            description: parse(&recipe.selectors.description),
            apply_url: parse(&recipe.selectors.apply_url),
            next_page: parse(&recipe.selectors.next_page),
            detail_description: parse(
                &recipe
                    .selectors
                    .detail
                    .as_ref()
                    .and_then(|d| d.description.clone()),
            ),
        })
    }
}

/// Absolutiza un href contra la base y descarta el fragmento (`#lc=…`), que
/// varía entre listados y generaría fingerprints distintos de la misma oferta.
fn absolute_url(base: &str, href: &str) -> Option<String> {
    let mut url = Url::parse(base).and_then(|b| b.join(href)).ok()?;
    url.set_fragment(None);
    Some(url.to_string())
}

/// Atributo con la URL destino: cubre `<a href>` y los `<span data-path>`
/// que usan algunos portales para la paginación.
fn link_attr(element: ElementRef<'_>) -> Option<String> {
    let value = element.value();
    for attr in ["href", "data-path", "data-href", "data-url"] {
        if let Some(found) = value.attr(attr) {
            if !found.trim().is_empty() {
                return Some(found.to_string());
            }
        }
    }
    None
}

fn first_text<'a>(element: ElementRef<'a>, sel: &Selector) -> Option<String> {
    element
        .select(sel)
        .next()
        .map(|e| e.text().collect::<String>())
        .map(|t| t.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|t| !t.is_empty())
}

fn first_href(element: ElementRef<'_>, sel: &Selector) -> Option<String> {
    element
        .select(sel)
        .next()
        .and_then(link_attr)
        .or_else(|| {
            element
                .select(&Selector::parse("a").ok()?)
                .next()
                .and_then(link_attr)
        })
}

async fn fetch(client: &reqwest::Client, url: &str, recipe: &Recipe) -> Result<String, String> {
    let resp = crate::http::get(client, url, recipe)
        .send()
        .await
        .map_err(|e| format!("GET {url} falló: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("GET {url} → HTTP {status}"));
    }
    let body = resp.text().await.map_err(|e| format!("lectura de {url}: {e}"))?;
    if body.trim().is_empty() {
        return Err(format!("GET {url} → cuerpo vacío"));
    }
    Ok(body)
}

async fn polite_sleep(recipe: &Recipe) {
    if recipe.limits.delay_ms > 0 {
        tokio::time::sleep(Duration::from_millis(recipe.limits.delay_ms)).await;
    }
}

async fn robots_allows(
    client: &reqwest::Client,
    base_url: &str,
    path: &str,
    recipe: &Recipe,
) -> bool {
    let Ok(mut url) = Url::parse(base_url) else {
        return true;
    };
    if let Ok(joined) = url.join("/robots.txt") {
        url = joined;
    }
    let resp = client
        .get(url.to_string())
        .timeout(Duration::from_millis(recipe.limits.timeout_ms))
        .send()
        .await;
    let Ok(resp) = resp else { return true };
    if !resp.status().is_success() {
        return true; // sin robots.txt → asumir permitido
    }
    let Ok(body) = resp.text().await else { return true };
    let path = path.trim_start_matches('/');
    for line in body.lines() {
        let line = line.trim();
        if let Some(rule) = line.strip_prefix("Disallow:") {
            let rule = rule.trim().trim_start_matches('/');
            if !rule.is_empty() && path.starts_with(rule.trim_end_matches('*')) {
                return false;
            }
        }
    }
    true
}

fn extract_item(
    item: ElementRef<'_>,
    parsed: &Parsed,
    req: &ScrapeRequest,
) -> Option<ScrapedItem> {
    let title_sel = parsed.title.as_ref()?;
    let title = first_text(item, title_sel)?;

    let href = parsed
        .apply_url
        .as_ref()
        .and_then(|s| first_href(item, s))
        .or_else(|| item.select(&Selector::parse("a").ok()?).next().and_then(link_attr));
    let url = href.as_deref().and_then(|h| absolute_url(&req.base_url, h));

    let desc_html = parsed
        .description
        .as_ref()
        .and_then(|s| item.select(s).next().map(|e| e.inner_html()));

    Some(ScrapedItem {
        external_id: url.clone(),
        url: url.clone().unwrap_or_else(|| req.list_url.clone()),
        title,
        company: parsed.company.as_ref().and_then(|s| first_text(item, s)),
        location: parsed.location.as_ref().and_then(|s| first_text(item, s)),
        salary: parsed.salary.as_ref().and_then(|s| first_text(item, s)),
        modality: None,
        posted_at: parsed.posted_at.as_ref().and_then(|s| first_text(item, s)),
        description_text: desc_html.as_deref().map(html_to_text).filter(|t| !t.is_empty()),
        description_html: desc_html.clone(),
        // El href del aviso, ya absolutizado contra el portal: los listados lo
        // entregan relativo (`/ofertas-de-trabajo/…`) y así no abre desde la ficha.
        apply_url: url.clone(),
    })
}

async fn fetch_detail_description(
    client: &reqwest::Client,
    req: &ScrapeRequest,
    parsed: &Parsed,
    item: &mut ScrapedItem,
) {
    let Some(detail_sel) = parsed.detail_description.as_ref() else { return };
    let Some(url) = Some(item.url.clone()) else { return };
    match fetch(client, &url, &req.recipe).await {
        Ok(html) => {
            let doc = Html::parse_document(&html);
            if let Some(el) = doc.select(detail_sel).next() {
                item.description_html = Some(el.inner_html());
                item.description_text = Some(html_to_text(&el.inner_html()));
            }
        }
        Err(e) => {
            warn!(%url, error = %e, "fallo al fetchear detalle");
        }
    }
}

/// Una página ya parseada: los items del listado y el link a la siguiente.
pub struct ParsedPage {
    pub items: Vec<ScrapedItem>,
    pub next_page: Option<String>,
}

/// Parsea una página de listado con la receta (sin red, sin detalle).
/// Público para poder probar recetas contra HTML guardado.
pub fn parse_page(req: &ScrapeRequest, html: &str) -> Result<ParsedPage, String> {
    let parsed = Parsed::from_recipe(&req.recipe)?;
    let doc = Html::parse_document(html);
    let items = doc
        .select(&parsed.item)
        .filter_map(|el| extract_item(el, &parsed, req))
        .collect();
    let next_page = parsed
        .next_page
        .as_ref()
        .and_then(|s| doc.select(s).next())
        .and_then(link_attr);
    Ok(ParsedPage { items, next_page })
}

/// Construye la URL de la página N cuando la receta pagina por parámetro
/// (`?page=2`). Si la URL ya traía ese parámetro, se reemplaza.
fn page_url(base: &str, param: &str, page: u32) -> Result<String, String> {
    let mut url = Url::parse(base).map_err(|e| format!("listUrl inválida: {e}"))?;
    let pairs: Vec<(String, String)> = url
        .query_pairs()
        .filter(|(k, _)| k != param)
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    {
        let mut qp = url.query_pairs_mut();
        qp.clear();
        for (k, v) in &pairs {
            qp.append_pair(k, v);
        }
        qp.append_pair(param, &page.to_string());
    }
    url.set_fragment(None);
    Ok(url.to_string())
}

pub async fn run(req: &ScrapeRequest, client: &reqwest::Client) -> Result<Vec<ScrapedItem>, String> {
    let parsed = Parsed::from_recipe(&req.recipe)?;
    let mut items: Vec<ScrapedItem> = Vec::new();
    // Paginación por parámetro (?page=N) o por link "next" del propio HTML.
    let page_param = req
        .recipe
        .limits
        .page_param
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty());
    let total_pages = req.recipe.limits.max_pages.max(1);
    let mut current_url: String = req.list_url.clone();

    // respeto básico de robots.txt (si la fuente lo pide)
    if req.recipe.limits.respect_robots {
        let path = Url::parse(&current_url)
            .map(|u| u.path().to_string())
            .unwrap_or_default();
        if !robots_allows(client, &req.base_url, &path, &req.recipe).await {
            return Err(format!("robots.txt de {} no permite {}", req.base_url, path));
        }
    }

    for page in 1..=total_pages {
        if page > 1 {
            polite_sleep(&req.recipe).await;
        }
        let page_url_to_fetch = match page_param {
            Some(param) => page_url(&req.list_url, param, page)?,
            None => current_url.clone(),
        };
        info!(
            request_id = %req.request_id,
            source = ?req.source_name,
            url = %page_url_to_fetch,
            page,
            "fetching página"
        );
        let html = fetch(client, &page_url_to_fetch, &req.recipe).await?;
        let parsed_page = parse_page(req, &html)?;
        let mut page_items = parsed_page.items;

        for item in page_items.iter_mut() {
            if item.description_text.is_none() && req.recipe.selectors.fetch_detail {
                fetch_detail_description(client, req, &parsed, item).await;
                polite_sleep(&req.recipe).await;
            }
        }
        let count = page_items.len();
        items.append(&mut page_items);
        debug!(request_id = %req.request_id, page, page_items = count, "items en página");

        if page >= total_pages {
            break;
        }
        // Con pageParam el loop construye la siguiente URL: nada que seguir.
        if page_param.is_some() {
            continue;
        }
        match parsed_page.next_page {
            Some(href) => {
                let joined = absolute_url(&req.base_url, &href).ok_or("next_page href no resoluble")?;
                if joined == current_url {
                    break; // evita loop infinito
                }
                current_url = joined;
            }
            None => break,
        }
    }

    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_url_agrega_el_parametro() {
        assert_eq!(
            page_url("https://x.com/ofertas", "page", 2).unwrap(),
            "https://x.com/ofertas?page=2"
        );
    }

    #[test]
    fn page_url_conserva_otros_query_params() {
        assert_eq!(
            page_url("https://x.com/ofertas?q=dev&ciudad=cali", "page", 3).unwrap(),
            "https://x.com/ofertas?q=dev&ciudad=cali&page=3"
        );
    }

    #[test]
    fn page_url_reemplaza_el_parametro_existente() {
        assert_eq!(
            page_url("https://x.com/ofertas?page=1&q=dev", "page", 4).unwrap(),
            "https://x.com/ofertas?q=dev&page=4"
        );
    }

    #[test]
    fn page_url_descarta_fragmento() {
        assert_eq!(
            page_url("https://x.com/ofertas#top", "page", 2).unwrap(),
            "https://x.com/ofertas?page=2"
        );
    }
}
