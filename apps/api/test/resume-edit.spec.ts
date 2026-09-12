import { describe, expect, it } from 'vitest';
import { ResumeEditService } from '../src/modules/resume-edit/resume-edit.service';

/**
 * Reorganización del borrador con IA. Lo crítico: nunca inventar hechos (lo
 * garantiza el prompt + el schema), no perder la carta del JSON, y no romper
 * cuando no hay proveedor LLM.
 */
const currentContent = {
  headline: 'AI Engineer',
  summary: 'Resumen original.',
  skills: ['TypeScript', 'NestJS'],
  experience: [
    { role: 'Team Leader', company: 'Finova SAS', period: '2024 - Presente', bullets: ['Lideré'] },
  ],
  projects: [{ name: 'Atiende', highlights: ['IA conversacional'] }],
  education: [{ institution: 'SENA', degree: 'Diseño', period: '2023' }],
  softSkills: ['Liderazgo'],
  keywords: ['node'],
  markdown: '# CV original',
  coverLetter: 'Carta ya escrita por el usuario.',
  coverLetterSource: 'editada',
};

function makeService(opts: {
  draft?: Record<string, unknown> | null;
  llmResult?: Record<string, unknown> | null;
}) {
  const updates: Record<string, unknown>[] = [];
  const upserts: unknown[] = [];
  const prisma = {
    resumeDraft: {
      findUnique: () => Promise.resolve(opts.draft ?? null),
      update: (args: { data: Record<string, unknown> }) => {
        updates.push(args.data);
        return Promise.resolve({ id: 'd1' });
      },
    },
    matchResult: { findUnique: () => Promise.resolve({ score: 80 }) },
    vacancyProfile: {
      upsert: (args: unknown) => {
        upserts.push(args);
        return Promise.resolve({});
      },
    },
    profile: {
      findFirst: () =>
        Promise.resolve({
          name: 'Christian Henao',
          headline: ['AI Engineer'],
          location: 'Pereira',
          languages: [],
          links: [],
          summary: 'Resumen',
          skills: [],
          experiences: [],
          projects: [],
          education: [],
          softSkills: [],
        }),
    },
  };
  const llm = { name: 'mock', json: () => Promise.resolve(opts.llmResult ?? null) };
  const logger = { log: () => {}, error: () => {}, warn: () => {} };
  return {
    service: new ResumeEditService(prisma as never, llm as never, logger as never),
    updates,
    upserts,
  };
}

const draft = {
  id: 'd1',
  vacancyId: 'v1',
  profileId: 'p1',
  content: currentContent,
  profile: { name: 'Christian Henao' },
  vacancy: { title: 'Backend Developer', company: 'Finova SAS', source: null },
};

