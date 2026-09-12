import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ProfileImportService } from '../src/modules/profiles/profile-import.service';

const LONG_TEXT = 'x'.repeat(250);

/**
 * Import de HV → perfil estructurado. Lo que importa verificar:
 *  1. sin proveedor LLM no toca la BD,
 *  2. con parseo completo escribe las secciones y las deduplica,
 *  3. un parseo PARCIAL no borra lo que ya estaba (no vacía el perfil).
 */
function makeService(opts: { profile?: unknown; ai?: Record<string, unknown> | null }) {
  const calls = {
    deleted: [] as string[],
    profileUpdate: [] as unknown[],
    experience: [] as unknown[],
    education: [] as unknown[],
    projects: [] as unknown[],
    profileSkills: [] as unknown[],
    contactLinks: [] as unknown[],
    skillUpserts: [] as string[],
  };

  const prisma = {
    profile: {
      findUnique: () => Promise.resolve(opts.profile ?? null),
      update: (args: unknown) => {
        calls.profileUpdate.push(args);
        return Promise.resolve({});
      },
    },
    skill: {
      upsert: (args: { where: { name: string } }) => {
        calls.skillUpserts.push(args.where.name);
        return Promise.resolve({ id: `skill-${args.where.name}` });
      },
    },
    experience: {
      deleteMany: () => {
        calls.deleted.push('experience');
        return Promise.resolve({});
      },
      create: (args: unknown) => {
        calls.experience.push(args);
        return Promise.resolve({});
      },
    },
    education: {
      deleteMany: () => {
        calls.deleted.push('education');
        return Promise.resolve({});
      },
      create: (args: unknown) => {
        calls.education.push(args);
        return Promise.resolve({});
      },
    },
    project: {
      deleteMany: () => {
        calls.deleted.push('project');
        return Promise.resolve({});
      },
      create: (args: unknown) => {
        calls.projects.push(args);
        return Promise.resolve({});
      },
    },
    profileSkill: {
      deleteMany: () => {
        calls.deleted.push('profileSkill');
        return Promise.resolve({});
      },
      create: (args: unknown) => {
        calls.profileSkills.push(args);
        return Promise.resolve({});
      },
    },
    contactLink: {
      deleteMany: () => {
        calls.deleted.push('contactLink');
        return Promise.resolve({});
      },
      create: (args: unknown) => {
        calls.contactLinks.push(args);
        return Promise.resolve({});
      },
    },
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  };
  const llm = { name: 'fake', json: () => Promise.resolve(opts.ai ?? null) };
  const logger = { log: () => {}, error: () => {}, warn: () => {} };

  return { service: new ProfileImportService(prisma as never, llm as never, logger as never), calls };
}

const FULL_AI = {
  name: 'Christian Henao',
  headline: ['AI Engineer', 'Team Leader'],
  summary: 'Resumen del perfil.',
  email: 'scristxyz@gmail.com',
  phone: '+57 320 571 1428',
  location: 'Pereira, Colombia',
  languages: [{ language: 'Español', level: 'Nativo' }],
  softSkills: ['Liderazgo técnico'],
  links: [
    { type: 'github', url: 'https://github.com/Artag-Chris' },
    { type: 'github', url: 'https://github.com/Artag-Chris' }, // duplicado
  ],
  experiences: [
    {
      role: 'Team Leader & Full Stack Developer',
      company: 'Finova SAS',
      periodStart: '2024',
      periodEnd: 'Ago 2026',
      isCurrent: false,
      bullets: ['Lideré un equipo de 4 desarrolladores.'],
    },
  ],
  education: [
    { institution: 'SENA', degree: 'Diseño Multimedia y Web', periodStart: '2023', periodEnd: null },
  ],
  projects: [
    {
      name: 'Atiende',
      summary: 'Agente conversacional',
      stack: ['NestJS', 'pgvector'],
      repositoryUrl: 'https://github.com/Artag-Chris/atiende',
      visibility: 'public',
      highlights: ['En producción en 3 canales.'],
    },
  ],
  skills: [
    { category: 'IA & LLMs', name: 'RAG', rating: 4, knowledge: 'pgvector' },
    { category: 'Backend', name: 'RAG', rating: 4 }, // misma skill en otra categoría
  ],
};

describe('ProfileImportService', () => {
  it('sin proveedor LLM no toca la BD y lo informa', async () => {
    const { service, calls } = makeService({ profile: { id: 'p1' }, ai: null });
    const result = await service.importFromMarkdown('p1', LONG_TEXT);
    expect(result.applied).toBe(false);
    expect(result.note).toMatch(/IA no está configurado/i);
    expect(calls.deleted).toHaveLength(0);
    expect(calls.profileUpdate).toHaveLength(0);
  });

  it('un perfil inexistente da 404', async () => {
    const { service } = makeService({ profile: null, ai: FULL_AI });
    await expect(service.importFromMarkdown('nope', LONG_TEXT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('un texto muy corto no es una HV', async () => {
    const { service } = makeService({ profile: { id: 'p1' }, ai: FULL_AI });
    await expect(service.importFromMarkdown('p1', 'muy corto')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('importa el parseo completo: escalares, secciones y conteos', async () => {
    const { service, calls } = makeService({ profile: { id: 'p1' }, ai: FULL_AI });
    const result = await service.importFromMarkdown('p1', LONG_TEXT);

    expect(result.applied).toBe(true);
    expect(result.counts).toEqual({
      experiences: 1,
      education: 1,
      projects: 1,
      skills: 1, // "RAG" repetida se deduplica
      links: 1, // la URL repetida se deduplica
    });
    // Reemplaza cada sección antes de crearla (evita duplicados al re-importar).
    expect(calls.deleted).toEqual(['experience', 'education', 'project', 'profileSkill', 'contactLink']);
    expect(calls.experience).toHaveLength(1);
    expect(calls.education).toHaveLength(1);
    expect(calls.projects).toHaveLength(1);
    expect(calls.profileSkills).toHaveLength(1);
    expect(calls.contactLinks).toHaveLength(1);
    expect(calls.skillUpserts).toEqual(['RAG']);
    // Los escalares se pisan con lo que trae el MD.
    expect(calls.profileUpdate[0]).toMatchObject({
      where: { id: 'p1' },
      data: { name: 'Christian Henao', location: 'Pereira, Colombia' },
    });
  });

  it('un parseo PARCIAL no borra lo que ya existía (perfil a salvo)', async () => {
    // El modelo devolvió solo skills y resumen: no debe tocar experiencia,
    // formación, proyectos ni enlaces.
    const { service, calls } = makeService({
      profile: { id: 'p1' },
      ai: { summary: 'Solo resumen', skills: [{ category: 'Backend', name: 'Rust', rating: 3 }] },
    });
    const result = await service.importFromMarkdown('p1', LONG_TEXT);

    expect(result.counts).toEqual({
      experiences: 0,
      education: 0,
      projects: 0,
      skills: 1,
      links: 0,
    });
    expect(calls.deleted).toEqual(['profileSkill']);
    expect(calls.experience).toHaveLength(0);
    expect(calls.projects).toHaveLength(0);
    expect(calls.profileUpdate).toHaveLength(1);
  });

  it('no pisa el email con null (campo opcional ausente)', async () => {
    const { service, calls } = makeService({
      profile: { id: 'p1' },
      ai: { email: null, summary: 'Resumen' },
    });
    await service.importFromMarkdown('p1', LONG_TEXT);
    const data = (calls.profileUpdate[0] as { data: Record<string, unknown> }).data;
    expect(data).not.toHaveProperty('email');
    expect(data.summary).toBe('Resumen');
  });
});
