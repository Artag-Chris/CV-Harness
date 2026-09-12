import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { VacanciesService } from '../src/modules/vacancies/vacancies.service';

/**
 * Generación de HV a pedido (por debajo del umbral de match). Lo que se
 * protege: no encolar sin análisis previo, respetar aplicada/ignorada y saber
 * resolver el perfil cuando hay más de uno.
 */
function makeService(opts: {
  vacancyExists?: boolean;
  match?: { id: string } | null;
  vpStatus?: string | null;
  profileVp?: { profileId: string } | null;
  allVps?: { profileId: string }[];
}) {
  const queued: { data: unknown; opts: { jobId?: string } }[] = [];
  const prisma = {
    vacancy: {
      findUnique: () =>
        Promise.resolve(opts.vacancyExists === false ? null : { id: 'v1' }),
    },
    matchResult: { findUnique: () => Promise.resolve(opts.match ?? null) },
    vacancyProfile: {
      findUnique: (args: { where: { vacancyId_profileId: { profileId: string } } }) => {
        const pid = args.where.vacancyId_profileId.profileId;
        if (opts.vpStatus != null) return Promise.resolve({ status: opts.vpStatus });
        return Promise.resolve(opts.profileVp && opts.profileVp.profileId === pid ? opts.profileVp : null);
      },
      findMany: () => Promise.resolve(opts.allVps ?? []),
    },
  };
  const service = new VacanciesService(prisma as never, {
    add: (_n: string, data: unknown, o: { jobId?: string }) => {
      queued.push({ data, opts: o });
      return Promise.resolve({});
    },
  } as never);
  return { service, queued };
}

describe('VacanciesService.enqueueResume', () => {
  it('encola la HV cuando existe el análisis de encaje', async () => {
    const { service, queued } = makeService({ match: { id: 'm1' }, profileVp: { profileId: 'p1' } });

    const res = await service.enqueueResume('v1', 'p1');

    expect(res).toMatchObject({ ok: true, queued: true, profileId: 'p1' });
    expect(queued[0].opts.jobId).toMatch(/^resume-v1-p1-\d+$/);
    expect(queued[0].data).toEqual({ vacancyId: 'v1', profileId: 'p1' });
  });

  /**
   * Regresión: con un `jobId` fijo, BullMQ descarta el segundo encolado mientras
   * el job anterior siga retenido (`removeOnComplete` = 24 h), así que «regenerar
   * la HV» no hacía nada y parecía que el cambio de perfil no se guardaba.
   */
  it('un segundo pedido de regeneración no se descarta por dedup', async () => {
    const { service, queued } = makeService({ match: { id: 'm1' }, profileVp: { profileId: 'p1' } });

    await service.enqueueResume('v1', 'p1');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await service.enqueueResume('v1', 'p1');

    expect(queued).toHaveLength(2);
    expect(queued[0].opts.jobId).not.toBe(queued[1].opts.jobId);
  });

  it('rechaza si todavía no hay análisis de encaje', async () => {
    const { service } = makeService({ match: null, profileVp: { profileId: 'p1' } });
    await expect(service.enqueueResume('v1', 'p1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('no encola si el perfil ya aplicó o ignoró', async () => {
    const { service, queued } = makeService({ match: { id: 'm1' }, vpStatus: 'APPLIED' });
    await expect(service.enqueueResume('v1', 'p1')).rejects.toThrow(/aplicada o ignorada/);
    expect(queued).toHaveLength(0);
  });

  it('rechaza un perfil que no evaluó la vacante', async () => {
    const { service } = makeService({ match: { id: 'm1' }, profileVp: null });
    await expect(service.enqueueResume('v1', 'p2')).rejects.toThrow(/no evaluó/);
  });

  it('sin profileId exige que haya un único perfil', async () => {
    const { service } = makeService({ match: { id: 'm1' }, allVps: [{ profileId: 'p1' }] });
    const res = await service.enqueueResume('v1');
    expect(res.profileId).toBe('p1');
  });

  it('sin profileId y con varios perfiles pide elegir', async () => {
    const { service } = makeService({
      match: { id: 'm1' },
      allVps: [{ profileId: 'p1' }, { profileId: 'p2' }],
    });
    await expect(service.enqueueResume('v1')).rejects.toThrow(/varios perfiles/);
  });

  it('una vacante inexistente da 404', async () => {
    const { service } = makeService({ vacancyExists: false });
    await expect(service.enqueueResume('nope', 'p1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
