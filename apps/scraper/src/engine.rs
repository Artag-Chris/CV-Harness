//! Motor de scraping genérico: recibe la receta (selectores + límites) del
//! stream y devuelve los ítems extraídos. No conoce ningún sitio en particular.

use reqwest::header::USER_AGENT;
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
    posted_at: Option<Selector>,
    description: Option<Selector>,
    apply_url: Option<Selector>,
    next_page: Option<Selector>,
    detail_description: Option<Selector>,
}

impl Parsed {
    fn from_recipe(recipe: &Recipe) -> Result<Self, String> {
        let parse = |s: &Option<String>| -> Result<Option<Selector>, String> {
            match s {
                Some(sel) => Selector::parse(sel)
                    .map(Some)
                    .map_err(|e| format!("selector inválido '{sel}': {e}")),
                None => Ok(None),
            }
        };
        Ok(Self {
            item: Selector::parse(&recipe.selectors.item)
                .map_err(|e| format!("selector item inválido: {e}"))?,
            title: parse(&recipe.selectors.title)?,
            company: parse(&recipe.selectors.company)?,
            location: parse(&recipe.selectors.location)?,
            posted_at: parse(&recipe.selectors.posted_at)?,
            description: parse(&recipe.selectors.description)?,
            apply_url: parse(&recipe.selectors.apply_url)?,
            next_page: parse(&recipe.selectors.next_page)?,
            detail_description: parse(
                &recipe
                    .selectors
                    .detail
                    .as_ref()
                    .and_then(|d| d.description.clone()),
            )?,
        })
    }
}

fn absolute_url(base: &str, href: &str) -> Option<String> {
    Url::parse(base)
        .and_then(|b| b.join(href))
        .map(|u| u.to_string())
        .ok()
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
    element.select(sel).next().and_then(|e| {
        e.value()
            .attr("href")
            .or_else(|| e.select(&Selector::parse("a").ok()?).next()?.value().attr("href"))
            .map(String::from)
    })
}

async fn fetch(client: &reqwest::Client, url: &str, recipe: &Recipe) -> Result<String, String> {
    let resp = client
        .get(url)
        .header(USER_AGENT, recipe.limits.user_agent.as_str())
        .timeout(Duration::from_millis(recipe.limits.timeout_ms))
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
        .or_else(|| {
            item.select(&Selector::parse("a").ok()?).next()?.value().attr("href").map(String::from)
        });
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
        salary: None,
        modality: None,
        posted_at: parsed.posted_at.as_ref().and_then(|s| first_text(item, s)),
        description_text: desc_html.as_deref().map(html_to_text).filter(|t| !t.is_empty()),
        description_html: desc_html.clone(),
        apply_url: href.clone(),
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

pub async fn run(req: &ScrapeRequest, client: &reqwest::Client) -> Result<Vec<ScrapedItem>, String> {
    let parsed = Parsed::from_recipe(&req.recipe)?;
    let mut items: Vec<ScrapedItem> = Vec::new();
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

    for page in 1..=req.recipe.limits.max_pages.max(1) {
        if page > 1 {
            polite_sleep(&req.recipe).await;
        }
        info!(
            request_id = %req.request_id,
            source = ?req.source_name,
            url = %current_url,
            page,
            "fetching página"
        );
        let html = fetch(client, &current_url, &req.recipe).await?;
        let doc = Html::parse_document(&html);

        let mut page_items = 0usize;
        for el in doc.select(&parsed.item) {
            let Some(mut item) = extract_item(el, &parsed, req) else { continue };
            if item.description_text.is_none() && req.recipe.selectors.fetch_detail {
                fetch_detail_description(client, req, &parsed, &mut item).await;
                polite_sleep(&req.recipe).await;
            }
            items.push(item);
            page_items += 1;
        }
        debug!(request_id = %req.request_id, page, page_items, "items en página");

        // Paginación: siguiente página si existe y no superamos el tope.
        if page >= req.recipe.limits.max_pages {
            break;
        }
        let next = parsed
            .next_page
            .as_ref()
            .and_then(|s| doc.select(s).next())
            .and_then(|e| e.value().attr("href"));
        match next {
            Some(href) => {
                let joined = absolute_url(&req.base_url, href).ok_or("next_page href no resoluble")?;
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
