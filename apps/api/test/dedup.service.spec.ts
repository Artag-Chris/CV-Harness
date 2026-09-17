import { describe, expect, it } from 'vitest';
import { DedupService } from '../src/modules/dedup/dedup.service';

type Row = Record<string, unknown>;

/**
 * Pase de dedup: rellena `canonicalUrl`/`dupKey` de las filas viejas y marca
 * como duplicado lo que comparte clave de contenido (el canónico es el más
 * viejo). No borra nada.
 */
function makeService(opts: { backfillRows?: Row[]; candidateRows?: Row[] } = {}) {
  const updates: { where: { id: string }; data: Row }[] = [];

  const prisma = {
    vacancy: {
      findMany: (args: { where: Row }) => {
        const where = args.where as { OR?: Row[] };
        return Promise.resolve(
          Array.isArray(where.OR) ? (opts.backfillRows ?? []) : (opts.candidateRows ?? []),
        );
      },
      update: (args: { where: { id: string }; data: Row }) => {
        updates.push(args);
        return Promise.resolve({});
      },
    },
  };

  const service = new DedupService(
    prisma as never,
    { log: () => {}, error: () => {}, warn: () => {} } as never,
  );
  return { service, updates };
}

describe('DedupService.backfill', () => {
  it('calcula canonicalUrl y dupKey de las filas viejas', async () => {
    const { service, updates } = makeService({
      backfillRows: [
        {
          id: 'v1',
          url: 'https://WWW.Example.com/job/1/?utm_source=x#frag',
          title: 'Backend Developer',
          company: 'Acme',
          location: 'Bogotá',
        },
      ],
    });

    const count = await service.backfill();

    expect(count).toBe(1);
    expect(updates[0]).toEqual({
      where: { id: 'v1' },
      data: {
        canonicalUrl: 'https://example.com/job/1',
        dupKey: 'backend developer|acme|bogota',
      },
    });
  });

  it('usa cadena vacía cuando no se puede calcular (no se re-lee en cada pase)', async () => {
    const { service, updates } = makeService({
      backfillRows: [{ id: 'v2', url: '', title: 'X', company: null, location: null }],
    });

    await service.backfill();

    expect(updates[0].data).toEqual({ canonicalUrl: '', dupKey: '' });
  });
});

describe('DedupService.markDuplicates', () => {
  it('marca los repetidos contra el canónico más viejo', async () => {
    const { service, updates } = makeService({
      candidateRows: [
        { id: 'old', dupKey: 'dev|acme|' },
        { id: 'new', dupKey: 'dev|acme|' },
        { id: 'solo', dupKey: 'otro|acme|' },
        { id: 'sin-clave', dupKey: '' },
      ],
    });

    const marked = await service.markDuplicates();

    expect(marked).toBe(1);
    expect(updates).toEqual([{ where: { id: 'new' }, data: { duplicateOfId: 'old' } }]);
  });

  it('no marca nada cuando todas las claves son únicas', async () => {
    const { service, updates } = makeService({
      candidateRows: [
        { id: 'a', dupKey: 'a|x|' },
        { id: 'b', dupKey: 'b|x|' },
      ],
    });

    expect(await service.markDuplicates()).toBe(0);
    expect(updates).toHaveLength(0);
  });
});

describe('DedupService.run', () => {
  it('resume el trabajo de backfill y marcado', async () => {
    const { service } = makeService({
      backfillRows: [{ id: 'v1', url: 'https://x.com/1', title: 'T', company: 'C', location: null }],
      candidateRows: [
        { id: 'old', dupKey: 'k' },
        { id: 'new', dupKey: 'k' },
      ],
    });

    expect(await service.run()).toEqual({ backfilled: 1, marked: 1 });
  });
});
