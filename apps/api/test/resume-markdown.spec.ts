import { describe, expect, it } from 'vitest';
import { renderResumeMarkdown } from '../src/modules/resume/resume-markdown';

const content = {
  headline: 'AI Engineer',
  summary: 'Resumen profesional.',
  skills: ['TypeScript', 'NestJS'],
  experience: [
    { role: 'Team Leader', company: 'Finova SAS', period: '2024 – Presente', bullets: ['Lideré equipo'] },
  ],
  projects: [{ name: 'Atiende', highlights: ['IA conversacional'] }],
  education: [{ institution: 'SENA', degree: 'Diseño Multimedia', period: '2023' }],
  softSkills: ['Liderazgo'],
};

describe('renderResumeMarkdown', () => {
  it('genera markdown con todas las secciones', () => {
    const md = renderResumeMarkdown(content, 'Christian Henao');
    expect(md).toContain('# Christian Henao');
    expect(md).toContain('## Perfil');
    expect(md).toContain('## Experiencia');
    expect(md).toContain('## Proyectos destacados');
    expect(md).toContain('## Habilidades');
    expect(md).toContain('TypeScript, NestJS');
    expect(md).toContain('## Educación');
    expect(md).toContain('## Soft skills');
  });
});
