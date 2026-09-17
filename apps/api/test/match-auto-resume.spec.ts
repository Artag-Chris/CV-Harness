import { beforeEach, describe, expect, it, vi } from 'vitest';

// Se aíslan las dependencias laterales: lo único que se observa es si la etapa
// RESUME se encola o no según el flag.
vi.mock('../src/modules/profiles/profile-snapshot', () => ({
  buildProfileSnapshot: () => Promise.resolve('PERFIL CANÓNICO'),
}));
vi.mock('../src/modules/vacancies/aggregate', () => ({
  recomputeVacancyAggregate: () => Promise.resolve(),
}));

type MatchServiceCtor = (typeof import('../src/modules/matcher/match.service'))['MatchService'];

const OUTCOME = {
  score: 90,
  reasons: [],
  gaps: [],
  applicationStrategy: { highlights: [], keywords: [], angle: '', suggestedChannel: '' },
  coverLetterDraft: '',
};

/** `env` se evalúa al importar el módulo: hay que reimportarlo por test. */
async function loadService(): Promise<MatchServiceCtor> {
  vi.resetModules();
  const mod = await import('../src/modules/matcher/match.service');
  return mod.MatchService;
}

function build(Service: MatchServiceCtor, resumeJobs: unknown[]) {
  const prisma = {
    vacancy: {
      findUnique: () =>
        Promise.resolve({
          id: 'v1',
          title: 'Backend Developer',
          company: 'Acme',
          location: null,
          descriptionRaw: 'texto',
          enrichment: null,
          source: { name: 'Fuente' },
        }),
    },
    profile: { findUnique: () => Promise.resolve({ id: 'p1', name: 'Christian' }) },
    vacancyProfile: {
      findUnique: () => Promise.resolve(null),
      upsert: () => Promise.resolve({}),
    },
    matchResult: { upsert: () => Promise.resolve({ id: 'm1' }) },
  };
  const resumeQueue = {
    add: (_n: string, data: unknown, o: { jobId?: string }) => {
      resumeJobs.push({ data, opts: o });
      return Promise.resolve({});
    },
  };
  return new Service(
    prisma as never,
    { name: 'mock', json: () => Promise.resolve(OUTCOME) } as never,
    resumeQueue as never,
    { searchActiveResume: () => Promise.resolve({ hits: [], bestScore: null }) } as never,
    { log: () => {}, error: () => {}, warn: () => {} } as never,
  );
}

describe('MatchService — HV automática', () => {
  beforeEach(() => {
    delete process.env.AUTO_RESUME_ENABLED;
  });

  it('con AUTO_RESUME_ENABLED=false no encola la HV aunque supere el umbral', async () => {
    process.env.AUTO_RESUME_ENABLED = 'false';
    const resumeJobs: unknown[] = [];
    const service = build(await loadService(), resumeJobs);

    await service.handle('v1', 'p1');

    expect(resumeJobs).toHaveLength(0);
  });

  it('con AUTO_RESUME_ENABLED=true la encola al superar el umbral', async () => {
    process.env.AUTO_RESUME_ENABLED = 'true';
    const resumeJobs: unknown[] = [];
    const service = build(await loadService(), resumeJobs);

    await service.handle('v1', 'p1');

    expect(resumeJobs).toHaveLength(1);
  });
});
