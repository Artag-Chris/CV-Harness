import { describe, expect, it } from 'vitest';
import { NormalizeService } from '../src/modules/normalizer/normalize.service';

/**
 * Fan-out del normalizador. Una vacante "dirigida" (oferta pegada a mano) debe
 * evaluarse SOLO con el perfil elegido; una scrapeada sigue repartiéndose entre
 * los perfiles que vigilan la fuente. Es la garantía de no cambiar el flujo actual.
 */
interface Ctx {
  service: NormalizeService;
  matchJobs: { data: { vacancyId: string; profileId: string } }[];
  vacancyProfiles: unknown[];
}

function makeService(vacancy: Record<string, unknown>, selections: { profileId: string }[], primary: string | null) {
  const matchJobs: { data: { vacancyId: string; profileId: string } }[] = [];
  const vacancyProfiles: unknown[] = [];
  const prisma = {
    vacancy: {
      findUnique: () => Promise.resolve(vacancy),
      update: () => Promise.resolve({}),
    },
    profileSource: { findMany: () => Promise.resolve(selections) },
    profile: {
      findFirst: () => Promise.resolve(primary ? { id: primary } : null),
    },
    vacancyProfile: {
      upsert: (args: unknown) => {
        vacancyProfiles.push(args);
        return Promise.resolve({});
      },
    },
  };
  const llm = { name: 'mock', json: () => Promise.resolve(null) };
  const service = new NormalizeService(
    prisma as never,
    llm as never,
    {
      add: (_n: string, data: { vacancyId: string; profileId: string }) => {
        matchJobs.push({ data });
        return Promise.resolve({});
      },
    } as never,
    { log: () => {}, error: () => {}, warn: () => {} } as never,
  );
  return { service, matchJobs, vacancyProfiles } as Ctx;
}

const baseVacancy = {
  id: 'v1',
  sourceId: 'src1',
  status: 'RAW',
  title: 'Fullstack Junior',
  company: null,
  location: null,
  salary: null,
  modality: null,
  descriptionRaw: 'Buscamos un desarrollador con React y Node.js para el equipo.',
};

describe('NormalizeService — fan-out del match', () => {
  it('una vacante dirigida se evalúa solo con el perfil elegido', async () => {
    const ctx = makeService({ ...baseVacancy, profileId: 'pElegido' }, [], 'pPrimario');

    await ctx.service.handle('v1');

    expect(ctx.matchJobs).toHaveLength(1);
    expect(ctx.matchJobs[0].data.profileId).toBe('pElegido');
  });

  it('una vacante scrapeada sigue repartiéndose entre los perfiles de la fuente', async () => {
    const ctx = makeService({ ...baseVacancy, profileId: null }, [{ profileId: 'pA' }, { profileId: 'pB' }], 'pPrimario');

    await ctx.service.handle('v1');

    expect(ctx.matchJobs.map((j) => j.data.profileId).sort()).toEqual(['pA', 'pB']);
  });

  it('una vacante scrapeada sin selecciones cae al perfil primario', async () => {
    const ctx = makeService({ ...baseVacancy, profileId: null }, [], 'pPrimario');

    await ctx.service.handle('v1');

    expect(ctx.matchJobs.map((j) => j.data.profileId)).toEqual(['pPrimario']);
  });
});
