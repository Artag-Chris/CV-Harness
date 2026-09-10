//! Pruebas del parsing/receta con HTML local (sin red).

use scraper::{Html, Selector};

use cv_harness_scraper::engine::parse_page;
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

    /// HTML REAL de un listado de Computrabajo (recortado), para que un rediseño
    /// del portal rompa este test en vez de romper la producción en silencio.
    const COMPUTRABAJO_LIST: &str = r#"
<article class="box_offer sel outstanding" data-id='A4F9581DF84D20E861373E686DCF3405' data-offers-grid-offer-item-container>
    <div class="list_dot mb15">
        <span class="fc_urgent">Se precisa Urgente</span>
        <span class="fc_dest">Empleo destacado</span>
    </div>
    <h2 class="fs18 fwB prB">
        <a class="js-o-link fc_base" href="/ofertas-de-trabajo/oferta-de-trabajo-de-desarrollador-de-mercado-la-mesa-cundinamarca-en-la-mesa-A4F9581DF84D20E861373E686DCF3405#lc=ListOffers-Score4-0">
            Desarrollador de Mercado
        </a>
        <div class="tags">
            <span class="tag postulated hide"><span class="icon i_check_circle_full mr5"></span>Postulado</span>
        </div>
    </h2>
    <p class="dFlex vm_fx fs16 fc_base mt5">
        <span class="icon i_verificada mr5"></span>
        <a class="fc_base t_ellipsis" href="https://co.computrabajo.com/central-cervecera-de-colombia">Central Cervecera de Colombia</a>
    </p>
    <p class="fs16 fc_base mt5">
        <span class="mr10">La Mesa, Cundinamarca</span>
    </p>
    <p class="fs13 fc_aux mt15">Hace  38  minutos</p>
</article>
<article class="box_offer sel outstanding">
    <h2 class="fs18 fwB prB">
        <a class="js-o-link fc_base" href="/ofertas-de-trabajo/oferta-de-trabajo-de-desarrollador-mercado-plus-cartagena-BEEF1234#lc=ListOffers-Score4-0">
            Desarrollador Mercado Plus / Marcas Premium
        </a>
    </h2>
    <p class="dFlex vm_fx fs16 fc_base mt5">
        <a class="fc_base t_ellipsis" href="https://co.computrabajo.com/central-cervecera-de-colombia">Central Cervecera de Colombia</a>
    </p>
    <p class="fs16 fc_base mt5">
        <span class="mr10">Cartagena de Indias, Bol&#xED;var</span>
    </p>
    <div class="fs13 mt15">
        <span class="dIB mr10">
            <span class="icon i_salary"></span>
            $ 4.000.000,00 (Mensual)
        </span>
    </div>
    <p class="fs13 fc_aux mt15">Hace 35 minutos</p>
</article>
<article class="box_offer sel outstanding">
    <h2 class="fs18 fwB prB">
        <a class="js-o-link fc_base" href="/ofertas-de-trabajo/oferta-de-trabajo-de-desarrolladora-semisenior-bogota-2C108AB3#lc=ListOffers-Score4-2">
            Desarrollador/a SemiSenior Spring Boot, Angular
        </a>
    </h2>
    <p class="dFlex vm_fx fs16 fc_base mt5">
        <span class="fx_none mr10">
            <span class="fwB">4,7</span>
            <span class="star"></span>
        </span>
        <span class="icon i_verificada mr5"></span>
        <a class="fc_base t_ellipsis" href="https://co.computrabajo.com/profamilia" offer-grid-article-company-url>ASOCIACION PROFAMILIA </a>
    </p>
    <p class="fs16 fc_base mt5">
        <span class="mr10">Bogot&#xE1;, D.C., Bogot&#xE1;, D.C.</span>
    </p>
    <p class="fs13 fc_aux mt15">Hace  1  hora</p>
</article>
<div class="dFlex vm_fx tj_fx mtB">
    <span class="b_primary_inv fwB disabled w48 cp">Anterior</span>
    <span class="b_primary w48 buildLink cp" data-path="https://co.computrabajo.com/trabajo-de-desarrollador-y-programador?p=2" title="Siguiente">Siguiente</span>
