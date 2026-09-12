import { z } from 'zod';

/**
 * Fuente que se alimenta de la API/RSS oficial de un portal en vez de raspar
 * HTML. Es la vía correcta cuando el sitio está detrás de un WAF con challenge:
 * no se pelea con la protección, se usa el canal que el portal publica.
 *
 * La spec vive en `Source.selectors` (documentado: "receta" de la fuente) cuando
 * `Source.kind === 'API_JSON'`. La key NUNCA se guarda en la base: se referencia
 * por nombre de variable de entorno (`authEnv`).
 */

export const API_SOURCE_KIND = 'API_JSON';

const HttpMethodSchema = z.enum(['GET', 'POST']);

export const ApiSourceSpecSchema = z.object({
  /** Endpoint. Admite `{key}` si la key va en la ruta (estilo Jooble). */
  url: z.string().url(),
  method: HttpMethodSchema.default('POST'),
  /** Variable de entorno con la API key (ej. JOOBLE_API_KEY). */
  authEnv: z.string().trim().min(1).optional(),
  /**
   * Cómo viaja la key cuando no va en la URL ni en el query:
   * - `bearer` (default): `Authorization: Bearer <key>`.
   * - `basic`: `Authorization: Basic base64(<key>:)` — Careerjet la exige así
   *   (`curl -u <API_KEY>:`), con el password vacío.
   */
  auth: z.enum(['bearer', 'basic']).default('bearer'),
  /** Nombre del query param donde va la key, si va por query. */
  authQuery: z.string().trim().min(1).optional(),
  headers: z.record(z.string()).optional(),
  /** Body JSON de la petición; los strings admiten `{{page}}`. */
  body: z.record(z.unknown()).optional(),
  /** Query params; los valores admiten `{{page}}`. */
  query: z.record(z.string()).optional(),
  /** Ruta al array de resultados dentro del JSON (ej. "jobs"). */
  itemsPath: z.string().trim().min(1).optional(),
  /** Campo destino → ruta en el JSON devuelto. */
  mapping: z.object({
    title: z.string().trim().min(1),
    url: z.string().trim().min(1),
    company: z.string().trim().min(1).optional(),
    location: z.string().trim().min(1).optional(),
    salary: z.string().trim().min(1).optional(),
    postedAt: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).optional(),
    applyUrl: z.string().trim().min(1).optional(),
    externalId: z.string().trim().min(1).optional(),
    /**
     * Portal donde está publicado el aviso original. Los agregadores (Jooble)
     * lo devuelven en un campo propio: saber que la vacante vive en otro sitio
     * es lo que evita buscar a ciegas.
     */
    originSource: z.string().trim().min(1).optional(),
  }),
});

export type ApiSourceSpec = z.infer<typeof ApiSourceSpecSchema>;

/** Item en el mismo formato que publica el worker Rust en `scraper:results`. */
export interface ApiSourceItem {
  externalId?: string | null;
  url: string;
  title: string;
  company?: string | null;
  location?: string | null;
  salary?: string | null;
  postedAt?: string | null;
  descriptionText?: string | null;
  applyUrl?: string | null;
  originSource?: string | null;
}

export interface ApiRequestParts {
  url: string;
  method: 'GET' | 'POST';
  body?: Record<string, unknown>;
}

/** ¿La spec tiene forma de fuente de API? (para ramificar por `kind`). */
export function isApiSpec(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value) && 'api' in value;
}

/**
 * La spec se guarda como `{ api: { … } }` para convivir con el shape de
 * `selectors` y ser evidente en el editor JSON del dashboard.
 */
export function unwrapApiSpec(selectors: unknown): unknown {
  if (!isApiSpec(selectors)) return null;
  return (selectors as { api: unknown }).api;
}

