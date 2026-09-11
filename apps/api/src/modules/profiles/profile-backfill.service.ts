import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { VacancyStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { JsonLogger } from '../../common/json-logger.service';
import { PrismaService } from '../../common/prisma.service';
import { queueName, QUEUES } from '../../config/queue.config';

/** Estados que ya pasaron por la normalización: son los que se pueden matchear. */
const MATCHABLE_STATUS: VacancyStatus[] = [
  VacancyStatus.NORMALIZED,
  VacancyStatus.MATCHED,
  VacancyStatus.RESUME_READY,
];

/**
 * Tope por corrida: cada match es una llamada a la IA, así que un backfill de
 * golpe sobre miles de vacantes costaría caro. Si quedan pendientes, la UI lo
 * avisa y se vuelve a correr.
 */
const MAX_BATCH = 200;

export interface BackfillResult {
  /** Vacantes candidatas que se encontraron. */
  candidates: number;
  /** Jobs de match encolados en esta corrida. */
  enqueued: number;
  /** Pendientes para una próxima corrida (0 si se cubrieron todas). */
  remaining: number;
}

/**
 * Re-evaluación de vacantes ya guardadas contra un perfil.
 *
 * El pipeline normal solo matchea lo que ACABA de scrapearse; si un perfil
 * aparece después (o se le tilda una fuente, o se le activa la HV), las
 * vacantes viejas se quedarían sin evaluar. Este servicio cierra ese hueco
 * encolando un match por (vacante, perfil) que aún no tenga su fila.
 *
 * Es idempotente: solo toma vacantes SIN `VacancyProfile` de ese perfil, y el
 * `jobId` único evita duplicar el trabajo encolado.
 */
@Injectable()
export class ProfileBackfillService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(queueName(QUEUES.MATCH)) private readonly matchQueue: Queue,
    private readonly logger: JsonLogger,
  ) {}

  /**
   * Vacantes que le corresponden al perfil (las de sus fuentes tildadas) y que
   * todavía no fueron evaluadas por él.
   */
  async enqueueForProfile(profileId: string): Promise<BackfillResult> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: profileId },
      select: { id: true, isPrimary: true },
    });
    if (!profile) return { candidates: 0, enqueued: 0, remaining: 0 };

    const sourceIds = await this.visibleSourceIds(profileId, profile.isPrimary);
    if (sourceIds.length === 0) return { candidates: 0, enqueued: 0, remaining: 0 };

    const where = {
      sourceId: { in: sourceIds },
      status: { in: MATCHABLE_STATUS },
      vacancyProfiles: { none: { profileId } },
    } as const;

    const candidates = await this.prisma.vacancy.count({ where });
    const batch = await this.prisma.vacancy.findMany({
      where,
      select: { id: true },
      orderBy: { createdAt: 'desc' },
      take: MAX_BATCH,
    });

    for (const vacancy of batch) {
      // PENDING es el estado previo al match (lo pone el normalizer en el fan-out).
      await this.prisma.vacancyProfile.upsert({
        where: { vacancyId_profileId: { vacancyId: vacancy.id, profileId } },
        update: {},
        create: { vacancyId: vacancy.id, profileId },
      });
      await this.matchQueue.add(
        'default',
        { vacancyId: vacancy.id, profileId },
        matchJobOpts(vacancy.id, profileId),
      );
    }

    const result: BackfillResult = {
      candidates,
      enqueued: batch.length,
      remaining: Math.max(0, candidates - batch.length),
    };
    this.logger.log(
      { msg: 'backfill por perfil', profileId, ...result },
      ProfileBackfillService.name,
    );
    return result;
  }

  /**
   * Fuentes que el perfil ve: las que tiene tildadas; si es el primario, además
   * las que nadie tildó (mismo criterio que el fan-out de `normalize.service`).
   */
  private async visibleSourceIds(profileId: string, isPrimary: boolean): Promise<string[]> {
    const selections = await this.prisma.profileSource.findMany({
      where: { profileId, enabled: true, source: { enabled: true } },
      select: { sourceId: true },
    });
    const ids = new Set(selections.map((s) => s.sourceId));

    if (isPrimary) {
      const orphans = await this.prisma.source.findMany({
        where: {
          enabled: true,
          vacancies: { some: { status: { in: MATCHABLE_STATUS } } },
          selections: { none: { enabled: true } },
        },
        select: { id: true },
      });
      for (const source of orphans) ids.add(source.id);
    }
    return [...ids];
  }
}

/** Mismas opciones que el fan-out del normalizer (jobId único = sin duplicados). */
function matchJobOpts(vacancyId: string, profileId: string) {
  return {
    jobId: `match-${vacancyId}-${profileId}`,
    attempts: 4,
    backoff: { type: 'exponential' as const, delay: 3000 },
    removeOnComplete: { age: 86400, count: 1000 },
    removeOnFail: { age: 7 * 86400 },
  };
}
