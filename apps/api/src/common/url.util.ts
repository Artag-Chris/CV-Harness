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

/** Links que traen los correos de alerta y NO son la oferta (baja, legales, redes). */
const NOISE_URL =
  /(unsubscribe|optout|opt-out|preferences|privacy|terms|support\.|\/help|facebook\.com|twitter\.com|instagram\.com|youtube\.com|linkedin\.com|google\.com\/maps|doubleclick)/i;

/** Pistas de que el link ES la oferta (Indeed: viewjob/jk=; portales: /oferta…). */
const JOB_URL = /(viewjob|\bjk=|jobviewtrack|\/jobs?\/|\/oferta|\/empleo|\/vacante|\/rc\/clk|\/jdp\/)/i;

/**
 * Primera URL de la oferta dentro de un texto pegado.
 *
 * Por qué: para los avisos que llegan por correo (alertas de Indeed) el link
 * viene DENTRO del texto. Sin esto la vacante se guardaba sin URL: se perdía el
 * botón para aplicar y la dedup por URL. El correo también trae links de baja y
 * legales, así que se descartan y se prioriza el que parece un aviso.
 */
export function extractJobUrl(text: string | null | undefined): string | null {
  const found = ((text ?? '').match(/https?:\/\/[^\s<>"')\]]+/gi) ?? []).map((raw) =>
    raw.replace(/&amp;/gi, '&').replace(/[.,;:]+$/, ''),
  );
  const candidates = found.filter((url) => !NOISE_URL.test(url));
  return candidates.find((url) => JOB_URL.test(url)) ?? candidates[0] ?? null;
}

/**
 * Parámetros que NO cambian la identidad del aviso (tracking/analítica).
 * Deliberadamente corta: quitar de más fusionaría avisos distintos — en Indeed
 * `jk`/`vjk` son el id del aviso, y `source`/`ref` a veces seleccionan el board.
 */
const TRACKING_PARAMS = new Set([
  'gclid',
  'fbclid',
  'msclkid',
  'yclid',
  'dclid',
  'twclid',
  'igshid',
  'li_fat_id',
  'mc_cid',
  'mc_eid',
  '_ga',
  '_gl',
]);

/**
 * URL canónica para deduplicar: mismo aviso ⇒ misma cadena.
 *
 * El fingerprint viejo hasheaba la URL cruda, así que `?utm_source=…`, un
 * `#fragmento`, `http` vs `https`, `www` o la barra final creaban una fila
 * nueva (el mismo aviso reaparecía). Acá se deja una forma estable: minúsculas,
 * sin `www`, sin puerto por defecto, sin fragmento, sin parámetros de tracking y
 * con el resto ordenado y sin barra final.
 */
export function canonicalizeUrl(raw: string | null | undefined): string {
  const value = (raw ?? '').trim();
  if (!value) return '';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return value;

  url.hash = '';
  url.hostname = url.hostname.replace(/^www\./i, '').toLowerCase();
  if (
    (url.protocol === 'http:' && url.port === '80') ||
    (url.protocol === 'https:' && url.port === '443')
  ) {
    url.port = '';
  }

  const kept = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAMS.has(key.toLowerCase()) && !/^utm_/i.test(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  url.search = '';
  for (const [key, val] of kept) url.searchParams.append(key, val);

  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }
  return url.toString();
}
