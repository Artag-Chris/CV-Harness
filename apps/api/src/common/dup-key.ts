/**
 * Clave de contenido de una vacante para detectar el MISMO aviso publicado en
 * otro portal (Jooble/Careerjet vs el original), donde la URL no ayuda.
 *
 * Se apoya en título + empresa (+ ubicación) normalizados. Sin empresa devuelve
 * `null`: un título suelto ("Desarrollador") agruparía avisos distintos.
 */
export function buildDupKey(input: {
  title?: string | null;
  company?: string | null;
  location?: string | null;
}): string | null {
  const title = normalizeDupText(input.title);
  const company = normalizeDupText(input.company);
  if (!title || !company) return null;
  return `${title}|${company}|${normalizeDupText(input.location)}`;
}

/** Minúsculas, sin acentos ni puntuación, espacios colapsados. */
export function normalizeDupText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
