import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/modules/profiles/profile-snapshot', () => ({
  buildProfileSnapshot: () => Promise.resolve('PERFIL CANÓNICO DEL CANDIDATO\nHabilidades: React (4/5)'),
}));

const { AtsService } = await import('../src/modules/ats/ats.service');

const vacancy = {
  id: 'v1',
  title: 'Frontend Developer',
  descriptionRaw: 'Buscamos React, TypeScript y Vitest.',
  enrichment: {
    skills: ['React', 'TypeScript'],
    keyRequirements: ['Experiencia con React'],
    niceToHave: [],
  },
};

const profile = {
  name: 'Christian Henao',
  email: 'a@b.com',
  phone: '+57 300 000 0000',
  location: 'Pereira',
  languages: [],
  links: [{ type: 'github', url: 'https://github.com/x' }],
};

/** HV a la que le falta React y TypeScript. */
const contentMissing = {
  atsMode: true,
  headline: 'Backend Developer',
  summary: 'Backend developer con foco en PostgreSQL.',
  skills: ['PostgreSQL'],
  experience: [],
  projects: [],
  education: [],
  softSkills: [],
  keywords: [],
  markdown: '# cv',
  coverLetter: 'Carta previa',
};

function makeService(opts: {
  llmResult?: Record<string, unknown> | null;
  content?: Record<string, unknown>;
}) {
  const updates: unknown[] = [];
  const prisma = {
    resumeDraft: {
      findUnique: () =>
        Promise.resolve({
          id: 'd1',
          vacancyId: 'v1',
          profileId: 'p1',
          content: opts.content ?? contentMissing,
          profile,
          vacancy,
        }),
      update: (args: unknown) => {
        updates.push(args);
        return Promise.resolve({});
      },
    },
    matchResult: {
      findUnique: () => Promise.resolve({ applicationStrategy: { keywords: ['React'] } }),
    },
    profile: { findFirst: () => Promise.resolve({ id: 'p1', name: 'Christian Henao' }) },
  };
  const service = new AtsService(
    prisma as never,
    { name: 'mock', json: () => Promise.resolve(opts.llmResult ?? null) } as never,
    { log: () => {}, error: () => {}, warn: () => {} } as never,
  );
  return { service, updates };
}

describe('AtsService.proposeKeywordFix', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devuelve el contenido propuesto y NO lo guarda', async () => {
    const { service, updates } = makeService({
      llmResult: {
        ...contentMissing,
        summary: 'Frontend developer con React y TypeScript, base en PostgreSQL.',
        skills: ['React', 'TypeScript', 'PostgreSQL'],
      },
    });

    const result = await service.proposeKeywordFix('d1');

    expect(result.applied).toBe(true);
    expect(result.integrated).toEqual(expect.arrayContaining(['React']));
    // Lo propuesto se devuelve…
    expect(result.content).toMatchObject({ summary: expect.stringContaining('React') });
    // …pero nada se persiste: el usuario decide.
    expect(updates).toHaveLength(0);
  });

  it('conserva los campos que no son de redacción (carta, markdown, atsMode)', async () => {
    const { service } = makeService({
      llmResult: { summary: 'Con React.', skills: ['React', 'TypeScript'] },
    });

    const result = await service.proposeKeywordFix('d1');

    expect(result.content).toMatchObject({
      coverLetter: 'Carta previa',
      markdown: '# cv',
      atsMode: true,
    });
  });

  it('sin proveedor de IA avisa y no toca nada', async () => {
    const { service, updates } = makeService({ llmResult: null });

    const result = await service.proposeKeywordFix('d1');

    expect(result.applied).toBe(false);
    expect(result.note).toMatch(/no está configurado/i);
    expect(updates).toHaveLength(0);
  });

  it('si ya no falta nada no llama a la IA', async () => {
    // Cubre también Vitest, que el medidor descubre del texto crudo.
    const complete = {
      ...contentMissing,
      headline: 'Frontend Developer',
      summary: 'Frontend developer con React, TypeScript y tests en Vitest.',
      skills: ['React', 'TypeScript', 'Vitest'],
    };
    const { service } = makeService({ content: complete, llmResult: null });

    const result = await service.proposeKeywordFix('d1');

    expect(result.applied).toBe(false);
    expect(result.note).toMatch(/no falta ninguna/i);
  });

  it('no reporta como integrada una keyword que la IA no metió', async () => {
    // La IA devuelve el resumen sin React ni TypeScript: no debe mentir.
    const { service } = makeService({
      llmResult: { ...contentMissing, summary: 'Sigo hablando solo de PostgreSQL.' },
    });

    const result = await service.proposeKeywordFix('d1');

    expect(result.applied).toBe(true);
    expect(result.integrated).toHaveLength(0);
    expect(result.note).toMatch(/no pudo integrar/i);
  });
});
