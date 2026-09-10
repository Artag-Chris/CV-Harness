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
