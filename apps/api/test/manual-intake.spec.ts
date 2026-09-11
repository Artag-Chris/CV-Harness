import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { fingerprint, fingerprintText } from '../src/common/hash.util';
import { ManualIntakeService } from '../src/modules/manual/manual.service';

/**
 * Intake de ofertas pegadas a mano. Lo que se protege: no duplicar vacantes,
 * reusar una sola fuente sintética, dirigir la vacante al perfil elegido y
 * encolar el pipeline.
 */
const LONG_TEXT = `About the job
As a Junior Fullstack Developer you will build modern web applications using
React and Node.js. You will work alongside experienced developers, build
RESTful APIs and participate in code reviews. Advanced level of English.`;

type Row = Record<string, unknown>;

function makeService(reused?: Row) {
  const sources: Row[] = [];
  const vacancies: Row[] = [];
  const profiles: Row[] = [];
  const vacancyProfiles: Row[] = [];
  const normalizeJobs: { data: unknown; opts: { jobId?: string } }[] = [];
  const matchJobs: { data: unknown; opts: { jobId?: string } }[] = [];
  let seq = 0;

  const prisma = {
    source: {
      findFirst: () => Promise.resolve(sources[0] ?? null),
      create: (args: { data: Row }) => {
        const row = { id: `s${++seq}`, ...args.data };
        sources.push(row);
        return Promise.resolve({ id: row.id });
      },
    },
    profile: {
      findUnique: (args: { where: { id: string } }) =>
        Promise.resolve(profiles.find((p) => p.id === args.where.id) ?? null),
      findFirst: (args: { where?: { isPrimary?: boolean } }) =>
        Promise.resolve(
          args?.where?.isPrimary
            ? (profiles.find((p) => p.isPrimary) ?? null)
            : (profiles[0] ?? null),
        ),
    },
    vacancy: {
      findUnique: (args: { where: { fingerprint?: string; id?: string } }) => {
        const all = reused ? [...vacancies, reused] : vacancies;
        return Promise.resolve(
          all.find(
            (v) =>
              (args.where.fingerprint != null && v.fingerprint === args.where.fingerprint) ||
              (args.where.id != null && v.id === args.where.id),
          ) ?? null,
        );
      },
      create: (args: { data: Row }) => {
        const row = { id: `v${++seq}`, ...args.data };
        vacancies.push(row);
        return Promise.resolve(row);
      },
    },
    vacancyProfile: {
      upsert: (args: { create: Row }) => {
        vacancyProfiles.push(args.create);
        return Promise.resolve({});
      },
    },
  };

  const service = new ManualIntakeService(
    prisma as never,
    {
      add: (_name: string, data: unknown, opts: { jobId?: string }) => {
        normalizeJobs.push({ data, opts });
        return Promise.resolve({});
      },
    } as never,
    {
      add: (_name: string, data: unknown, opts: { jobId?: string }) => {
        matchJobs.push({ data, opts });
        return Promise.resolve({});
      },
    } as never,
    { log: () => {}, error: () => {}, warn: () => {} } as never,
  );
  return { service, sources, vacancies, profiles, vacancyProfiles, normalizeJobs, matchJobs };
}

function profiles(): Row[] {
  return [
    { id: 'pA', isPrimary: true },
    { id: 'pB', isPrimary: false },
  ];
}

