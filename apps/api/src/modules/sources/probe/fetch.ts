import { BadRequestException } from '@nestjs/common';
import { browserHeaders, diagnoseBlock } from '../../../common/http';

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 25_000;

/** Hosts internos que nunca se deben pedir desde el server (anti-SSRF). */
function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (['localhost', '127.0.0.1', '::1', '0.0.0.0', 'metadata.google.internal'].includes(host)) {
    return true;
  }
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return false;
}

export interface FetchedPage {
  html: string;
  status: number;
  finalUrl: string;
  bytes: number;
  contentType: string;
}

/**
 * Descarga una URL para analizarla. Deliberadamente restringido: solo
 * http/https, sin hosts internos, con tope de tamaño y timeout, y presentándose
 * como navegador (los portales con WAF responden 403 a UAs no-navegador).
 */
export async function fetchPage(rawUrl: string): Promise<FetchedPage> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BadRequestException('La URL no es válida');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestException('Solo se permiten URLs http:// o https://');
  }
  if (isBlockedHost(url.hostname)) {
    throw new BadRequestException('Por seguridad no se permiten hosts internos/privados');
  }

  let res: Response;
  try {
    res = await fetch(url, {
      headers: browserHeaders(),
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new BadRequestException(
      `No se pudo descargar la URL: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!res.ok) {
    // El diagnóstico distingue "WAF con challenge" de "403 por headers": sin eso
    // el usuario termina cambiando el User-Agent para un problema que no es ese.
    const diagnosis = diagnoseBlock(res.status, res.headers);
    throw new BadRequestException(
      `El sitio respondió HTTP ${res.status}.${diagnosis ? ` ${diagnosis}` : ''}`,
    );
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) {
    throw new BadRequestException(
      `La página excede el tope de ${Math.round(MAX_BYTES / 1024 / 1024)} MB`,
    );
  }
  const contentType = res.headers.get('content-type') ?? '';
  const html = buf.toString('utf8');
  if (looksLikeChallenge(html)) {
    throw new BadRequestException(
      'La página devuelta es un challenge anti-bot (Cloudflare/WAF), no el listado. Este portal necesita una fuente por API/RSS oficial o con sesión de navegador.',
    );
  }
  if (!/<html|<body|<div|<article/i.test(html)) {
    throw new BadRequestException(
      'La respuesta no parece HTML (¿es una URL de listado? ¿requiere JavaScript?)',
    );
  }

  return {
    html,
    status: res.status,
    finalUrl: res.url || url.toString(),
    bytes: buf.byteLength,
    contentType,
  };
}

/**
 * Marcadores del interstitial de un challenge (Cloudflare, Imperva, DataDome).
 * Son cadenas específicas del challenge a propósito: "Un momento" suelto
 * aparece en textos legítimos en español.
 */
const CHALLENGE_MARKERS = [
  'challenges.cloudflare.com',
  'cf-chl',
  '__cf_chl',
  'cf-browser-verification',
  'just a moment...',
  'un momento…',
  '_incapsula_resource',
  'datadome',
];

/** La respuesta es un interstitial de WAF, no el contenido del sitio. */
export function looksLikeChallenge(html: string): boolean {
  const lower = html.toLowerCase();
  return CHALLENGE_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * Descarta selectores que cheerio podría aceptar pero el motor Rust no
 * (sintaxis de Playwright/jQuery, XPath o texto).
 */
export function isLikelyValidCss(selector: string): boolean {
  if (!selector || selector.length > 300) return false;
  const banned = [':has-text', ':contains', ':visible', ':eq(', '>>', 'xpath=', 'text=', '=0'];
  const lower = selector.toLowerCase();
  if (banned.some((b) => lower.includes(b))) return false;
  // Comillas/paréntesis balanceados y sin caracteres de control.
  const quotes = (selector.match(/["']/g) ?? []).length;
  if (quotes % 2 !== 0) return false;
  return !/[\u0000-\u001f]/.test(selector);
}
