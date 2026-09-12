import { describe, expect, it } from 'vitest';
import { analyzeAts, type AtsContent } from '../src/modules/ats/analyzer';

/**
 * El idioma declarado (selector del perfil/HV) tiene que mandar sobre la
 * detección por marcadores: si no, forzar inglés dejaría encabezados en español.
 */
const spanishContent: AtsContent = {
  summary:
    'Ingeniero de software con experiencia en el desarrollo de aplicaciones y sistemas distribuidos para equipos de producto.',
  experience: [
    { role: 'Desarrollador', company: 'Finova SAS', period: '2024 - 2026', bullets: ['Lideré un equipo'] },
  ],
  skills: ['Node.js', 'TypeScript'],
  education: [{ institution: 'SENA', degree: 'Diseño Multimedia y Web', period: '2023' }],
  atsMode: true,
};

/** Compara encabezados sin depender del casing (el PDF los imprime en mayúsculas). */
function hasHeading(headings: string[], expected: string): boolean {
  const needle = expected.toLowerCase();
  return headings.some((h) => h.toLowerCase().includes(needle));
}

describe('ATS — idioma declarado', () => {
  it('con language=en usa encabezados en inglés aunque el texto esté en español', () => {
    const analysis = analyzeAts({ content: { ...spanishContent, language: 'en' } });
    expect(analysis.language).toBe('en');
    expect(hasHeading(analysis.expectedHeadings, 'Professional summary')).toBe(true);
    expect(hasHeading(analysis.sectionsFound, 'Professional summary')).toBe(true);
  });

  it('con language=es los encabezados esperados son en español', () => {
    const analysis = analyzeAts({ content: { ...spanishContent, language: 'es' } });
    expect(analysis.language).toBe('es');
    expect(hasHeading(analysis.expectedHeadings, 'Perfil profesional')).toBe(true);
  });

  it('con language=auto se detecta del contenido (no cambia el comportamiento previo)', () => {
    const analysis = analyzeAts({ content: { ...spanishContent, language: 'auto' } });
    expect(analysis.language).toBe('es');
  });

  it('un inglés forzado con contenido español da el score en estructura de encabezados estándar', () => {
    const forced = analyzeAts({ content: { ...spanishContent, language: 'en' } });
    const structure = forced.breakdown.find((b) => b.id === 'structure');
    expect(structure?.score).toBeGreaterThanOrEqual(90);
  });
});
