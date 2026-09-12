/**
 * Origen (scheme + host) de una URL. Se usa como `baseUrl` de una fuente para
 * absolutizar los href relativos del listado (ej. `/co/ofertas-trabajo/x`).
 */
export function originOf(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/** ¿La URL ya trae esquema (`https://…`)? Un href relativo no lo trae. */
export function hasScheme(url: string | null | undefined): boolean {
  return !!url && /^[a-z][a-z0-9+.-]*:/i.test(url.trim());
}

/**
 * Absolutiza un href contra el origen del portal.
 *
 * Por qué: los listados HTML entregan hrefs relativos
 * (`/ofertas-de-trabajo/oferta-…-108A86F6`) y el scraper los guarda crudos en
 * `raw.applyUrl`. Sin resolverlos contra el portal, el botón «Abrir el aviso» no
 * lleva a ningún lado y obliga a copiar la ruta y buscar el portal a mano.
 *
 * Si no se puede resolver devuelve el href tal cual (mejor que perderlo).
 */
export function absoluteUrl(
  base: string | null | undefined,
  href: string | null | undefined,
): string | null {
  const raw = (href ?? '').trim();
  if (!raw) return null;
  const origin = (base ?? '').trim();
  try {
    return origin ? new URL(raw, origin).toString() : new URL(raw).toString();
  } catch {
    return raw;
  }
}
