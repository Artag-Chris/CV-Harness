import { describe, expect, it } from 'vitest';
import { ResumeController } from '../src/modules/vacancies/resumes.controller';

/**
 * Edición manual del borrador. Lo que se protege: el PATCH re-renderiza el
 * markdown del CV pero NO debe perder la carta de presentación, y si la carta
 * viene en el body debe guardarse como "editada".
 */
function makeController(existingContent: Record<string, unknown>) {
  const updates: Record<string, unknown>[] = [];
  const prisma = {
    resumeDraft: {
      findUnique: () =>
        Promise.resolve({
          id: 'd1',
          profileId: 'p1',
          content: existingContent,
          profile: { name: 'Christian Henao' },
        }),
      update: (args: { data: Record<string, unknown> }) => {
        updates.push(args.data);
        return Promise.resolve({ id: 'd1', ...args.data });
      },
    },
  };
  return { controller: new ResumeController(prisma as never), updates };
}

const baseContent = {
  headline: 'AI Engineer',
  summary: 'Resumen',
  skills: ['TypeScript'],
  experience: [{ role: 'Dev', company: 'X', period: '2024', bullets: ['b'] }],
  projects: [],
  education: [],
  softSkills: [],
  keywords: [],
};

describe('PATCH /resumes/:id (edición manual)', () => {
  it('conserva la carta de presentación cuando no viene en el body', async () => {
    const { controller, updates } = makeController({
      ...baseContent,
      coverLetter: 'Carta previa.',
      coverLetterSource: 'ia',
      coverLetterUpdatedAt: '2026-01-01T00:00:00.000Z',
    });

    await controller.update('d1', { content: { ...baseContent, summary: 'Resumen editado' } });

    const saved = updates[0].content as Record<string, unknown>;
    expect(saved.coverLetter).toBe('Carta previa.');
    expect(saved.coverLetterSource).toBe('ia');
    expect(saved.markdown).toContain('# Christian Henao');
  });

  it('guarda la carta del body como editada a mano', async () => {
    const { controller, updates } = makeController({ ...baseContent });

    await controller.update('d1', {
      content: { ...baseContent, coverLetter: '  Mi carta corregida.  ' },
    });

    const saved = updates[0].content as Record<string, unknown>;
    expect(saved.coverLetter).toBe('Mi carta corregida.');
    expect(saved.coverLetterSource).toBe('editada');
    expect(typeof saved.coverLetterUpdatedAt).toBe('string');
  });

  it('no inventa carta si no había ninguna', async () => {
    const { controller, updates } = makeController({ ...baseContent });
    await controller.update('d1', { content: { ...baseContent } });
    const saved = updates[0].content as Record<string, unknown>;
    expect(saved).not.toHaveProperty('coverLetter');
  });
});
