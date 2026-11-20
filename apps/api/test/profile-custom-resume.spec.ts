import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProfileCustomResumeService } from '../src/modules/profiles/profile-custom-resume.service';
import type { LlmProvider } from '../src/modules/llm/llm-provider.port';

function makePrisma(overrides?: { exists?: boolean }) {
  const exists = overrides?.exists ?? true;
  const fullProfile = {
    id: 'prof_1',
    name: 'Christian Henao',
    headline: ['AI Engineer', 'Full Stack Developer'],
    summary: 'Ingeniero de software con experiencia en IA, NestJS y Next.js.',
    email: 'chris@example.com',
    phone: '+57 300 000 0000',
    location: 'Colombia',
    applyLanguage: 'es',
    languages: [{ language: 'Español', level: 'Nativo' }],
    softSkills: ['Liderazgo técnico', 'Comunicación'],
    experiences: [
      {
        role: 'Tech Lead',
        company: 'Acme',
        periodStart: '2023',
        periodEnd: '2026',
        bullets: ['Lideré arquitectura NestJS + PostgreSQL'],
      },
    ],
    education: [
      {
        institution: 'Universidad',
        degree: 'Ingeniería de Sistemas',
        periodStart: '2018',
        periodEnd: '2023',
      },
    ],
    projects: [
      {
        name: 'Atiende',
        summary: 'Agente conversacional multicanal',
        stack: ['NestJS', 'pgvector'],
        highlights: ['Caching multinivel que redujo 30% costos de LLM'],
      },
    ],
    skills: [
      { category: 'AI', rating: 5, skill: { name: 'RAG' } },
      { category: 'Backend', rating: 5, skill: { name: 'NestJS' } },
      { category: 'Frontend', rating: 4, skill: { name: 'React' } },
    ],
    links: [{ type: 'website', url: 'https://artagdev.com.co' }],
  };

  return {
    profile: {
      findFirst: vi.fn().mockResolvedValue(exists ? fullProfile : null),
      findUnique: vi.fn().mockResolvedValue(exists ? fullProfile : null),
      findUniqueOrThrow: vi.fn().mockResolvedValue(fullProfile),
    },
  };
}

describe('ProfileCustomResumeService', () => {
  it('genera HV a medida con IA usando el título, enfoque, idioma y atsMode pedidos', async () => {
    const prisma = makePrisma();
    const llm: LlmProvider = {
      name: 'deepseek',
      json: vi.fn().mockResolvedValue({
        headline: 'Senior Backend & AI Engineer',
        summary: 'Especializado en arquitecturas NestJS, PostgreSQL y sistemas RAG en producción.',
        skills: ['NestJS', 'RAG', 'PostgreSQL'],
        experience: [
          {
            role: 'Tech Lead',
            company: 'Acme',
            period: '2023 – 2026',
            bullets: ['Arquitectura backend escalable con NestJS y PostgreSQL'],
          },
        ],
        projects: [
          {
            name: 'Atiende',
            highlights: ['Redujo 30% costos de LLM con caching multinivel'],
          },
        ],
        education: [
          {
            institution: 'Universidad',
            degree: 'Ingeniería de Sistemas',
            period: '2018 – 2023',
          },
        ],
        softSkills: ['Liderazgo técnico'],
        keywords: ['NestJS', 'RAG', 'Backend'],
      }),
    };

    const svc = new ProfileCustomResumeService(prisma as never, llm);
    const res = await svc.generate('prof_1', {
      title: 'Senior Backend & AI Engineer',
      prompt: 'Enfócate en backend con NestJS, bases de datos y proyectos de IA',
      language: 'es',
      atsMode: true,
    });

    expect(res.source).toBe('ia');
    expect(res.profileId).toBe('prof_1');
    expect(res.content.headline).toBe('Senior Backend & AI Engineer');
    expect(res.content.language).toBe('es');
    expect(res.content.atsMode).toBe(true);
    expect(res.content.markdown).toContain('Christian Henao');
    expect(llm.json).toHaveBeenCalledWith(
      expect.stringContaining('Idioma de salida'),
      expect.stringContaining('Senior Backend & AI Engineer'),
      { stage: 'custom-resume' },
    );
  });

  it('refina un borrador existente cuando se envía currentContent', async () => {
    const prisma = makePrisma();
    const llm: LlmProvider = {
      name: 'deepseek',
      json: vi.fn().mockResolvedValue({
        headline: 'Cybersecurity & Backend Engineer',
        summary: 'Enfocado en cifrado AES-256-GCM y seguridad de APIs.',
        skills: ['NestJS', 'Security'],
        experience: [],
        projects: [],
        education: [],
        softSkills: [],
        keywords: ['AES-256-GCM'],
      }),
    };

    const svc = new ProfileCustomResumeService(prisma as never, llm);
    const res = await svc.generate('prof_1', {
      prompt: 'Enfócala más a ciberseguridad y protección de credenciales',
      language: 'en',
      currentContent: {
        headline: 'Backend Engineer',
        summary: 'Resumen previo',
        skills: ['NestJS'],
        experience: [],
        projects: [],
        education: [],
        softSkills: [],
        keywords: [],
      },
    });

    expect(res.source).toBe('ia');
    expect(res.content.headline).toBe('Cybersecurity & Backend Engineer');
    expect(res.content.language).toBe('en');
    expect(llm.json).toHaveBeenCalledWith(
      expect.stringContaining('editor profesional de hojas de vida'),
      expect.stringContaining('BORRADOR ACTUAL (JSON)'),
      { stage: 'custom-resume' },
    );
  });

  it('cae a plantilla determinística cuando no hay proveedor IA o se alcanzó el tope', async () => {
    const prisma = makePrisma();
    const llm: LlmProvider = {
      name: 'mock',
      json: vi.fn().mockResolvedValue(null),
    };

    const svc = new ProfileCustomResumeService(prisma as never, llm);
    const res = await svc.generate('prof_1', {
      title: 'Full Stack Developer',
      prompt: 'Posición full stack con React y Node',
    });

    expect(res.source).toBe('plantilla');
    expect(res.content.headline).toBe('Full Stack Developer');
    expect(res.content.skills).toEqual(['RAG', 'NestJS', 'React']);
    expect(res.note).toContain('determinística');
  });

  it('valida prompt mínimo y perfil inexistente', async () => {
    const llm: LlmProvider = { name: 'mock', json: vi.fn() };
    const svcOk = new ProfileCustomResumeService(makePrisma() as never, llm);
    await expect(svcOk.generate('prof_1', { prompt: 'hi' })).rejects.toThrow(
      BadRequestException,
    );

    const svcMissing = new ProfileCustomResumeService(
      makePrisma({ exists: false }) as never,
      llm,
    );
    await expect(
      svcMissing.generate('no_existe', { prompt: 'Posición backend con NestJS' }),
    ).rejects.toThrow(NotFoundException);
  });
});