describe('ManualIntakeService.createFromText', () => {
  it('crea la fuente sintética deshabilitada y la reutiliza', async () => {
    const ctx = makeService();
    ctx.profiles.push(...profiles());

    await ctx.service.createFromText({ text: LONG_TEXT });
    await ctx.service.createFromText({ text: `${LONG_TEXT}\nUna línea extra distinta.` });

    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0]).toMatchObject({ kind: 'MANUAL', enabled: false });
    expect(ctx.sources[0].selectors).toEqual({});
    expect(ctx.vacancies).toHaveLength(2);
  });

  it('cae al perfil primario si no se elige ninguno', async () => {
    const ctx = makeService();
    ctx.profiles.push(...profiles());

    const res = await ctx.service.createFromText({ text: LONG_TEXT });
    expect(res).toMatchObject({ profileId: 'pA', reused: false });
    expect(ctx.vacancies[0]).toMatchObject({ profileId: 'pA' });
  });

  it('usa el perfil elegido y lo valida', async () => {
    const ctx = makeService();
    ctx.profiles.push(...profiles());

    const res = await ctx.service.createFromText({ text: LONG_TEXT, profileId: 'pB' });
    expect(res.profileId).toBe('pB');

    await expect(
      ctx.service.createFromText({ text: LONG_TEXT, profileId: 'no-existe' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deduplica por URL (misma huella que el scraping)', async () => {
    const url = 'https://www.linkedin.com/jobs/view/12345';
    const ctx = makeService({ id: 'v-existente', status: 'NORMALIZED', fingerprint: fingerprint(url) });
    ctx.profiles.push(...profiles());

    const res = await ctx.service.createFromText({ text: LONG_TEXT, url });
    expect(res).toMatchObject({ reused: true, vacancyId: 'v-existente' });
    expect(ctx.vacancies).toHaveLength(0);
  });

  it('deduplica por texto cuando no hay URL', async () => {
    const ctx = makeService({
      id: 'v-existente',
      status: 'NORMALIZED',
      fingerprint: fingerprintText(LONG_TEXT),
    });
    ctx.profiles.push(...profiles());

    const res = await ctx.service.createFromText({ text: LONG_TEXT });
    expect(res.reused).toBe(true);
    expect(ctx.vacancies).toHaveLength(0);
  });

  it('marca la vacante para que la HV genere la carta sola y encola el normalize', async () => {
    const ctx = makeService();
    ctx.profiles.push(...profiles());

    await ctx.service.createFromText({ text: LONG_TEXT });

    expect(ctx.vacancies[0].raw).toEqual({ manual: true, autoCoverLetter: true });
    expect(ctx.vacancies[0].status ?? 'RAW').toBe('RAW');
    const vacancyId = ctx.vacancies[0].id;
    expect(ctx.normalizeJobs[0].opts.jobId).toBe(`normalize-${vacancyId}`);
    expect(ctx.normalizeJobs[0].data).toEqual({ vacancyId });
  });

  it('toma el título del parámetro o de la primera línea útil', async () => {
    const a = makeService();
    a.profiles.push(...profiles());
    await a.service.createFromText({ text: LONG_TEXT, title: '  Fullstack Junior  ' });
    expect(a.vacancies[0].title).toBe('Fullstack Junior');

    const b = makeService();
    b.profiles.push(...profiles());
    await b.service.createFromText({ text: LONG_TEXT });
    expect(b.vacancies[0].title).toBe('About the job');
  });

  it('guarda la empresa y la URL cuando vienen', async () => {
    const ctx = makeService();
    ctx.profiles.push(...profiles());

    await ctx.service.createFromText({
      text: LONG_TEXT,
      company: 'BairesDev',
      url: ' https://x.com/job/1 ',
    });
    expect(ctx.vacancies[0]).toMatchObject({ company: 'BairesDev', url: 'https://x.com/job/1' });
  });

  it('rechaza un texto demasiado corto', async () => {
    const ctx = makeService();
    ctx.profiles.push(...profiles());
    await expect(ctx.service.createFromText({ text: 'muy corto' })).rejects.toThrow(/80 caracteres/);
  });

  it('sin perfiles no se puede pegar', async () => {
    const ctx = makeService();
    await expect(ctx.service.createFromText({ text: LONG_TEXT })).rejects.toThrow(/No hay perfiles/);
  });

  it('al reusar una vacante ya normalizada encola el match del perfil', async () => {
    const url = 'https://www.linkedin.com/jobs/view/999';
    const ctx = makeService({ id: 'v-existente', status: 'NORMALIZED', fingerprint: fingerprint(url) });
    ctx.profiles.push(...profiles());

    await ctx.service.createFromText({ text: LONG_TEXT, url });

    expect(ctx.vacancyProfiles).toHaveLength(1);
    expect(ctx.matchJobs).toHaveLength(1);
    expect(ctx.matchJobs[0].opts.jobId).toBe('match-v-existente-pA');
  });

  it('al reusar una vacante todavía RAW no encola match (lo hará el normalize)', async () => {
    const url = 'https://www.linkedin.com/jobs/view/1000';
    const ctx = makeService({ id: 'v-cruda', status: 'RAW', fingerprint: fingerprint(url) });
    ctx.profiles.push(...profiles());

    await ctx.service.createFromText({ text: LONG_TEXT, url });

    expect(ctx.vacancyProfiles).toHaveLength(1);
    expect(ctx.matchJobs).toHaveLength(0);
  });
});