/** Valida la spec y devuelve un mensaje legible si no sirve. */
export function parseApiSpec(
  selectors: unknown,
): { ok: true; spec: ApiSourceSpec } | { ok: false; error: string } {
  const raw = unwrapApiSpec(selectors);
  if (!raw) return { ok: false, error: 'La fuente API necesita un objeto "api" con la config' };
  const parsed = ApiSourceSpecSchema.safeParse(raw);
  if (parsed.success) return { ok: true, spec: parsed.data };
  const detail = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || 'api'}: ${issue.message}`)
    .join('; ');
  return { ok: false, error: `Spec de API inválida — ${detail}` };
}

/**
 * Lee una ruta con puntos dentro del JSON: `"company.name"`, `"items.0.link"`.
 * Devuelve `undefined` si algún tramo no existe (no lanza).
 */
export function readPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const segment of path.split('.')) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Reemplaza `{{page}}` (y cualquier `{{clave}}` de `vars`) en un valor. */
export function interpolate(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === 'string') {
    return value.replace(/\{\{(\w+)\}\}/g, (match, key: string) => vars[key] ?? match);
  }
  if (Array.isArray(value)) return value.map((item) => interpolate(item, vars));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        interpolate(item, vars),
      ]),
    );
  }
  return value;
}

/**
 * Arma la petición de una página. La key se inyecta acá: en la URL si la spec
 * usa `{key}`, en el query si define `authQuery`, o como header `Authorization`
 * si no. Nunca se loguea.
 */
export function buildApiRequest(
  spec: ApiSourceSpec,
  page: number,
  apiKey: string | null,
): ApiRequestParts {
  const vars = { page: String(page) };
  let url = spec.url;
  const query = new URLSearchParams();

  if (apiKey && url.includes('{key}')) {
    url = url.replace('{key}', encodeURIComponent(apiKey));
  } else if (apiKey && spec.authQuery) {
    query.set(spec.authQuery, apiKey);
  }

  const specQuery = interpolate(spec.query ?? {}, vars) as Record<string, string>;
  for (const [key, value] of Object.entries(specQuery)) query.set(key, String(value));

  const queryString = query.toString();
  if (queryString) url += (url.includes('?') ? '&' : '?') + queryString;

  if (spec.method === 'POST') {
    const body = interpolate(spec.body ?? {}, vars) as Record<string, unknown>;
    return { url, method: 'POST', body };
  }
  return { url, method: 'GET' };
}

/** Cabeceras de la petición, incluyendo la key si va por header. */
export function apiRequestHeaders(
  spec: ApiSourceSpec,
  apiKey: string | null,
  base: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = { ...spec.headers };
  const keyInUrl = spec.url.includes('{key}');
  if (apiKey && !keyInUrl && !spec.authQuery) {
    headers.Authorization =
      spec.auth === 'basic'
        ? `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`
        : `Bearer ${apiKey}`;
  }
  return { ...base, ...headers };
}

/**
 * Traduce el JSON del portal a los items del pipeline. Descarta lo que no se
 * pueda usar (sin título o sin URL): es preferible perder un item que ensuciar
 * la base con vacantes vacías.
 */
export function mapApiItems(
  json: unknown,
  spec: ApiSourceSpec,
  baseUrl: string,
): { items: ApiSourceItem[]; skipped: number } {
  const container = spec.itemsPath ? readPath(json, spec.itemsPath) : json;
  const rows = Array.isArray(container)
    ? container
    : // Algunos portales envuelven el array en un objeto de un solo campo.
      container && typeof container === 'object'
      ? Object.values(container).find((value) => Array.isArray(value))
      : undefined;
  if (!Array.isArray(rows)) return { items: [], skipped: 0 };

  const items: ApiSourceItem[] = [];
  let skipped = 0;

  for (const row of rows) {
    const title = asText(readPath(row, spec.mapping.title));
    const rawUrl = asText(readPath(row, spec.mapping.url));
    const url = absoluteUrl(rawUrl, baseUrl);
    if (!title || !url) {
      skipped += 1;
      continue;
    }
    const description = spec.mapping.description
      ? asText(readPath(row, spec.mapping.description))
      : null;
    items.push({
      externalId: spec.mapping.externalId
        ? asText(readPath(row, spec.mapping.externalId))
        : url,
      url,
      title,
      company: spec.mapping.company ? asText(readPath(row, spec.mapping.company)) : null,
      location: spec.mapping.location ? asText(readPath(row, spec.mapping.location)) : null,
      salary: spec.mapping.salary ? asText(readPath(row, spec.mapping.salary)) : null,
      postedAt: spec.mapping.postedAt ? asText(readPath(row, spec.mapping.postedAt)) : null,
      descriptionText: description,
      applyUrl: spec.mapping.applyUrl
        ? absoluteUrl(asText(readPath(row, spec.mapping.applyUrl)), baseUrl)
        : url,
      originSource: spec.mapping.originSource
        ? asText(readPath(row, spec.mapping.originSource))
        : null,
    });
  }
  return { items, skipped };
}

/** Normaliza a texto plano: los portales devuelven números, nulls y objetos. */
function asText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(asText).filter((v): v is string => !!v);
    return parts.length > 0 ? parts.join(', ') : null;
  }
  if (value && typeof value === 'object') {
    // Campos tipo `{ name: "Bogotá" }` frecuentes en APIs.
    for (const key of ['name', 'title', 'value', 'label']) {
      const nested = asText((value as Record<string, unknown>)[key]);
      if (nested) return nested;
    }
    return null;
  }
  return null;
}

/**
 * Absolutiza contra el origen del portal y descarta lo que no sea una URL web:
 * una API puede devolver `mailto:` o `javascript:` y eso no es una vacante.
 */
function absoluteUrl(raw: string | null, baseUrl: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}
