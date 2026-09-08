/**
 * Limpieza de texto de descripciones scrapeadas: solo las etiquetas de bloque
 * introducen salto de línea; las inline (strong, em, span…) se quitan sin
 * romper el texto.
 */
export function cleanDescription(input: string): string {
  return input
    // bloques → salto de línea
    .replace(
      /<\s*(\/?)(p|div|li|ul|ol|h[1-6]|tr|td|table|section|article|blockquote|br)\b[^>]*>/gi,
      '\n',
    )
    // scripts/styles fuera
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // el resto de los tags desaparecen sin dejar rastro
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&aacute;/gi, 'á')
    .replace(/&eacute;/gi, 'é')
    .replace(/&iacute;/gi, 'í')
    .replace(/&oacute;/gi, 'ó')
    .replace(/&uacute;/gi, 'ú')
    .replace(/&ntilde;/gi, 'ñ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

/** Devuelve el contenido de un elemento HTML (innerText aproximado por líneas). */
export function htmlElementToText(html: string): string {
  return cleanDescription(html);
}
