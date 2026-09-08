//! Pruebas del parsing/receta con HTML local (sin red).

use scraper::{Html, Selector};

use cv_harness_scraper::extract::html_to_text;
use cv_harness_scraper::recipe::{ScrapeRequest, ScrapedItem};

const FIXTURE_LIST: &str = r#"<!DOCTYPE html>
<html><body>
  <main class="job-list">
    <article class="job-item">
      <h2 class="job-title"><a href="/jobs/one.html">Backend Engineer NestJS</a></h2>
      <div class="job-company">TechCorp SAS</div>
      <div class="job-location">Medellín (Remoto)</div>
      <div class="job-date">hace 2 días</div>
      <div class="job-description"><p>Buscamos <strong>NestJS</strong>.</p><ul><li>Requisito</li></ul></div>
    </article>
    <article class="job-item">
      <h2 class="job-title"><a href="/jobs/two.html">Diseñador Gráfico</a></h2>
      <div class="job-company">Agencia Pixel</div>
      <div class="job-location">Cali</div>
      <div class="job-description"><p>Photoshop e Illustrator.</p></div>
    </article>
  </main>
</body></html>"#;

fn request(list_url: &str) -> ScrapeRequest {
    serde_json::from_value(serde_json::json!({
        "requestId": "test-1",
        "sourceId": "src-1",
        "sourceName": "fixture",
        "baseUrl": "http://localhost:8090",
        "listUrl": list_url,
        "recipe": {
            "selectors": {
                "item": ".job-item",
                "title": ".job-title a",
                "company": ".job-company",
                "location": ".job-location",
                "postedAt": ".job-date",
                "description": ".job-description",
                "applyUrl": ".job-title a"
            },
            "limits": { "maxPages": 1, "delayMs": 0, "timeoutMs": 2000, "userAgent": "test" }
        }
    }))
    .expect("receta de prueba válida")
}

fn extract_offline(req: &ScrapeRequest, html: &str) -> Vec<ScrapedItem> {
    let doc = Html::parse_document(html);
    let item_sel = Selector::parse(&req.recipe.selectors.item).unwrap();
    let title_sel = Selector::parse(req.recipe.selectors.title.as_ref().unwrap()).unwrap();
    let company_sel = Selector::parse(req.recipe.selectors.company.as_ref().unwrap()).unwrap();
    let location_sel = Selector::parse(req.recipe.selectors.location.as_ref().unwrap()).unwrap();
    let desc_sel = Selector::parse(req.recipe.selectors.description.as_ref().unwrap()).unwrap();
    let mut items = Vec::new();
    for el in doc.select(&item_sel) {
        let title = el.select(&title_sel).next().unwrap().text().collect::<String>();
        let company = el.select(&company_sel).next().unwrap().text().collect::<String>();
        let location = el.select(&location_sel).next().unwrap().text().collect::<String>();
        let desc_html = el.select(&desc_sel).next().unwrap().inner_html();
        items.push(ScrapedItem {
            external_id: None,
            url: format!("{}/jobs/x.html", req.base_url),
            title,
            company: Some(company),
            location: Some(location),
            salary: None,
            modality: None,
            posted_at: None,
            description_text: Some(html_to_text(&desc_html)),
            description_html: Some(desc_html),
            apply_url: None,
        });
    }
    items
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parsea_lista_y_extrae_items() {
        let req = request("http://localhost:8090/jobs.html");
        let items = extract_offline(&req, FIXTURE_LIST);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "Backend Engineer NestJS");
        assert_eq!(items[0].company.as_deref(), Some("TechCorp SAS"));
        assert!(
            items[0]
                .description_text
                .as_deref()
                .unwrap()
                .contains("Requisito")
        );
        assert_eq!(items[1].title, "Diseñador Gráfico");
    }

    #[test]
    fn receta_camelcase_deserializa() {
        let req = request("http://x/jobs.html");
        assert_eq!(req.request_id, "test-1");
        assert_eq!(req.recipe.selectors.item, ".job-item");
        assert_eq!(req.recipe.limits.max_pages, 1);
    }
}
