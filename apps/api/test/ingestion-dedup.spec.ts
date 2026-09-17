import { describe, expect, it } from 'vitest';
import { IngestionService } from '../src/modules/ingestion/ingestion.service';

type Row = Record<string, unknown>;

/**
 * Dedup en la ingesta: la URL canónica y el id del portal evitan crear la fila;
 * el mismo título+empresa en otro portal se guarda MARCADO y sin encolar el
 * pipeline (ahorra normalización + match).
 */
function makeService(opts: { urlMatch?: Row | null; contentMatch?: Row | null } = {}) {
  const created: Row[] = [];
  const normalizeJobs: { data: unknown; opts: { jobId?: string } }[] = [];
  const urlConditions: Row[] = [];

  const prisma = {
    scrapeRun: {
      findUnique: () => Promise.resolve({ id: 'run1', sourceId: 's1' }),
      update: () => Promise.resolve({}),
    },
    source: {
      findUnique: () => Promise.resolve({ id: 's1', name: 'Fuente', kind: 'HTML_RECIPE' }),
    },
    vacancy: {
      findFirst: (args: { where: Row }) => {
        const where = args.where as { OR?: Row[]; dupKey?: string };
        if (Array.isArray(where.OR)) {
          urlConditions.push(...where.OR);
          return Promise.resolve(opts.urlMatch ?? null);
        }
        if (where.dupKey != null) return Promise.resolve(opts.contentMatch ?? null);
        return Promise.resolve(null);
      },
      create: (args: { data: Row }) => {
        const row = { id: `v${created.length + 1}`, ...args.data };
        created.push(row);
        return Promise.resolve(row);
      },
    },
  };

  const service = new IngestionService(
    prisma as never,
    { create: () => Promise.resolve({}) } as never,
    {
      add: (_n: string, data: unknown, o: { jobId?: string }) => {
        normalizeJobs.push({ data, opts: o });
        return Promise.resolve({});
      },
    } as never,
    { log: () => {}, error: () => {}, warn: () => {} } as never,
  );
  return { service, created, normalizeJobs, urlConditions };
}

const ITEM = {
  url: 'https://x.com/job/1?utm_source=li',
  title: 'Backend Developer',
  company: 'Acme',
  location: 'Remoto',
  descriptionText: 'Buscamos backend',
};

function payload(overrides: Row = {}) {
  return { requestId: 'r1', items: [{ ...ITEM, ...overrides }] };
}

describe('IngestionService — dedup', () => {
  it('no crea otra fila cuando el aviso ya existe por URL canónica', async () => {
    const { service, created, normalizeJobs } = makeService({
      urlMatch: { id: 'v-old', status: 'NORMALIZED' },
    });

    await service.processResult(payload());

    expect(created).toHaveLength(0);
    expect(normalizeJobs).toHaveLength(0);
  });

  it('re-encola la normalización si la existente quedó RAW', async () => {
    const { service, created, normalizeJobs } = makeService({
      urlMatch: { id: 'v-raw', status: 'RAW' },
    });

    await service.processResult(payload());

    expect(created).toHaveLength(0);
    expect(normalizeJobs[0].opts.jobId).toBe('normalize-v-raw');
  });

  it('la búsqueda consulta la huella, la URL canónica y el id del portal', async () => {
    const { service, urlConditions } = makeService();

    await service.processResult(payload({ externalId: 'JOB-1' }));

    // La URL se consulta sin el tracking (misma forma que el resto del dedup).
    expect(urlConditions.some((c) => c.canonicalUrl === 'https://x.com/job/1')).toBe(true);
    expect(
      urlConditions.some((c) => c.sourceId === 's1' && c.externalId === 'JOB-1'),
    ).toBe(true);
  });

  it('marca como duplicado de contenido y NO encola el pipeline', async () => {
    const { service, created, normalizeJobs } = makeService({
      contentMatch: { id: 'v-canon' },
    });

    await service.processResult(payload());

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      duplicateOfId: 'v-canon',
      canonicalUrl: 'https://x.com/job/1',
      dupKey: 'backend developer|acme|remoto',
    });
    expect(normalizeJobs).toHaveLength(0);
  });

  it('crea y encola normalización cuando el aviso es nuevo', async () => {
    const { service, created, normalizeJobs } = makeService();

    await service.processResult(payload());

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      duplicateOfId: null,
      canonicalUrl: 'https://x.com/job/1',
      dupKey: 'backend developer|acme|remoto',
    });
    expect(normalizeJobs).toHaveLength(1);
    expect(normalizeJobs[0].opts.jobId).toBe('normalize-v1');
  });
});
