import { beforeEach, describe, expect, it } from 'vitest';
import { ProfileBackfillService } from '../src/modules/profiles/profile-backfill.service';

/**
 * Backfill = re-evaluar vacantes ya guardadas contra un perfil. Se verifican
 * las tres reglas que importan: a quién le tocan, que sea idempotente y que no
 * dispare una llamada de IA por vacante sin tope.
 */
function makeService(opts: {
  profile?: { id: string; isPrimary: boolean } | null;
  selectedSourceIds?: string[];
  orphanSourceIds?: string[];
  candidates?: number;
  batchIds?: string[];
}) {
  const added: { name: string; data: unknown; opts: unknown }[] = [];
  const upserts: unknown[] = [];
  const captured: { where?: Record<string, unknown> } = {};

  const prisma = {
    profile: {
      findUnique: () => Promise.resolve(opts.profile ?? null),
    },
    profileSource: {
      findMany: () => Promise.resolve((opts.selectedSourceIds ?? []).map((sourceId) => ({ sourceId }))),
    },
    source: {
      findMany: () => Promise.resolve((opts.orphanSourceIds ?? []).map((id) => ({ id }))),
    },
    vacancy: {
      count: (args: { where: Record<string, unknown> }) => {
        captured.where = args.where;
        return Promise.resolve(opts.candidates ?? 0);
      },
      findMany: () => Promise.resolve((opts.batchIds ?? []).map((id) => ({ id }))),
    },
    vacancyProfile: {
      upsert: (args: unknown) => {
        upserts.push(args);
        return Promise.resolve({});
      },
    },
  };
  const queue = {
    add: (name: string, data: unknown, jobOpts: unknown) => {
      added.push({ name, data, opts: jobOpts });
      return Promise.resolve({});
    },
  };
  const logger = { log: () => {}, error: () => {}, warn: () => {} };

  return {
    service: new ProfileBackfillService(prisma as never, queue as never, logger as never),
    added,
    upserts,
    captured,
  };
}

describe('ProfileBackfillService', () => {
  let base: {
    profile: { id: string; isPrimary: boolean };
    selectedSourceIds: string[];
    candidates: number;
    batchIds: string[];
  };

  beforeEach(() => {
    base = {
      profile: { id: 'p-juan', isPrimary: false },
      selectedSourceIds: ['s1'],
      candidates: 3,
      batchIds: ['v1', 'v2', 'v3'],
    };
  });

  it('encola un match por vacante sin evaluar, con jobId único', async () => {
    const { service, added, upserts } = makeService(base);
    const result = await service.enqueueForProfile('p-juan');

    expect(result).toEqual({ candidates: 3, enqueued: 3, remaining: 0 });
    expect(upserts).toHaveLength(3);
    expect(added).toHaveLength(3);
    expect(added[0]).toMatchObject({
      data: { vacancyId: 'v1', profileId: 'p-juan' },
      opts: { jobId: 'match-v1-p-juan' },
    });
  });

  it('reporta cuántas quedan cuando supera el tope de la corrida', async () => {
    const { service } = makeService({ ...base, candidates: 500, batchIds: ['v1', 'v2'] });
    const result = await service.enqueueForProfile('p-juan');
    expect(result).toEqual({ candidates: 500, enqueued: 2, remaining: 498 });
  });

  it('sin fuentes tildadas no hace nada (y no toca la cola)', async () => {
    const { service, added } = makeService({
      profile: { id: 'p-juan', isPrimary: false },
      selectedSourceIds: [],
    });
    const result = await service.enqueueForProfile('p-juan');
    expect(result).toEqual({ candidates: 0, enqueued: 0, remaining: 0 });
    expect(added).toHaveLength(0);
  });

  it('el perfil primario también cubre las fuentes que nadie tildó', async () => {
    const { service, captured } = makeService({
      profile: { id: 'p-juan', isPrimary: true },
      selectedSourceIds: ['s1'],
      orphanSourceIds: ['s2', 's3'],
      candidates: 1,
      batchIds: ['v1'],
    });
    await service.enqueueForProfile('p-juan');
    expect(captured.where).toMatchObject({ sourceId: { in: ['s1', 's2', 's3'] } });
  });

  it('solo toma vacantes ya normalizadas y sin evaluación previa del perfil', async () => {
    const { service, captured } = makeService(base);
    await service.enqueueForProfile('p-juan');
    expect(captured.where).toMatchObject({
      status: { in: ['NORMALIZED', 'MATCHED', 'RESUME_READY'] },
      vacancyProfiles: { none: { profileId: 'p-juan' } },
    });
  });

  it('un perfil inexistente no rompe', async () => {
    const { service, added } = makeService({ profile: null });
    const result = await service.enqueueForProfile('no-existe');
    expect(result).toEqual({ candidates: 0, enqueued: 0, remaining: 0 });
    expect(added).toHaveLength(0);
  });
});
