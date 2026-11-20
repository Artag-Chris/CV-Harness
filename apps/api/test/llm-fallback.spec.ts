import { describe, it, expect, vi } from 'vitest';
import { VacancyStatus } from '@prisma/client';
import { NormalizeService } from '../src/modules/normalizer/normalize.service';
import { MatchService } from '../src/modules/matcher/match.service';
import { VacanciesService } from '../src/modules/vacancies/vacancies.service';
import type { LlmProvider } from '../src/modules/llm/llm-provider.port';

const noopLogger = {
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('Respaldo automático cuando el LLM falla con error', () => {
  it('NormalizeService: si DeepSeek/Groq lanza error, guarda extracción básica determinística y encola match', async () => {
    const updated: Record<string, unknown>[] = [];
    const matchJobs: unknown[] = [];
    const prisma = {
      vacancy: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'vac_1',
          sourceId: 'src_1',
          profileId: null,
          title: 'Backend Developer NestJS',
          company: 'Acme',
          location: 'Remoto',
          salary: null,
          modality: null,
          status: VacancyStatus.RAW,
          descriptionRaw:
            'Buscamos desarrollador Backend Senior 100% remoto con experiencia en NestJS, PostgreSQL y Redis.',
        }),
        update: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
          updated.push(args.data);
          return Promise.resolve({});
        }),
      },
      profileSource: {
        findMany: vi.fn().mockResolvedValue([{ profileId: 'prof_1' }]),
      },
      vacancyProfile: {
        upsert: vi.fn().mockResolvedValue({}),
      },
    };
    const failingLlm: LlmProvider = {
      name: 'deepseek',
      json: vi.fn().mockRejectedValue(new Error('DeepSeek HTTP 402: Insufficient Balance')),
    };
    const matchQueue = {
      add: vi.fn().mockImplementation((_n, data) => {
        matchJobs.push(data);
        return Promise.resolve({});
      }),
    };

    const svc = new NormalizeService(
      prisma as never,
      failingLlm,
      matchQueue as never,
      noopLogger as never,
    );

    await svc.handle('vac_1');

    expect(updated).toHaveLength(1);
    expect(updated[0].status).toBe(VacancyStatus.NORMALIZED);
    expect((updated[0].enrichment as Record<string, unknown>).mode).toBe('deterministic');
    expect(updated[0].modalityTypes).toContain('REMOTE');
    expect(matchJobs).toEqual([{ vacancyId: 'vac_1', profileId: 'prof_1' }]);
  });

  it('MatchService: si DeepSeek/Groq lanza error, guarda match básico determinístico sin perder la vacante', async () => {
    const savedMatches: Record<string, unknown>[] = [];
    const prisma = {
      vacancy: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'vac_1',
          sourceId: 'src_1',
          title: 'Backend Developer NestJS',
          company: 'Acme',
          location: 'Remoto',
          descriptionRaw: 'NestJS, TypeScript y PostgreSQL',
          enrichment: { skills: ['nestjs', 'typescript', 'postgresql'] },
          source: { id: 'src_1', name: 'Test' },
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      profile: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'prof_1',
          name: 'Christian',
          skills: [
            { skill: { name: 'NestJS' } },
            { skill: { name: 'TypeScript' } },
          ],
        }),
        findFirst: vi.fn().mockResolvedValue({
          id: 'prof_1',
          name: 'Christian',
          headline: ['Backend'],
          summary: 'Dev',
          experiences: [],
          education: [],
          projects: [],
          skills: [],
          links: [],
        }),
      },
      vacancyProfile: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([{ status: 'MATCHED' }]),
      },
      matchResult: {
        upsert: vi.fn().mockImplementation((args: { create: Record<string, unknown> }) => {
          savedMatches.push(args.create);
          return Promise.resolve({ id: 'm_1', ...args.create });
        }),
        findMany: vi.fn().mockResolvedValue([{ score: 75 }]),
      },
    };
    const failingLlm: LlmProvider = {
      name: 'deepseek',
      json: vi.fn().mockRejectedValue(new Error('DeepSeek HTTP 429: Too Many Requests')),
    };
    const resumes = {
      searchActiveResume: vi.fn().mockResolvedValue({ hits: [], bestScore: null }),
    };
    const resumeQueue = { add: vi.fn() };

    const svc = new MatchService(
      prisma as never,
      failingLlm,
      resumeQueue as never,
      resumes as never,
      noopLogger as never,
    );

    await svc.handle('vac_1', 'prof_1');

    expect(savedMatches).toHaveLength(1);
    expect(typeof savedMatches[0].score).toBe('number');
  });
});

describe('VacanciesService.list — ver scrapings sin filtro', () => {
  it('ignora minScore cuando el estado pedido es RAW o NORMALIZED', async () => {
    const captured: Record<string, unknown>[] = [];
    const prisma = {
      vacancy: {
        findMany: (args: { where: Record<string, unknown> }) => {
          captured.push(args.where);
          return Promise.resolve([]);
        },
        count: () => Promise.resolve(0),
      },
      $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
    };
    const stubQueue = { add: () => Promise.resolve({}) } as never;
    const svc = new VacanciesService(prisma as never, stubQueue, stubQueue);

    await svc.list({ status: VacancyStatus.RAW, minScore: 70 });
    await svc.list({ status: VacancyStatus.NORMALIZED, minScore: 70 });

    expect(captured[0]).not.toHaveProperty('matches');
    expect(captured[1]).not.toHaveProperty('matches');
  });

  it('devuelve unfilteredTotal cuando minScore oculta vacantes scrapeadas', async () => {
    let countCall = 0;
    const prisma = {
      vacancy: {
        findMany: () => Promise.resolve([]),
        count: () => {
          countCall += 1;
          // 1ª llamada = filtradas (0), 2ª llamada = sin minScore (12)
          return Promise.resolve(countCall === 1 ? 0 : 12);
        },
      },
      $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
    };
    const stubQueue = { add: () => Promise.resolve({}) } as never;
    const svc = new VacanciesService(prisma as never, stubQueue, stubQueue);

    const res = await svc.list({ minScore: 70 });
    expect(res.total).toBe(0);
    expect(res.unfilteredTotal).toBe(12);
  });
});
