//! Conversión de HTML (fragmento de descripción) a texto plano por párrafos.

/// Etiquetas que introducen un salto de bloque.
fn is_block_tag(tag: &str) -> bool {
    let t = tag.trim_start_matches('<').to_ascii_lowercase();
    let name: String = t.chars().take_while(|c| c.is_ascii_alphabetic()).collect();
    matches!(
        name.as_str(),
        "br"
            | "p"
            | "div"
            | "li"
            | "ul"
            | "ol"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "tr"
            | "table"
            | "section"
            | "article"
            | "blockquote"
            | "hr"
    )
}

fn decode_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
        .replace("&aacute;", "á")
        .replace("&eacute;", "é")
        .replace("&iacute;", "í")
        .replace("&oacute;", "ó")
        .replace("&uacute;", "ú")
        .replace("&ntilde;", "ñ")
        .replace("&Aacute;", "Á")
        .replace("&Eacute;", "É")
        .replace("&Iacute;", "Í")
        .replace("&Oacute;", "Ó")
        .replace("&Uacute;", "Ú")
        .replace("&Ntilde;", "Ñ")
}

/// Convierte HTML a texto plano, preservando saltos de línea entre bloques.
pub fn html_to_text(html: &str) -> String {
    let mut out = String::new();
    let mut rest = html;
    while let Some(lt) = rest.find('<') {
        out.push_str(&decode_entities(&rest[..lt]));
        let after = &rest[lt..];
        let gt = after.find('>').unwrap_or(after.len().saturating_sub(1));
        let tag = &after[..=gt];
        if is_block_tag(tag) && !out.is_empty() && !out.ends_with('\n') {
            out.push('\n');
        }
        rest = &after[gt + 1..];
    }
    out.push_str(&decode_entities(rest));

    out.lines()
        .map(|l| l.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_html_paragraphs_and_lists() {
        let html = "<p>Buscamos <strong>NestJS</strong>.</p><ul><li>Requisito uno</li><li>Requisito dos</li></ul><p>Salario 6M.</p>";
        let text = html_to_text(html);
        assert!(text.contains("Buscamos NestJS."));
        assert!(text.contains("Requisito uno"));
        assert!(text.contains("Salario 6M."));
        // El texto viene separado por líneas (bloques), no todo pegado.
        assert!(text.lines().count() >= 4);
    }

    #[test]
    fn decode_entities_basic() {
        assert_eq!(decode_entities("a &amp; b &nbsp; c"), "a & b   c");
    }
}