</div>"#;

    fn computrabajo_json() -> serde_json::Value {
        serde_json::json!({
            "requestId": "test-ct",
            "sourceId": "src-ct",
            "sourceName": "Computrabajo Colombia",
            "baseUrl": "https://co.computrabajo.com",
            "listUrl": "https://co.computrabajo.com/trabajo-de-desarrollador-y-programador",
            "recipe": {
                "selectors": {
                    "item": "article.box_offer",
                    "title": "h2 a.js-o-link",
                    "company": "a.t_ellipsis",
                    "location": "p.fs16.fc_base.mt5:not(.dFlex) span.mr10",
                    "salary": "div.fs13 span.dIB.mr10",
                    "postedAt": "p.fs13.fc_aux",
                    "applyUrl": "h2 a.js-o-link",
                    "nextPage": "[title=\"Siguiente\"]",
                    "fetchDetail": true,
                    "detail": { "description": "div[div-link=\"oferta\"]" }
                },
                "limits": { "maxPages": 2, "delayMs": 0, "timeoutMs": 2000, "userAgent": "test" }
            }
        })
    }

    fn computrabajo_request() -> ScrapeRequest {
        serde_json::from_value(computrabajo_json()).expect("receta de Computrabajo válida")
    }

    #[test]
    fn computrabajo_extrae_items_reales() {
        let req = computrabajo_request();
        let page = parse_page(&req, COMPUTRABAJO_LIST).expect("parsea el listado");

        assert_eq!(page.items.len(), 3, "debe extraer los 3 articles");

        let first = &page.items[0];
        assert_eq!(first.title, "Desarrollador de Mercado");
        assert_eq!(first.company.as_deref(), Some("Central Cervecera de Colombia"));
        assert_eq!(first.location.as_deref(), Some("La Mesa, Cundinamarca"));
        assert_eq!(first.posted_at.as_deref(), Some("Hace 38 minutos"));
        assert_eq!(first.salary, None);
        // La URL pierde el fragmento de tracking (#lc=…).
        assert_eq!(
            first.url,
            "https://co.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-desarrollador-de-mercado-la-mesa-cundinamarca-en-la-mesa-A4F9581DF84D20E861373E686DCF3405"
        );

        let second = &page.items[1];
        assert_eq!(second.salary.as_deref(), Some("$ 4.000.000,00 (Mensual)"));
        assert_eq!(second.location.as_deref(), Some("Cartagena de Indias, Bolívar"));

        // Oferta con calificación de empresa: la ubicación NO debe ser "4,7".
        let third = &page.items[2];
        assert_eq!(third.company.as_deref(), Some("ASOCIACION PROFAMILIA"));
        assert_eq!(third.location.as_deref(), Some("Bogotá, D.C., Bogotá, D.C."));
        assert_eq!(third.salary, None);
    }

    #[test]
    fn computrabajo_paginacion_desde_data_path() {
        let req = computrabajo_request();
        let page = parse_page(&req, COMPUTRABAJO_LIST).expect("parsea el listado");
        // "Siguiente" es un <span data-path>, no un <a href>.
        assert_eq!(
            page.next_page.as_deref(),
            Some("https://co.computrabajo.com/trabajo-de-desarrollador-y-programador?p=2")
        );
    }

    #[test]
    fn selector_opcional_invalido_no_rompe_la_receta() {
        // Sintaxis de Playwright (:has-text) inválida en CSS: debe ignorarse el
        // campo, no abortar toda la receta.
        let mut value = computrabajo_json();
        value["recipe"]["selectors"]["nextPage"] =
            serde_json::json!("a[title=\"Siguiente\"], .paginado a:has-text(\"Siguiente\")");
        let req: ScrapeRequest = serde_json::from_value(value).unwrap();

        let page = parse_page(&req, COMPUTRABAJO_LIST).expect("la receta sigue siendo válida");
        assert_eq!(page.items.len(), 3);
        assert_eq!(page.next_page, None);
    }

    /// HTML REAL (recortado) de una página de detalle de Computrabajo.
    const COMPUTRABAJO_DETAIL: &str = r#"
<div class="box_detail fl w100_m">
    <div already-applied-box-container description-offer>
        <div class="menu_switch posSticky top0 pl0 pr0 w100" offer-menu-switch>
            <nav><a class="sel">Oferta</a></nav>
        </div>
        <div class="mb40 pb40 bb1" div-link="oferta">
            <h2 class="fwB fs18 mb20">Descripción de la oferta</h2>
            <div class="mbB">
                <span class="tag base mb10">A convenir</span>
                <span class="tag base mb10">Tiempo Completo</span>
            </div>
            <p class="mbB">Estamos buscando vendedores TAT en Villeta.</p>
            <p class="fwB fs18 mtB mb10">Requerimientos</p>
            <ul class="disc mbB">
                <li class='mb10'>Educación mínima: Bachillerato / Educación Media</li>
            </ul>
        </div>
    </div>
</div>"#;

    #[test]
    fn computrabajo_selector_de_detalle_extrae_descripcion() {
        let req = computrabajo_request();
        let sel = req
            .recipe
            .selectors
            .detail
            .as_ref()
            .and_then(|d| d.description.as_ref())
            .expect("la receta define detail.description");
        let doc = Html::parse_document(COMPUTRABAJO_DETAIL);
        let el = doc
            .select(&Selector::parse(sel).unwrap())
            .next()
            .expect("el selector de detalle debe matchear");

        let text = html_to_text(&el.inner_html());
        assert!(text.contains("Descripción de la oferta"));
        assert!(text.contains("Estamos buscando vendedores TAT"));
        assert!(text.contains("Requerimientos"));
    }
}
