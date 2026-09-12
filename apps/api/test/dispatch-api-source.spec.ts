import { describe, expect, it } from 'vitest';
import { STREAMS } from '../src/config/queue.config';
import { DispatchService } from '../src/modules/scheduler/dispatch.service';

/**
 * Cableado del dispatch. Lo crítico: una fuente `API_JSON` NO debe publicar en
 * `scraper:requests` (no hay nada que raspar y la API key no viaja por el
 * stream); publica el resultado ya armado en `scraper:results`, y un fallo de la
 * API se publica igual para que la ingesta marque la corrida como FAILED.
 */
const source = {
  id: 's1',
  name: 'Jooble',
  kind: 'API_JSON',
  baseUrl: 'https://co.jooble.org',
  listUrl: 'https://co.jooble.org/SearchResult?ukw=dev',
  selectors: { api: { url: 'https://jooble.org/api/{key}', mapping: { title: 't', url: 'u' } } },
  limits: {},
  intervalMinutes: 1440,
};

function makeDispatch(opts: { items?: unknown[]; error?: string } = {}) {
  const published: { stream: string; payload: Record<string, unknown> }[] = [];
  const runs: { status?: string; error?: string }[] = [];
  const prisma = {
    scrapeRun: {
      create: () => Promise.resolve({ id: 'r1' }),
      updateMany: (args: { data: { status?: string; error?: string } }) => {
        runs.push(args.data);
        return Promise.resolve({});
      },
    },
    source: { update: () => Promise.resolve({}) },
  };
  const redis = {
    xadd: (stream: string, _id: string, _field: string, payload: string) => {
      published.push({ stream, payload: JSON.parse(payload) as Record<string, unknown> });
      return Promise.resolve('1-1');
    },
  };
  const apiSource = {
    fetchItems: () =>
      opts.error
        ? Promise.reject(new Error(opts.error))
        : Promise.resolve({ items: opts.items ?? [], skipped: 0 }),
  };
  const notifications = { create: () => Promise.resolve({}) };
  const logger = { log: () => {}, error: () => {}, warn: () => {} };

  const service = new DispatchService(
    prisma as never,
    redis as never,
    notifications as never,
    apiSource as never,
    logger as never,
  );
  return { service, published, runs };
}

describe('DispatchService — fuentes por API', () => {
  it('publica el resultado en scraper:results (no en scraper:requests)', async () => {
    const { service, published } = makeDispatch({
      items: [{ url: 'https://co.jooble.org/jdp/1', title: 'Dev' }],
    });

    await service.dispatchSource(source as never);

    expect(published).toHaveLength(1);
    expect(published[0].stream).toBe(STREAMS.RESULTS);
    expect(published[0].payload.error).toBeNull();
    expect(published[0].payload.items).toHaveLength(1);
    // El requestId viaja para que la ingesta encuentre el ScrapeRun.
    expect(typeof published[0].payload.requestId).toBe('string');
  });

  it('un fallo de la API se publica con error para que la corrida quede FAILED', async () => {
    const { service, published } = makeDispatch({ error: 'Falta la variable de entorno X' });

    await service.dispatchSource(source as never);

    expect(published).toHaveLength(1);
    expect(published[0].stream).toBe(STREAMS.RESULTS);
    expect(published[0].payload.error).toMatch(/Falta la variable/);
    expect(published[0].payload.items).toEqual([]);
  });

  it('una fuente HTML sigue yendo al worker Rust', async () => {
    const { service, published } = makeDispatch();
    await service.dispatchSource({ ...source, kind: 'HTML_RECIPE' } as never);

    expect(published).toHaveLength(1);
    expect(published[0].stream).toBe(STREAMS.REQUESTS);
    // El payload del worker lleva la receta, no items.
    expect(published[0].payload.recipe).toBeDefined();
    expect(published[0].payload.items).toBeUndefined();
  });
});
