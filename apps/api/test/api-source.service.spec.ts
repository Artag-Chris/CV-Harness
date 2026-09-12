import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiSourceService } from '../src/modules/sources/api-source.service';

/**
 * Camino de red de las fuentes API. Se mockea `fetch` para no depender de
 * Jooble: lo que se prueba es que la key salga del entorno, que se pagine y que
 * los errores digan qué pasó.
 */
const source = {
  id: 's1',
  name: 'Jooble',
  kind: 'API_JSON',
  baseUrl: 'https://co.jooble.org',
  listUrl: 'https://co.jooble.org/SearchResult?ukw=desarrollador',
  selectors: {
    api: {
      url: 'https://jooble.org/api/{key}',
      method: 'POST',
      authEnv: 'JOOBLE_API_KEY',
      body: { keywords: 'desarrollador', page: '{{page}}' },
      itemsPath: 'jobs',
      mapping: { title: 'title', url: 'link', company: 'company' },
    },
  },
  // `retryDelayMs: 0` para que los tests de fallo no esperen el backoff real.
  limits: { maxPages: 3, delayMs: 0, timeoutMs: 5000, retryAttempts: 2, retryDelayMs: 0 },
};

const logger = { log: () => {}, error: () => {}, warn: () => {} };

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function job(id: string) {
  return { id, title: `Dev ${id}`, link: `https://co.jooble.org/jdp/${id}`, company: 'ACME' };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.JOOBLE_API_KEY;
});

describe('ApiSourceService', () => {
  it('consulta la API, pagina y mapea los items', async () => {
    process.env.JOOBLE_API_KEY = 'SECRET';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ jobs: [job('1'), job('2')] }))
      .mockResolvedValueOnce(jsonResponse({ jobs: [job('3')] }))
      // Tercera página vacía: corta la paginación aunque maxPages sea 3.
      .mockResolvedValue(jsonResponse({ jobs: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const service = new ApiSourceService(logger as never);
    const { items, skipped } = await service.fetchItems(source as never);

    expect(items).toHaveLength(3);
    expect(skipped).toBe(0);
    expect(items[0].title).toBe('Dev 1');
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // La key viaja en la ruta, nunca en la base de datos.
    expect(url).toBe('https://jooble.org/api/SECRET');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ keywords: 'desarrollador', page: '1' });
  });

  it('sin la key en el entorno falla con un mensaje que dice cuál falta', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const service = new ApiSourceService(logger as never);
    await expect(service.fetchItems(source as never)).rejects.toThrow(/JOOBLE_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reintenta cuando el WAF bloquea y termina trayendo los items', async () => {
    process.env.JOOBLE_API_KEY = 'SECRET';
    // Caso real medido contra Jooble: el endpoint alterna 403 (Just a moment…)
    // y 200 para el mismo request.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({}, 403, { 'cf-mitigated': 'challenge', server: 'cloudflare' }),
      )
      .mockResolvedValueOnce(jsonResponse({ jobs: [job('9')] }));
    vi.stubGlobal('fetch', fetchMock);

    const service = new ApiSourceService(logger as never);
    const { items } = await service.fetchItems({
      ...source,
      limits: { ...source.limits, maxPages: 1 },
    } as never);

    expect(items).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('no reintenta un error que no se arregla reintentando (404)', async () => {
    process.env.JOOBLE_API_KEY = 'SECRET';
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 404));
    vi.stubGlobal('fetch', fetchMock);

    const service = new ApiSourceService(logger as never);
    await expect(service.fetchItems(source as never)).rejects.toThrow(/404/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('un 403 persistente explica Cloudflare y sugiere revisar la key', async () => {
    process.env.JOOBLE_API_KEY = 'SECRET';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({}, 403, { 'cf-mitigated': 'challenge', server: 'cloudflare' }),
      ),
    );

    const service = new ApiSourceService(logger as never);
    await expect(service.fetchItems(source as never)).rejects.toThrow(/Cloudflare/i);
    await expect(service.fetchItems(source as never)).rejects.toThrow(/API key/i);
  });

  it('una respuesta que no es JSON se explica en vez de explotar', async () => {
    process.env.JOOBLE_API_KEY = 'SECRET';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>nope</html>', { status: 200 })),
    );

    const service = new ApiSourceService(logger as never);
    await expect(service.fetchItems(source as never)).rejects.toThrow(/no devolvió JSON/i);
  });

  it('una corrida con todos los items inválidos devuelve 0 y los cuenta', async () => {
    process.env.JOOBLE_API_KEY = 'SECRET';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ jobs: [{ title: 'sin link' }] })),
    );

    const service = new ApiSourceService(logger as never);
    const { items, skipped } = await service.fetchItems(source as never);
    expect(items).toHaveLength(0);
    expect(skipped).toBe(1);
  });
});
