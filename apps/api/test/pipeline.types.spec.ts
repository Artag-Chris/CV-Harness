import { describe, expect, it } from 'vitest';
import {
  MatchOutcomeSchema,
  NormalizeExtractSchema,
  ResumeContentSchema,
  ScraperResultPayloadSchema,
  VacancyJobSchema,
} from '../src/modules/pipeline/pipeline.types';

describe('contratos del pipeline (Zod)', () => {
  it('valida el payload de scraper:results (camelCase de Rust)', () => {
    const payload = ScraperResultPayloadSchema.parse({
      requestId: 'r1',
      sourceId: 's1',
      items: [
        {
          externalId: 'e1',
          url: 'http://x/jobs/1',
          title: 'Backend NestJS',
          company: 'TechCorp',
          location: 'Medellín (Remoto)',
          descriptionText: 'texto',
          descriptionHtml: '<p>texto</p>',
          postedAt: 'hace 2 días',
          applyUrl: 'http://x/apply',
        },
      ],
    });
    expect(payload.items).toHaveLength(1);
    expect(payload.error).toBeNull();
  });

  it('acepta resultados de error sin items', () => {
    const payload = ScraperResultPayloadSchema.parse({
      requestId: 'r2',
      error: 'HTTP 403',
    });
    expect(payload.items).toEqual([]);
    expect(payload.error).toBe('HTTP 403');
  });

  it('rechaza payload sin requestId', () => {
    expect(() => ScraperResultPayloadSchema.parse({ items: [] })).toThrow();
  });

  it('normaliza match outcome y deriva arrays por defecto', () => {
    const out = MatchOutcomeSchema.parse({
      score: 88,
      applicationStrategy: { highlights: ['a'] },
    });
    expect(out.score).toBe(88);
    expect(out.reasons).toEqual([]);
    expect(out.coverLetterDraft).toBe('');
  });

  it('valida extracción normalizada', () => {
    const out = NormalizeExtractSchema.parse({
      title: 'X',
      skills: ['NestJS'],
    });
    expect(out.keyRequirements).toEqual([]);
  });

  it('valida contenido de HV', () => {
    const out = ResumeContentSchema.parse({
      headline: 'AI Engineer',
      summary: 'sum',
      experience: [{ role: 'r', company: 'c', period: '2024', bullets: [] }],
      skills: ['a'],
    });
    expect(out.education).toEqual([]);
  });

  it('valida payload de job de vacante', () => {
    expect(VacancyJobSchema.parse({ vacancyId: 'v1' })).toMatchObject({
      vacancyId: 'v1',
    });
  });
});
