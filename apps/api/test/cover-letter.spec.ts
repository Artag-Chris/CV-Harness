import { describe, expect, it } from 'vitest';
import {
  CoverLetterService,
  normalizeParagraphs,
} from '../src/modules/cover-letter/cover-letter.service';

/**
 * La carta se genera con LLM y se guarda DENTRO del `content` del borrador
 * (sin columna nueva). Lo que se protege aquí: que el guardado no borre el
 * resto del contenido, que se pueda editar a mano, y que sin proveedor LLM
 * haya una carta determinística en vez de un error.
 */
function makeService(opts: {
  draft?: Record<string, unknown> | null;
  llmResult?: Record<string, unknown> | null;
  snapshot?: string;
}) {
  const updates: { data: Record<string, unknown> }[] = [];
  const prisma = {
    resumeDraft: {
      findUnique: () => Promise.resolve(opts.draft ?? null),
      update: (args: { data: Record<string, unknown> }) => {
        updates.push(args);
        return Promise.resolve({ id: 'd1', ...(args.data as object) });
      },
    },
    matchResult: { findUnique: () => Promise.resolve({ score: 80, applicationStrategy: {} }) },
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
  const llm = {
    name: 'mock',
    json: () => Promise.resolve(opts.llmResult ?? null),
  };
  const logger = { log: () => {}, error: () => {}, warn: () => {} };
  return {
    service: new CoverLetterService(prisma as never, llm as never, logger as never),
    updates,
  };
}

const draft = {
  id: 'd1',
  vacancyId: 'v1',
  profileId: 'p1',
  content: { headline: 'AI Engineer', summary: 'Resumen', markdown: '# CV', skills: [] },
  profile: { name: 'Christian Henao' },
  vacancy: {
    title: 'Backend Developer',
    company: 'Finova SAS',
    location: 'Remoto',
    descriptionRaw: 'Buscamos backend',
    enrichment: null,
    source: null,
  },
};

describe('CoverLetterService', () => {
  it('genera con IA y guarda la carta sin borrar el resto del contenido', async () => {
    const { service, updates } = makeService({
      draft,
      llmResult: { coverLetter: 'Estimado equipo:\n\nMe postulo.\n\nCordialmente,\nChristian' },
    });

    const result = await service.generate('d1');
    expect(result.coverLetter).toContain('Me postulo');
    expect(result.coverLetterSource).toBe('ia');

    const saved = updates[0].data.content as Record<string, unknown>;
    // Lo importante: no se pierde el CV ya generado.
    expect(saved.markdown).toBe('# CV');
    expect(saved.headline).toBe('AI Engineer');
    expect(saved.coverLetter).toContain('Me postulo');
  });

  it('sin proveedor LLM devuelve una carta determinística (no falla)', async () => {
    const { service } = makeService({ draft, llmResult: null });
    const result = await service.generate('d1');
    expect(result.coverLetterSource).toBe('plantilla');
    expect(result.coverLetter).toContain('Backend Developer');
    expect(result.coverLetter).toContain('Finova SAS');
    expect(result.coverLetter.length).toBeGreaterThan(200);
  });

  it('ignora una respuesta de IA vacía y cae al respaldo', async () => {
    const { service } = makeService({ draft, llmResult: { coverLetter: '   ' } });
    const result = await service.generate('d1');
    expect(result.coverLetterSource).toBe('plantilla');
  });

  it('la edición manual reemplaza el texto y marca la fuente como editada', async () => {
    const { service, updates } = makeService({ draft });
    const result = await service.saveEdited('d1', '  Mi carta corregida.  ');
    expect(result.coverLetter).toBe('Mi carta corregida.');
    expect(result.coverLetterSource).toBe('editada');
    expect((updates[0].data.content as Record<string, unknown>).coverLetter).toBe(
      'Mi carta corregida.',
    );
  });

  it('rechaza una carta vacía', async () => {
    const { service } = makeService({ draft });
    await expect(service.saveEdited('d1', '   ')).rejects.toThrow(/vacía/i);
  });

  it('un borrador inexistente da 404', async () => {
    const { service } = makeService({ draft: null });
    await expect(service.generate('nope')).rejects.toThrow(/no existe/i);
  });
});

describe('normalizeParagraphs', () => {
  it('colapsa saltos de más y quita espacios al final de línea', () => {
    expect(normalizeParagraphs('Hola   \n\n\n\nMundo  \n')).toBe('Hola\n\nMundo');
  });
});
