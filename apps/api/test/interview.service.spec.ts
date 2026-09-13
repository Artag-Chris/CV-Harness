import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  InterviewService,
  withPreservedProgress,
} from '../src/modules/interview/interview.service';

const vacancy = {
  id: 'v1',
  title: 'Backend Developer',
  company: 'Finova',
  location: 'Remoto',
  modality: 'Remoto',
  seniorityLevel: 'SENIOR',
  descriptionRaw: 'Buscamos backend con Node y Postgres',
  enrichment: {
    summary: 'Rol backend',
    keyRequirements: ['Node.js', 'PostgreSQL'],
    niceToHave: ['Docker'],
    skills: ['TypeScript'],
  },
  source: { id: 's1', name: 'Computrabajo' },
};

const profile = { id: 'p1', name: 'Christian', applyLanguage: 'auto' };

const validAiResult = {
  summary: 'Buen encaje, repasá Postgres.',
  focusAreas: ['PostgreSQL'],
  studyPlan: [{ topic: 'PostgreSQL', why: 'Requisito', resources: [], practice: '' }],
  likelyQuestions: [{ question: '¿Experiencia con Node?', category: 'técnica', answerOutline: 'STAR' }],
  trickyQuestions: [
    { question: '¿Mayor debilidad?', whyTricky: 'Busca autoconocimiento', howToAnswer: 'Sé honesto' },
  ],
  redFlags: [],
  questionsToAsk: ['¿Cómo se ve el éxito a 6 meses?'],
  checklist: [{ item: 'Repasar la HV', done: false }],
};