describe('ResumeEditService.refine', () => {
  it('guarda el contenido reorganizado y conserva la carta', async () => {
    const { service, updates } = makeService({
      draft,
      llmResult: {
        headline: 'AI Engineer — Backend',
        summary: 'Resumen reorganizado y más corto.',
        skills: ['NestJS', 'TypeScript'],
        experience: [
          {
            role: 'Team Leader',
            company: 'Finova SAS',
            period: '2024 - Presente',
            bullets: ['Lideré'],
          },
        ],
        projects: [{ name: 'Atiende', highlights: ['IA conversacional'] }],
        education: [{ institution: 'SENA', degree: 'Diseño', period: '2023' }],
        softSkills: ['Liderazgo'],
        keywords: ['nest'],
      },
    });

    const result = await service.refine('d1', 'hazlo más corto');
    expect(result.applied).toBe(true);
    expect(result.content.summary).toBe('Resumen reorganizado y más corto.');

    const saved = updates[0].content as Record<string, unknown>;
    // La carta NO se pierde al reorganizar.
    expect(saved.coverLetter).toBe('Carta ya escrita por el usuario.');
    expect(saved.coverLetterSource).toBe('editada');
    // Se re-renderiza el markdown desde el contenido nuevo.
    expect(String(saved.markdown)).toContain('# Christian Henao');
    expect(updates[0].version).toEqual({ increment: 1 });
  });

  it('sin proveedor LLM no toca la BD y avisa', async () => {
    const { service, updates } = makeService({ draft, llmResult: null });
    const result = await service.refine('d1', 'ordénalo');
    expect(result.applied).toBe(false);
    expect(result.note).toMatch(/no está configurado/i);
    expect(updates).toHaveLength(0);
  });

  /**
   * Regresión: `refine` reconstruía el contenido desde la respuesta de la IA, que
   * no trae estas preferencias, así que reorganizar apagaba el Modo ATS y borraba
   * el idioma elegido para esa HV.
   */
  it('conserva el Modo ATS y el idioma al reorganizar', async () => {
    const { service, updates } = makeService({
      draft: { ...draft, content: { ...currentContent, atsMode: true, language: 'en' } },
      llmResult: {
        headline: 'AI Engineer',
        summary: 'Resumen reorganizado.',
        skills: ['TypeScript'],
        experience: [
          { role: 'Team Leader', company: 'Finova SAS', period: '2024', bullets: ['Lideré'] },
        ],
        projects: [],
        education: [],
        softSkills: [],
        keywords: [],
      },
    });

    await service.refine('d1', 'ordénalo');

    const saved = updates[0].content as Record<string, unknown>;
    expect(saved.atsMode).toBe(true);
    expect(saved.language).toBe('en');
  });

  it('sin instrucción no llama a la IA', async () => {
    const { service, updates } = makeService({ draft, llmResult: null });
    const result = await service.refine('d1', '   ');
    expect(result.applied).toBe(false);
    expect(result.note).toMatch(/qué querés/i);
    expect(updates).toHaveLength(0);
  });

  it('un borrador inexistente da 404', async () => {
    const { service } = makeService({ draft: null });
    await expect(service.refine('nope', 'algo')).rejects.toThrow(/no existe/i);
  });
});

describe('ResumeEditService.translate', () => {
  it('traduce conservando ediciones, guarda el idioma y traduce la carta', async () => {
    const { service, updates } = makeService({
      draft,
      llmResult: {
        headline: 'AI Engineer',
        summary: 'Original summary.',
        skills: ['TypeScript', 'NestJS'],
        experience: [
          {
            role: 'Team Leader',
            company: 'Finova SAS',
            period: '2024 - 2026',
            bullets: ['Led a team'],
          },
        ],
        projects: [{ name: 'Atiende', highlights: ['Conversational AI'] }],
        education: [{ institution: 'SENA', degree: 'Design', period: '2023' }],
        softSkills: ['Leadership'],
        keywords: ['node'],
        coverLetter: 'Dear team, I am writing to apply.',
      },
    });

    const result = await service.translate('d1', 'en');
    expect(result.applied).toBe(true);
    expect(result.language).toBe('en');

    const saved = updates[0].content as Record<string, unknown>;
    expect(saved.language).toBe('en');
    expect(saved.summary).toBe('Original summary.');
    // La carta se traduce y queda marcada como generada por IA.
    expect(saved.coverLetter).toBe('Dear team, I am writing to apply.');
    expect(saved.coverLetterSource).toBe('ia');
    expect(String(saved.markdown)).toContain('Christian Henao');
    expect(updates[0].version).toEqual({ increment: 1 });
  });

  it('conserva el Modo ATS (es preferencia del borrador, no del texto)', async () => {
    const { service, updates } = makeService({
      draft: { ...draft, content: { ...currentContent, atsMode: true } },
      llmResult: {
        headline: 'AI Engineer',
        summary: 'X.',
        skills: [],
        experience: [],
        projects: [],
        education: [],
        softSkills: [],
        keywords: [],
      },
    });
    await service.translate('d1', 'en');
    const saved = updates[0].content as Record<string, unknown>;
    expect(saved.atsMode).toBe(true);
  });

  it('sin proveedor LLM no toca la BD y avisa', async () => {
    const { service, updates } = makeService({ draft, llmResult: null });
    const result = await service.translate('d1', 'en');
    expect(result.applied).toBe(false);
    expect(result.note).toMatch(/no está configurado/i);
    expect(updates).toHaveLength(0);
  });

  it('un borrador inexistente da 404', async () => {
    const { service } = makeService({ draft: null });
    await expect(service.translate('nope', 'en')).rejects.toThrow(/no existe/i);
  });
});
