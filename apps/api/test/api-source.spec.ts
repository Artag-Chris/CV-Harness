import { describe, expect, it } from 'vitest';
import {
  apiRequestHeaders,
  buildApiRequest,
  mapApiItems,
  parseApiSpec,
  readPath,
  unwrapApiSpec,
} from '../src/modules/sources/api-source';
import { SOURCE_TEMPLATES } from '../src/modules/sources/sources.templates';

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

  it('con auth basic manda usuario=key y password vacío', () => {
    const parsed = parseApiSpec({
      api: {
        url: 'https://search.api.careerjet.net/v4/query',
        method: 'GET',
        authEnv: 'CAREERJET_API_KEY',
        auth: 'basic',
        mapping: { title: 'title', url: 'url' },
      },
    });
    if (!parsed.ok) throw new Error('spec inválida');
    const headers = apiRequestHeaders(parsed.spec, 'K', {});

    expect(headers.Authorization).toBe('Basic Szo=');
    expect(Buffer.from(headers.Authorization!.replace('Basic ', ''), 'base64').toString()).toBe(
      'K:',
    );
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

  it('guarda el portal de origen que informa el agregador', () => {
    // Jooble devuelve `source: "fitly.work"`: la vacante está publicada en OTRO
    // sitio, y sin ese dato hay que buscarla a ciegas.
    const parsed = parseApiSpec({
      api: {
        url: 'https://jooble.org/api/{key}',
        mapping: { title: 'title', url: 'link', originSource: 'source' },
      },
    });
    if (!parsed.ok) throw new Error('spec inválida');
    const { items } = mapApiItems(
      [
        {
          title: 'Full Stack Developer',
          link: 'https://jooble.org/away/1',
          source: 'fitly.work',
        },
      ],
      parsed.spec,
      'https://jooble.org',
    );
    expect(items[0].originSource).toBe('fitly.work');
  });

  it('deja originSource en null si la spec no lo mapea', () => {
    const parsed = parseApiSpec({
      api: { url: 'https://x.com/a', mapping: { title: 't', url: 'u' } },
    });
    if (!parsed.ok) throw new Error('spec inválida');
    const { items } = mapApiItems(
      [{ t: 'A', u: 'https://x.com/1', source: 'irrelevante' }],
      parsed.spec,
      'https://x.com',
    );
    expect(items[0].originSource).toBeNull();
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

/**
 * La plantilla de Careerjet es la vía para los portales que no se pueden raspar
 * (Indeed, LinkedIn). Como no se puede probar sin key, se fija acá el contrato
 * documentado de la API v4: Basic auth, locale es_CO, `user_ip`/`user_agent`
 * obligatorios (sin ellos responde 403) y el mapeo del array `jobs`.
 */
describe('plantilla Careerjet / OpcionEmpleo', () => {
  const template = SOURCE_TEMPLATES.find((tpl) => tpl.id === 'careerjet-co');

  function spec() {
    if (!template) throw new Error('falta la plantilla careerjet-co');
    const parsed = parseApiSpec(template.selectors);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.spec;
  }

  it('queda como fuente API con Basic auth y locale de Colombia', () => {
    expect(template?.kind).toBe('API_JSON');
    const parsed = spec();
    expect(parsed.auth).toBe('basic');
    expect(parsed.url).toBe('https://search.api.careerjet.net/v4/query');
    expect(parsed.method).toBe('GET');

    const req = buildApiRequest(parsed, 2, 'KEY');
    expect(req.url).toContain('locale_code=es_CO');
    expect(req.url).toContain('keywords=desarrollador');
    expect(req.url).toContain('page=2');
    // Obligatorios: sin ellos la API responde 403.
    expect(req.url).toContain('user_ip=');
    expect(req.url).toContain('user_agent=');

    const headers = apiRequestHeaders(parsed, 'KEY', {});
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('KEY:').toString('base64')}`);
    expect(headers.Referer).toBeTruthy();
  });

  it('traduce un payload de la API (array jobs)', () => {
    const json = {
      type: 'JOBS',
      hits: 1,
      pages: 1,
      jobs: [
        {
          title: 'Desarrollador Full Stack',
          company: 'ACME SAS',
          date: 'Wed,15 Nov 2025 19:13:43 GMT',
          description: 'Buscamos dev con Node y Postgres',
          locations: 'Bogotá',
          salary: '$ 8.000.000 - 10.000.000',
          url: 'https://jobviewtrack.com/v2/abc123',
        },
      ],
    };

    const { items, skipped } = mapApiItems(json, spec(), 'https://www.opcionempleo.com.co');

    expect(skipped).toBe(0);
    expect(items[0]).toMatchObject({
      title: 'Desarrollador Full Stack',
      url: 'https://jobviewtrack.com/v2/abc123',
      company: 'ACME SAS',
      location: 'Bogotá',
      salary: '$ 8.000.000 - 10.000.000',
      postedAt: 'Wed,15 Nov 2025 19:13:43 GMT',
      descriptionText: 'Buscamos dev con Node y Postgres',
    });
  });

  it('una respuesta de ambigüedad de ubicación (type LOCATIONS) no rompe', () => {
    const { items } = mapApiItems(
      { type: 'LOCATIONS', locations: ['Bogotá', 'Bogotá D.C.'], message: 'multiple locations found' },
      spec(),
      'https://www.opcionempleo.com.co',
    );
    expect(items).toEqual([]);
  });
});
