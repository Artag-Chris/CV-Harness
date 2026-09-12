//! Cliente HTTP del scraper y cabeceras de navegador.
//!
//! Presentarse como un navegador real evita los 403 que dependen del User-Agent,
//! y el cookie store mantiene la sesión entre el listado y las páginas de detalle
//! (muchos portales exigen la cookie de la primera visita para servir el detalle).
//!
//! LÍMITE CONOCIDO: esto NO derrota un WAF con challenge (Cloudflare Turnstile y
//! similares). Ese caso se resuelve en el otro extremo —con una fuente por API
//! oficial (`Source.kind = API_JSON`) o con una sesión de navegador—, no acá.

use reqwest::header::{HeaderMap, HeaderName, HeaderValue, USER_AGENT};
use reqwest::Client;
use std::time::Duration;

use crate::recipe::Recipe;

/// Cabeceras que Chrome manda en una navegación de documento. No se incluye
/// `accept-encoding`: lo administra reqwest para poder descomprimir solo.
const BROWSER_HEADERS: &[(&str, &str)] = &[
    (
        "accept",
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    ),
    ("accept-language", "es-CO,es;q=0.9,en;q=0.8"),
    ("sec-ch-ua", "\"Chromium\";v=\"131\", \"Not_A Brand\";v=\"24\""),
    ("sec-ch-ua-mobile", "?0"),
    ("sec-ch-ua-platform", "\"Windows\""),
    ("sec-fetch-dest", "document"),
    ("sec-fetch-mode", "navigate"),
    ("sec-fetch-site", "none"),
    ("sec-fetch-user", "?1"),
    ("upgrade-insecure-requests", "1"),
];

/// Cabeceras por defecto del cliente (el User-Agent lo pone cada request, porque
/// es configurable por fuente).
pub fn default_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    for (name, value) in BROWSER_HEADERS {
        if let (Ok(name), Ok(value)) = (
            HeaderName::from_bytes(name.as_bytes()),
            HeaderValue::from_str(value),
        ) {
            headers.insert(name, value);
        }
    }
    headers
}

/// Cliente único del worker: cookies compartidas, compresión y cabeceras.
pub fn build_client() -> anyhow::Result<Client> {
    Ok(Client::builder()
        .cookie_store(true)
        .gzip(true)
        .brotli(true)
        .deflate(true)
        .default_headers(default_headers())
        // Los portales redirigen (http→https, país incorrecto, canonical): seguir
        // un número acotado evita quedarse en un loop.
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()?)
}

/// Petición GET con las cabeceras de la receta: el UA de la fuente manda sobre
/// el resto, y las cabeceras extra permiten sumar cosas como `Referer`.
pub fn get(client: &Client, url: &str, recipe: &Recipe) -> reqwest::RequestBuilder {
    let mut request = client
        .get(url)
        .header(USER_AGENT, recipe.limits.user_agent.as_str())
        .timeout(Duration::from_millis(recipe.limits.timeout_ms));
    if let Some(extra) = &recipe.limits.headers {
        for (name, value) in extra {
            request = request.header(name.as_str(), value.as_str());
        }
    }
    request
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn las_cabeceras_por_defecto_son_de_navegador() {
        let headers = default_headers();
        assert_eq!(headers.get("sec-fetch-mode").unwrap(), "navigate");
        assert!(headers.get("accept-language").unwrap().to_str().unwrap().contains("es"));
        // El set incluye los client hints que Cloudflare exige por contrato.
        assert!(headers.get("sec-ch-ua-platform").is_some());
        // Nunca se fija accept-encoding a mano: reqwest lo gestiona para descomprimir.
        assert!(headers.get("accept-encoding").is_none());
    }

    #[test]
    fn el_user_agent_de_la_fuente_gana_sobre_el_default() {
        let recipe = Recipe {
            limits: crate::recipe::Limits {
                user_agent: "MiUA/1.0".into(),
                ..Default::default()
            },
            ..Default::default()
        };
        let client = Client::builder().build().unwrap();
        let request = get(&client, "https://example.com", &recipe)
            .build()
            .unwrap();
        assert_eq!(request.headers().get(USER_AGENT).unwrap(), "MiUA/1.0");
    }
}
