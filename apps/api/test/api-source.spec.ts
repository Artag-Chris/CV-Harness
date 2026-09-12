import { describe, expect, it } from 'vitest';
import {
  apiRequestHeaders,
  buildApiRequest,
  mapApiItems,
  parseApiSpec,
  readPath,
  unwrapApiSpec,
} from '../src/modules/sources/api-source';

/**
 * Fuentes por API oficial. Lo crítico: la key sale del entorno y nunca de la BD,
 * el mapeo no inventa items sin URL, y `{{page}}` pagina de verdad.
 */
const spec = {
  url: 'https://jooble.org/api/{key}',
  method: 'POST',
  authEnv: 'JOOBLE_API_KEY',
  body: { keywords: 'desarrollador', location: 'Colombia', page: '{{page}}' },
  itemsPath: 'jobs',
  mapping: { title: 'title', url: 'link', company: 'company', description: 'snippet' },
};

const wrapped = { api: spec };

describe('spec de fuente API', () => {
  it('desenvuelve y valida la spec guardada en selectors', () => {
    expect(unwrapApiSpec(wrapped)).toEqual(spec);
    const parsed = parseApiSpec(wrapped);
    expect(parsed.ok).toBe(true);
  });

  it('rechaza una spec sin mapping de url con un mensaje legible', () => {
    const parsed = parseApiSpec({ api: { url: 'https://x.com/a', mapping: { title: 't' } } });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/mapping\.url/);
  });

  it('rechaza selectors que no son de API', () => {
    const parsed = parseApiSpec({ item: '.card', title: 'h2' });
    expect(parsed.ok).toBe(false);
  });
});

describe('readPath', () => {
  it('lee rutas con puntos y arrays', () => {
    expect(readPath({ a: { b: [{ c: 7 }] } }, 'a.b.0.c')).toBe(7);
    expect(readPath({ a: 1 }, 'a.b.c')).toBeUndefined();
  });
});

describe('armado de la petición', () => {
  it('inyecta la key en la ruta e interpola la página', () => {
    const parsed = parseApiSpec(wrapped);
    if (!parsed.ok) throw new Error('spec inválida');
    const req = buildApiRequest(parsed.spec, 3, 'SECRET');
    expect(req.url).toBe('https://jooble.org/api/SECRET');
    expect(req.method).toBe('POST');
    expect(req.body).toEqual({ keywords: 'desarrollador', location: 'Colombia', page: '3' });
  });

  it('sin {key} usa authQuery, y sin authQuery manda Bearer', () => {
    const base = { url: 'https://x.com/jobs', mapping: { title: 't', url: 'u' } };
    const byQuery = parseApiSpec({
      api: { ...base, method: 'GET', authQuery: 'api_key', query: { page: '{{page}}' } },
    });
    if (!byQuery.ok) throw new Error('spec inválida');
    const req = buildApiRequest(byQuery.spec, 2, 'K');
    expect(req.url).toBe('https://x.com/jobs?api_key=K&page=2');

    const byHeader = parseApiSpec({ api: base });
    if (!byHeader.ok) throw new Error('spec inválida');
    const headers = apiRequestHeaders(byHeader.spec, 'K', { Accept: 'application/json' });
    expect(headers.Authorization).toBe('Bearer K');
    expect(headers.Accept).toBe('application/json');
  });

  it('nunca deja la key en las cabeceras si ya fue en la ruta', () => {
    const parsed = parseApiSpec(wrapped);
    if (!parsed.ok) throw new Error('spec inválida');
    const headers = apiRequestHeaders(parsed.spec, 'SECRET', {});
    expect(headers.Authorization).toBeUndefined();
  });
});

describe('mapeo de items', () => {
  it('traduce el JSON de Jooble al formato del pipeline', () => {
    const parsed = parseApiSpec(wrapped);
    if (!parsed.ok) throw new Error('spec inválida');
    const json = {
      totalCount: 2,
      jobs: [
        {
          id: '123',
          title: 'Desarrollador Node',
          link: 'https://co.jooble.org/jdp/123',
          company: 'ACME',
          location: 'Bogotá',
          snippet: 'Buscamos dev',
        },
        { id: '124', title: 'Sin link' },
      ],
    };
    const { items, skipped } = mapApiItems(json, parsed.spec, 'https://co.jooble.org');
    expect(items).toHaveLength(1);
    expect(skipped).toBe(1);
    expect(items[0]).toMatchObject({
      title: 'Desarrollador Node',
      url: 'https://co.jooble.org/jdp/123',
      company: 'ACME',
      descriptionText: 'Buscamos dev',
      // `externalId` no está en el mapping → cae a la URL (dedup estable).
      externalId: 'https://co.jooble.org/jdp/123',
    });
  });

  it('absolutiza relativas y descarta lo que no sea una URL web', () => {
    const parsed = parseApiSpec({
      api: { url: 'https://x.com/a', mapping: { title: 't', url: 'u' } },
    });
    if (!parsed.ok) throw new Error('spec inválida');
    const { items, skipped } = mapApiItems(
      [
        { t: 'A', u: '/job/1' },
        // Un `mailto:` o un `javascript:` resuelven como URL válida pero no son ofertas.
        { t: 'B', u: 'mailto:jobs@acme.com' },
        { t: 'C' },
      ],
      parsed.spec,
      'https://x.com',
    );
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe('https://x.com/job/1');
    expect(skipped).toBe(2);
  });

  it('acepta campos anidados tipo { name } y arrays de texto', () => {
    const parsed = parseApiSpec({
      api: {
        url: 'https://x.com/a',
        mapping: { title: 'title', url: 'u', location: 'city.name', salary: 'tags' },
      },
    });
    if (!parsed.ok) throw new Error('spec inválida');
    const { items } = mapApiItems(
      [
        {
          title: 'Dev',
          u: 'https://x.com/1',
          city: { name: 'Medellín' },
          tags: ['Full-time', 'Senior'],
        },
      ],
      parsed.spec,
      'https://x.com',
    );
    expect(items[0].location).toBe('Medellín');
    expect(items[0].salary).toBe('Full-time, Senior');
  });
});
