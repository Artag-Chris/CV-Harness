import { beforeEach, describe, expect, it, vi } from 'vitest';

// Se aíslan las dependencias laterales para poder observar SOLO el encadenado de
// la carta: el snapshot del perfil y el agregado de la vacante no son el objeto
// de esta prueba.
vi.mock('../src/modules/profiles/profile-snapshot', () => ({
  buildProfileSnapshot: () => Promise.resolve('PERFIL CANÓNICO'),
}));
vi.mock('../src/modules/vacancies/aggregate', () => ({
  recomputeVacancyAggregate: () => Promise.resolve(),
}));

const { ResumeService } = await import('../src/modules/resume/resume.service');

const CONTENT = {
  headline: 'AI Engineer',
  summary: 'Resumen del candidato.',
  skills: ['TypeScript'],
  experience: [{ role: 'Dev', company: 'X', period: '2024', bullets: ['logro'] }],
  projects: [{ name: 'Atiende', highlights: ['IA'] }],
  education: [{ institution: 'SENA', degree: 'Diseño', period: '2023' }],
  softSkills: ['Liderazgo'],
  keywords: ['node'],
};

function makeService(
  raw: Record<string, unknown>,
  coverFails = false,
  existingDraft: { content: Record<string, unknown> } | null = null,
) {
  const draftSaves: unknown[] = [];
  const letterCalls: string[] = [];
  const prisma = {
    vacancy: {
      findUnique: () =>
        Promise.resolve({
          id: 'v1',
          title: 'Backend Developer',
          company: 'Finova',
          profileId: 'p1',
          raw,
          source: { name: 'Pegada manual' },
        }),
    },
    profile: { findUnique: () => Promise.resolve({ id: 'p1', name: 'Christian Henao' }) },
    vacancyProfile: {
      findUnique: () => Promise.resolve(null),
      upsert: () => Promise.resolve({}),
    },
    matchResult: {
      findUnique: () => Promise.resolve({ score: 80, applicationStrategy: {}, coverLetterDraft: null }),
    },
    resumeDraft: {
      findUnique: () => Promise.resolve(existingDraft),
      upsert: (args: unknown) => {
        draftSaves.push(args);
        return Promise.resolve({ id: 'd1' });
      },
    },
  };
  const coverLetter = {
    generate: (id: string) => {
      letterCalls.push(id);
      return coverFails ? Promise.reject(new Error('boom')) : Promise.resolve({});
    },
  };
  const service = new ResumeService(
    prisma as never,
    { name: 'mock', json: () => Promise.resolve(CONTENT) } as never,
    { add: () => Promise.resolve({}) } as never,
    coverLetter as never,
    { log: () => {}, error: () => {}, warn: () => {} } as never,
  );
  return { service, draftSaves, letterCalls };
}

describe('ResumeService — carta automática de las ofertas pegadas', () => {
  beforeEach(() => vi.clearAllMocks());

  it('con raw.autoCoverLetter genera la carta del borrador recién creado', async () => {
    const { service, letterCalls, draftSaves } = makeService({ manual: true, autoCoverLetter: true });

    await service.handle('v1', 'p1');

    expect(draftSaves).toHaveLength(1);
    expect(letterCalls).toEqual(['d1']);
  });

  it('sin el flag (flujo scrapeado) no genera carta', async () => {
    const { service, letterCalls } = makeService({});

    await service.handle('v1', 'p1');

    expect(letterCalls).toHaveLength(0);
  });

  it('si la carta falla, la HV igual queda guardada', async () => {
    const { service, draftSaves } = makeService({ autoCoverLetter: true }, true);

    await expect(service.handle('v1', 'p1')).resolves.toBeUndefined();
    expect(draftSaves).toHaveLength(1);
  });

  /**
   * Regresión: al regenerar, el contenido se armaba desde la respuesta de la IA,
   * que no trae las preferencias del borrador — el Modo ATS se apagaba solo y la
   * HV volvía a la plantilla de dos columnas.
   */
  it('regenerar conserva el Modo ATS y la carta ya escrita', async () => {
    const existing = {
      content: { ...CONTENT, atsMode: true, coverLetter: 'Carta previa.' },
    };
    const { service, draftSaves } = makeService({}, false, existing);

    await service.handle('v1', 'p1');

    const args = draftSaves[0] as { update: { content: Record<string, unknown> } };
    expect(args.update.content.atsMode).toBe(true);
    expect(args.update.content.coverLetter).toBe('Carta previa.');
  });
});
