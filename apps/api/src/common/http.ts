/**
 * Cabeceras de navegador y diagnóstico de bloqueos para el fetch del lado Nest.
 *
 * Compartido por el probe de recetas y por las fuentes de API: presentarse como
 * navegador evita los 403 por User-Agent, pero NO resuelve un WAF con challenge
 * (Cloudflare Turnstile y similares), que es un problema distinto y se explica
 * aparte.
 */

export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Set completo de cabeceras de Chrome para una navegación de documento. */
export function browserHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'User-Agent': BROWSER_UA,
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'es-CO,es;q=0.9,en;q=0.8',
    'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    ...extra,
  };
}

/** Igual que `browserHeaders` pero para un POST de API (XHR/fetch del navegador). */
export function browserJsonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return browserHeaders({
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    ...extra,
  });
}

/** Lector de cabeceras insensible a mayúsculas (sirve `Headers` y objetos). */
type HeaderReader = { get(name: string): string | null } | Record<string, string | undefined>;

function readHeader(headers: HeaderReader, name: string): string {
  if (typeof (headers as { get?: unknown }).get === 'function') {
    return (headers as { get(n: string): string | null }).get(name) ?? '';
  }
  const entries = Object.entries(headers as Record<string, string | undefined>);
  const found = entries.find(([key]) => key.toLowerCase() === name.toLowerCase());
  return found?.[1] ?? '';
}

/**
 * Explica POR QUÉ falló el fetch y qué se puede hacer. Devuelve `null` si el
 * status no es un bloqueo conocido (el llamador usa un mensaje genérico).
 *
 * Importante: distinguir "WAF con challenge" de "403 a secas". Lo primero no se
 * arregla con headers ni User-Agent —el desafío se resuelve ejecutando JS y
 * guardando una cookie `cf_clearance`—, así que no hay que mandar al usuario a
 * perder el tiempo cambiando el UA.
 */
export function diagnoseBlock(status: number, headers: HeaderReader): string | null {
  const mitigated = readHeader(headers, 'cf-mitigated').toLowerCase();
  const server = readHeader(headers, 'server').toLowerCase();
  const cfRay = readHeader(headers, 'cf-ray');
  const isCloudflare = server.includes('cloudflare') || !!cfRay || !!mitigated;

  if (mitigated === 'challenge' || (isCloudflare && (status === 403 || status === 503))) {
    return 'El sitio está detrás de Cloudflare con un challenge gestionado (Turnstile): se resuelve ejecutando JavaScript y guardando una cookie, así que no alcanza con cambiar headers ni User-Agent. Para este portal conviene una fuente por API/RSS oficial, o una fuente con sesión de navegador.';
  }
  if (status === 401) {
    return 'El sitio pidió autenticación: probablemente necesite una API key o una sesión.';
  }
  if (status === 403) {
    return 'El sitio bloqueó la petición (WAF/anti-bot) por huella de cliente (TLS/HTTP2) o reputación de IP, no solo por User-Agent.';
  }
  if (status === 429) {
    return 'El sitio limitó la tasa de peticiones: bajá la frecuencia o probá más tarde.';
  }
  if (status === 503) {
    return 'El sitio está temporalmente no disponible (o protegiéndose con un challenge).';
  }
  if (status === 500 || status === 502 || status === 504) {
    return 'El servidor del portal falló (error interno suyo): suele ser transitorio o un límite de uso. Reintentá más tarde o bajá la frecuencia.';
  }
  return null;
}
