import { BadRequestException, Injectable } from '@nestjs/common';
import type { Source } from '@prisma/client';
import { JsonLogger } from '../../common/json-logger.service';
import { browserJsonHeaders, diagnoseBlock } from '../../common/http';
import { originOf } from '../../common/url.util';
import {
  apiRequestHeaders,
  buildApiRequest,
  mapApiItems,
  parseApiSpec,
  type ApiSourceItem,
  type ApiSourceSpec,
} from './api-source';

const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_DELAY_MS = 500;
/** Tope duro de páginas: una fuente mal configurada no debe vaciar la cuota. */
const MAX_PAGES_CEILING = 20;

/**
 * Reintentos por defecto. Medido contra la API oficial de Jooble: su endpoint
 * está detrás de Cloudflare y **alterna** entre 200, 403 ("Just a moment…") y
 * 500 genérico para el mismo request, incluso mandando headers de navegador.
 * Sin reintentos, una corrida falla al azar; con 3 intentos entra.
 */
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 2500;
/** Estados que valen un reintento: bloqueo transitorio del WAF o fallo del portal. */
const RETRYABLE_STATUS = new Set([403, 408, 425, 429, 500, 502, 503, 504]);

interface ApiLimits {
  maxPages?: number;
  delayMs?: number;
  timeoutMs?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
}

interface RetryPolicy {
  attempts: number;
  delayMs: number;
}

/**
 * Consulta la API oficial de un portal y traduce su JSON al formato del pipeline.
 * Corre en Nest (no en el worker Rust) por dos razones: la API key vive en las
 * variables de entorno del API y nunca viaja por el stream, y no hay HTML que
 * parsear.
 */
@Injectable()
export class ApiSourceService {
  constructor(private readonly logger: JsonLogger) {}

  async fetchItems(source: Source): Promise<{ items: ApiSourceItem[]; skipped: number }> {
    const parsed = parseApiSpec(source.selectors);
    if (!parsed.ok) throw new BadRequestException(parsed.error);
    const spec = parsed.spec;

    const limits = (source.limits ?? {}) as ApiLimits;
    const maxPages = Math.min(Math.max(1, limits.maxPages ?? 1), MAX_PAGES_CEILING);
    const timeoutMs = limits.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const delayMs = limits.delayMs ?? DEFAULT_DELAY_MS;
    const retry: RetryPolicy = {
      attempts: Math.min(Math.max(1, limits.retryAttempts ?? DEFAULT_RETRY_ATTEMPTS), 5),
      delayMs: limits.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
    };
    const baseUrl = source.baseUrl?.trim() || originOf(source.listUrl);

    const apiKey = this.readApiKey(spec);

    const items: ApiSourceItem[] = [];
    let skipped = 0;

    for (let page = 1; page <= maxPages; page += 1) {
      if (page > 1 && delayMs > 0) await sleep(delayMs);
      const page_items = await this.fetchPage(spec, page, apiKey, baseUrl, timeoutMs, retry);
      items.push(...page_items.items);
      skipped += page_items.skipped;
      // Una página vacía significa que no hay más resultados: no seguir pidiendo.
      if (page_items.items.length === 0) break;
    }

    this.logger.log(
      {
        msg: 'fuente API consultada',
        sourceId: source.id,
        sourceName: source.name,
        pages: maxPages,
        items: items.length,
        skipped,
      },
      ApiSourceService.name,
    );
    return { items, skipped };
  }

  private async fetchPage(
    spec: ApiSourceSpec,
    page: number,
    apiKey: string | null,
    baseUrl: string,
    timeoutMs: number,
    retry: RetryPolicy,
  ): Promise<{ items: ApiSourceItem[]; skipped: number }> {
    const request = buildApiRequest(spec, page, apiKey);
    const headers = apiRequestHeaders(spec, apiKey, browserJsonHeaders());
    let lastError = '';

    for (let attempt = 1; attempt <= retry.attempts; attempt += 1) {
      if (attempt > 1) {
        const waitMs = retry.delayMs * 2 ** (attempt - 2);
        this.logger.warn(
          { msg: 'reintentando consulta a la API', url: request.url, attempt, waitMs },
          ApiSourceService.name,
        );
        await sleep(waitMs);
      }

      let res: Response;
      try {
        res = await fetch(request.url, {
          method: request.method,
          headers,
          ...(request.method === 'POST' && request.body
            ? { body: JSON.stringify(request.body) }
            : {}),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        lastError = `No se pudo consultar la API (${request.url}): ${
          err instanceof Error ? err.message : String(err)
        }`;
        continue;
      }

      if (!res.ok) {
        const diagnosis = diagnoseBlock(res.status, res.headers);
        lastError = `La API respondió HTTP ${res.status}.${diagnosis ? ` ${diagnosis}` : ''}${
          res.status === 403 && apiKey ? ' Revisá que la API key siga vigente.' : ''
        }`;
        // Los bloqueos del WAF son intermitentes: se reintenta. Un 404 o un 400
        // no se arreglan reintentando.
        if (RETRYABLE_STATUS.has(res.status)) continue;
        throw new BadRequestException(lastError);
      }

      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw new BadRequestException(
          'La API no devolvió JSON. ¿La URL del endpoint es la correcta (suele incluir la key)?',
        );
      }

      if (attempt > 1) {
        this.logger.log(
          { msg: 'la API respondió tras reintentar', url: request.url, attempt },
          ApiSourceService.name,
        );
      }
      return mapApiItems(json, spec, baseUrl);
    }

    throw new BadRequestException(
      `${lastError} (reintenté ${retry.attempts} veces${
        retry.attempts > 1 ? ' con backoff' : ''
      }).`,
    );
  }

  /** La key se referencia por nombre de env var; nunca se guarda en la base. */
  private readApiKey(spec: ApiSourceSpec): string | null {
    if (!spec.authEnv) return null;
    const value = process.env[spec.authEnv]?.trim();
    if (!value) {
      throw new BadRequestException(
        `Falta la variable de entorno ${spec.authEnv} con la API key de esta fuente.`,
      );
    }
    return value;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
