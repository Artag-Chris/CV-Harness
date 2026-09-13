import { describe, expect, it } from 'vitest';
import {
  InterviewPrepController,
  InterviewVacancyController,
} from '../src/modules/interview/interview.controller';

describe('InterviewVacancyController', () => {
  it('delega la generación en el servicio con el profileId', async () => {
    const calls: [string, string | undefined][] = [];
    const service = {
      enqueue: (id: string, profileId?: string) => {
        calls.push([id, profileId]);
        return Promise.resolve({ ok: true, queued: true, profileId: profileId ?? 'p1' });
      },
    };
    const controller = new InterviewVacancyController(service as never);

    const res = await controller.generate('v1', 'p1');
    expect(res).toMatchObject({ ok: true, queued: true });
    expect(calls[0]).toEqual(['v1', 'p1']);
  });
});

describe('InterviewPrepController', () => {
  it('guarda el contenido editado', async () => {
    const saved: { id: string; content: Record<string, unknown> }[] = [];
    const service = {
      saveEdited: (id: string, content: Record<string, unknown>) => {
        saved.push({ id, content });
        return Promise.resolve({ id, content });
      },
    };
    const controller = new InterviewPrepController(service as never);

    const res = await controller.update('ip1', { content: { summary: 'editado' } });
    expect(res).toMatchObject({ id: 'ip1' });
    expect(saved[0]).toEqual({ id: 'ip1', content: { summary: 'editado' } });
  });

  it('rechaza un body sin content', () => {
    const service = { saveEdited: () => Promise.resolve({}) };
    const controller = new InterviewPrepController(service as never);
    expect(() => controller.update('ip1', {})).toThrow();
  });
});
