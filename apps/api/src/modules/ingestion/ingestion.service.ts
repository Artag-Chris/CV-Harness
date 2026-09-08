import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Prisma, VacancyStatus } from '@prisma/client';
import { z } from 'zod';
import { JsonLogger } from '../../common/json-logger.service';
import { fingerprint } from '../../common/hash.util';
import { PrismaService } from '../../common/prisma.service';
import { cleanDescription } from '../../common/text.util';
import { queueName, QUEUES } from '../../config/queue.config';
import { NotificationService } from '../notification/notification.service';
import {
  ScraperItemSchema,
  ScraperResultPayloadSchema,
} from '../pipeline/pipeline.types';

/**
 * Recibe el resultado del scraper Rust, deduplica por fingerprint(url) y
 * encola cada vacante nueva para su normalización con IA.
 */
@Injectable()
export class IngestionService {
  private primaryProfileIdCache: string | null | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    @InjectQueue(queueName(QUEUES.NORMALIZE))
    private readonly normalizeQueue: Queue,
    private readonly logger: JsonLogger,
  ) {}

  async processResult(raw: unknown): Promise<{ itemsNew: number; itemsFound: number }> {
    const payload = ScraperResultPayloadSchema.parse(raw);
    const run = await this.prisma.scrapeRun.findUnique({
      where: { requestId: payload.requestId },
    });

    if (payload.error) {
      await this.finalizeRun(run?.id, 'FAILED', 0, 0, payload.error);
      if (run) {
        await this.notifications.create({
          type: 'SCRAPE_ERROR',
          title: `Error de scraping en "${run.sourceId}"`,
          body: payload.error.slice(0, 300),
          payload: { requestId: payload.requestId, sourceId: run.sourceId },
        });
      }
      return { itemsNew: 0, itemsFound: 0 };
    }

    // Resultado huérfano (requestId sin corrida en BD — ej. DB reseteada).
    // No hay fuente a la cual atribuir los ítems: se descarta con log.
    if (!run) {
      this.logger.warn(
        { msg: 'resultado sin ScrapeRun (huérfano) — descartado', requestId: payload.requestId },
        IngestionService.name,
      );
      return { itemsNew: 0, itemsFound: 0 };
    }

    const items = payload.items ?? [];
    const source = await this.prisma.source.findUnique({ where: { id: run.sourceId } });
    if (!source) {
      // La fuente se borró mientras la corrida estaba en vuelo.
      await this.finalizeRun(run.id, 'FAILED', 0, 0, 'fuente eliminada durante la corrida');
      return { itemsNew: 0, itemsFound: 0 };
    }
    const profileId = await this.resolveProfileId(source.profileId ?? null);

    let itemsNew = 0;
    let itemsSkipped = 0;
    for (const item of items) {
      // Ítems individuales malformados no deben tirar abajo el lote.
      const parsed = ScraperItemSchema.safeParse(item);
      if (!parsed.success) {
        itemsSkipped += 1;
        continue;
      }
      if (await this.ingestItem(parsed.data, run.sourceId, profileId)) {
        itemsNew += 1;
      }
    }

    await this.finalizeRun(run.id, 'OK', items.length, itemsNew, null);
    this.logger.log(
      {
        msg: 'resultado de scraping ingerido',
        requestId: payload.requestId,
        sourceId: run.sourceId,
        itemsFound: items.length,
        itemsNew,
        itemsSkipped,
      },
      IngestionService.name,
    );
    return { itemsNew, itemsFound: items.length };
  }

  /** Crea la vacante si el fingerprint no existe. Devuelve true si fue nueva. */
  private async ingestItem(
    item: z.infer<typeof ScraperItemSchema>,
    sourceId: string,
    profileId: string | null,
  ): Promise<boolean> {
    const url = (item.url ?? '').trim();
    const fp = fingerprint(url);
    const existing = await this.prisma.vacancy.findUnique({
      where: { fingerprint: fp },
      select: { id: true, status: true },
    });
    if (existing) {
      // Vacante RAW sin procesar (carrera o fallo previo al encolar):
      // garantiza su job de normalización (jobId único → idempotente).
      if (existing.status === VacancyStatus.RAW) {
        await this.safeEnqueueNormalize(existing.id);
      }
      return false;
    }

    const descriptionHtml = item.descriptionHtml ?? '';
    const descriptionText =
      item.descriptionText && item.descriptionText.trim().length > 0
        ? item.descriptionText.trim()
        : cleanDescription(descriptionHtml);
    const postedAt = this.parseDate(item.postedAt);

    let vacancyId: string | null = null;
    try {
      const vacancy = await this.prisma.vacancy.create({
        data: {
          sourceId,
          profileId,
          fingerprint: fp,
          externalId: item.externalId ?? url,
          url,
          title: item.title.trim(),
          company: item.company ?? null,
          location: item.location ?? null,
          salary: item.salary ?? null,
          modality: item.modality ?? null,
          postedAt,
          descriptionRaw: descriptionText,
          raw: {
            applyUrl: item.applyUrl ?? url,
            postedAtRaw: item.postedAt ?? null,
            externalId: item.externalId ?? url,
            company: item.company ?? null,
            location: item.location ?? null,
          } as Prisma.InputJsonValue,
        },
      });
      vacancyId = vacancy.id;
    } catch (err) {
      // Carrera de dedup entre ciclos: otro worker ya creó el fingerprint.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return false;
      }
      throw err;
    }

    await this.safeEnqueueNormalize(vacancyId);
    return true;
  }

  /**
   * Encola la normalización de una vacante. Si Redis/cola falla, la vacante
   * queda RAW y el próximo ciclo que vea el mismo fingerprint la vuelve a
   * encolar (auto-recuperación), por eso acá solo se loguea.
   */
  private async safeEnqueueNormalize(vacancyId: string): Promise<void> {
    try {
      await this.normalizeQueue.add(
        'default',
        { vacancyId },
        this.jobOpts(vacancyId),
      );
    } catch (err) {
      this.logger.error(
        { msg: 'no se pudo encolar normalización (vacante RAW, se reintentará)', vacancyId, err: String(err) },
        IngestionService.name,
      );
    }
  }

  private async resolveProfileId(explicit: string | null): Promise<string | null> {
    if (explicit) return explicit;
    if (this.primaryProfileIdCache !== undefined) return this.primaryProfileIdCache;
    const primary = await this.prisma.profile.findFirst({
      where: { isPrimary: true },
      select: { id: true },
    });
    this.primaryProfileIdCache = primary?.id ?? null;
    return this.primaryProfileIdCache;
  }

  private async finalizeRun(
    runId: string | undefined,
    status: 'OK' | 'FAILED',
    itemsFound: number,
    itemsNew: number,
    error: string | null,
  ): Promise<void> {
    if (!runId) return;
    await this.prisma.scrapeRun.update({
      where: { id: runId },
      data: {
        status,
        finishedAt: new Date(),
        itemsFound,
        itemsNew,
        error,
      },
    });
  }

  private parseDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private jobOpts(jobId: string) {
    return {
      jobId: `normalize-${jobId}`,
      attempts: 4,
      backoff: { type: 'exponential' as const, delay: 3000 },
      removeOnComplete: { age: 86400, count: 1000 },
      removeOnFail: { age: 7 * 86400 },
    };
  }
}