function makeService(opts: {
  vacancyExists?: boolean;
  profileExists?: boolean;
  vp?: { profileId?: string; status?: string } | null;
  allVps?: { profileId: string }[];
  match?: { score: number; gaps: string[]; applicationStrategy: Record<string, unknown> } | null;
  llmResult?: Record<string, unknown> | null;
  previousPrep?: { content: unknown } | null;
  prepExistsForSave?: boolean;
}) {
  const interviewJobs: { data: unknown; opts: { jobId?: string } }[] = [];
  const notificationJobs: { data: unknown }[] = [];
  const upserts: { update: Record<string, unknown>; create: Record<string, unknown> }[] = [];
  const updates: { data: Record<string, unknown> }[] = [];

  const prisma = {
    vacancy: {
      findUnique: () =>
        Promise.resolve(opts.vacancyExists === false ? null : vacancy),
      findMany: () => Promise.resolve(opts.allVps ?? []),
    },
    profile: {
      findUnique: () => Promise.resolve(opts.profileExists === false ? null : profile),
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
    matchResult: { findUnique: () => Promise.resolve(opts.match ?? null) },
    vacancyProfile: {
      findUnique: () => Promise.resolve(opts.vp ?? null),
      findMany: () => Promise.resolve(opts.allVps ?? []),
    },
    interviewPrep: {
      findUnique: () =>
        Promise.resolve(
          opts.prepExistsForSave === false
            ? null
            : (opts.previousPrep ?? null),
        ),
      upsert: (args: { update: Record<string, unknown>; create: Record<string, unknown> }) => {
        upserts.push(args);
        return Promise.resolve({ id: 'ip1', ...args.create });
      },
      update: (args: { where: { id: string }; data: Record<string, unknown> }) => {
        updates.push(args);
        return Promise.resolve({
          id: args.where.id,
          profileId: 'p1',
          version: 2,
          status: 'FINAL',
          source: 'editada',
          content: args.data.content,
        });
      },
    },
  };

  const interviewQueue = {
    add: (_n: string, data: unknown, o: { jobId?: string }) => {
      interviewJobs.push({ data, opts: o });
      return Promise.resolve({});
    },
  };
  const notificationQueue = {
    add: (_n: string, data: unknown) => {
      notificationJobs.push({ data });
      return Promise.resolve({});
    },
  };
  const llm = {
    name: opts.llmResult ? 'deepseek' : 'mock',
    json: () => Promise.resolve(opts.llmResult ?? null),
  };
  const logger = { log: () => {}, error: () => {}, warn: () => {} };

  return {
    service: new InterviewService(
      prisma as never,
      llm as never,
      interviewQueue as never,
      notificationQueue as never,
      logger as never,
    ),
    interviewJobs,
    notificationJobs,
    upserts,
    updates,
  };
}

describe('InterviewService.enqueue', () => {
  it('exige que la vacante esté aplicada', async () => {
    const { service, interviewJobs } = makeService({ vp: { profileId: 'p1', status: 'MATCHED' } });
    await expect(service.enqueue('v1', 'p1')).rejects.toBeInstanceOf(BadRequestException);
    expect(interviewJobs).toHaveLength(0);
  });

  it('encola la preparación cuando está aplicada', async () => {
    const { service, interviewJobs } = makeService({
      vp: { profileId: 'p1', status: 'APPLIED' },
    });
    const res = await service.enqueue('v1', 'p1');
    expect(res).toMatchObject({ ok: true, queued: true, profileId: 'p1' });
    expect(interviewJobs[0].data).toEqual({ vacancyId: 'v1', profileId: 'p1' });
    expect(interviewJobs[0].opts.jobId).toMatch(/^interview-v1-p1-\d+$/);
  });

  it('sin profileId exige un único perfil', async () => {
    const { service } = makeService({
      vp: { profileId: 'p1', status: 'APPLIED' },
      allVps: [{ profileId: 'p1' }],
    });
    const res = await service.enqueue('v1');
    expect(res.profileId).toBe('p1');
  });

  it('un perfil que no evaluó la vacante se rechaza', async () => {
    const { service } = makeService({ vp: null });
    await expect(service.enqueue('v1', 'p2')).rejects.toThrow(/no evaluó/);
  });

  it('una vacante inexistente da 404', async () => {
    const { service } = makeService({ vacancyExists: false });
    await expect(service.enqueue('nope', 'p1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('InterviewService.handle', () => {
  it('con IA válida persiste el plan con fuente ia y notifica', async () => {
    const { service, upserts, notificationJobs } = makeService({ llmResult: validAiResult });
    await service.handle('v1', 'p1');

    expect(upserts).toHaveLength(1);
    expect(upserts[0].update.source).toBe('ia');
    const content = upserts[0].update.content as { summary: string };
    expect(content.summary).toContain('Postgres');
    expect(notificationJobs[0].data).toMatchObject({ type: 'INTERVIEW_READY' });
  });

  it('sin proveedor LLM genera un plan determinístico', async () => {
    const { service, upserts } = makeService({ llmResult: null });
    await service.handle('v1', 'p1');

    expect(upserts[0].update.source).toBe('plantilla');
    const content = upserts[0].update.content as {
      studyPlan: unknown[];
      likelyQuestions: unknown[];
      trickyQuestions: unknown[];
      checklist: { done: boolean }[];
    };
    expect(content.studyPlan.length).toBeGreaterThan(0);
    expect(content.likelyQuestions.length).toBeGreaterThanOrEqual(6);
    expect(content.trickyQuestions.length).toBeGreaterThanOrEqual(4);
    expect(content.checklist.every((c) => c.done === false)).toBe(true);
  });

  it('al regenerar conserva el avance marcado antes', async () => {
    const { service, upserts } = makeService({
      llmResult: null,
      previousPrep: {
        content: {
          studyPlan: [{ topic: 'Node.js', done: true }],
          checklist: [{ item: 'Repasar tu HV y poder contar cada bullet con un ejemplo real.', done: true }],
        },
      },
    });
    await service.handle('v1', 'p1');

    const content = upserts[0].update.content as {
      studyPlan: { topic: string; done?: boolean }[];
      checklist: { item: string; done: boolean }[];
    };
    expect(content.studyPlan.find((t) => t.topic === 'Node.js')?.done).toBe(true);
    expect(
      content.checklist.find(
        (c) => c.item === 'Repasar tu HV y poder contar cada bullet con un ejemplo real.',
      )?.done,
    ).toBe(true);
  });

  it('no hace nada si falta la vacante o el perfil', async () => {
    const { service, upserts } = makeService({ profileExists: false });
    await service.handle('v1', 'p1');
    expect(upserts).toHaveLength(0);
  });
});

describe('InterviewService.saveEdited', () => {
  it('guarda el contenido editado sin perder el resto del plan', async () => {
    const { service, updates } = makeService({
      previousPrep: {
        content: {
          summary: 'Plan original',
          studyPlan: [{ topic: 'Node.js' }],
          checklist: [{ item: 'A', done: false }],
        },
      },
    });
    const result = await service.saveEdited('ip1', { checklist: [{ item: 'A', done: true }] });

    expect(result.source).toBe('editada');
    const saved = updates[0].data.content as Record<string, unknown>;
    expect(saved.summary).toBe('Plan original');
    expect(saved.studyPlan).toEqual([{ topic: 'Node.js' }]);
    expect(saved.checklist).toEqual([{ item: 'A', done: true }]);
    expect(updates[0].data.version).toEqual({ increment: 1 });
    expect(updates[0].data.status).toBe('FINAL');
  });

  it('preparación inexistente da 404', async () => {
    const { service } = makeService({ prepExistsForSave: false });
    await expect(service.saveEdited('nope', {})).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('withPreservedProgress', () => {
  it('re-aplica el done de temas y checklist que coinciden por texto', () => {
    const base = {
      summary: '',
      focusAreas: [],
      studyPlan: [
        { topic: 'Node.js', why: '', resources: [], practice: '' },
        { topic: 'Docker', why: '', resources: [], practice: '' },
      ],
      likelyQuestions: [],
      trickyQuestions: [],
      redFlags: [],
      questionsToAsk: [],
      checklist: [{ item: 'A', done: false }],
    };
    const result = withPreservedProgress(base, {
      studyPlan: [{ topic: 'Node.js', done: true }],
      checklist: [{ item: 'A', done: true }],
    });
    expect(result.studyPlan[0].done).toBe(true);
    expect(result.studyPlan[1].done).toBeUndefined();
    expect(result.checklist[0].done).toBe(true);
  });

  it('sin contenido previo devuelve el plan tal cual', () => {
    const base = {
      summary: 'x',
      focusAreas: [],
      studyPlan: [{ topic: 'Node.js', why: '', resources: [], practice: '' }],
      likelyQuestions: [],
      trickyQuestions: [],
      redFlags: [],
      questionsToAsk: [],
      checklist: [],
    };
    expect(withPreservedProgress(base, null)).toEqual(base);
  });
});
