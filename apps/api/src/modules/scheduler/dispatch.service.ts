import { Inject, Injectable } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { Source } from '@prisma/client';
import Redis from 'ioredis';
import { JsonLogger } from '../../common/json-logger.service';
import { newRequestId } from '../../common/hash.util';
import { PrismaService } from '../../common/prisma.service';
import { STREAMS } from '../../config/queue.config';
import { REDIS } from '../../config/tokens';
import { NotificationService } from '../notification/notification.service';

export type CrawlJobData =
  | { type: 'cycle' }
  | { type: 'source'; sourceId: string };

export interface ScrapeRequestPayload {
  // Versión del contrato del stream (ver docs/event-flow.md).
  schemaVersion: '1';
  requestId: string;
  sourceId: string;
  sourceName: string;
  baseUrl: string;
  listUrl: string;
  recipe: {
    selectors: unknown;
    limits: unknown;
  };
}

/**
 * Dispatcher: crea el ScrapeRun, publica el trabajo en el stream
 * scraper:requests (que consume el worker Rust) y agenda la siguiente corrida.
 */
@Injectable()
export class DispatchService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly notifications: NotificationService,
    private readonly logger: JsonLogger,
  ) {}

  /** Ciclo del cron: despacha las fuentes vencidas y los perfiles con cron propio. */
  async runCycle(): Promise<number> {
    const now = new Date();
    let dispatched = 0;

    // 1) Fuentes vencidas por su propia cadencia.
    const dueSources = await this.prisma.source.findMany({
      where: { enabled: true, nextRunAt: { lte: now } },
    });
    for (const source of dueSources) {
      try {
        await this.dispatchSource(source);
        dispatched += 1;
      } catch (err) {
        this.logger.error(
          { msg: 'dispatch failed', sourceId: source.id, err: String(err) },
          DispatchService.name,
        );
      }
    }

    // 2) Perfiles con cron propio (scheduleMinutes): corren TODAS sus fuentes.
    const dueProfiles = await this.prisma.profile.findMany({
      where: {
        scheduleMinutes: { not: null },
        nextRunAt: { lte: now },
      },
      include: { sources: { where: { enabled: true } } },
    });
    for (const profile of dueProfiles) {
      dispatched += await this.dispatchProfileSources(profile.id, profile.sources);
      const interval = profile.scheduleMinutes ?? 0;
      await this.prisma.profile.update({
        where: { id: profile.id },
        data: { nextRunAt: new Date(now.getTime() + interval * 60_000) },
      });
    }

    if (dueSources.length + dueProfiles.length > 0) {
      this.logger.log(
        { msg: 'crawl-cycle done', sourcesDue: dueSources.length, profilesDue: dueProfiles.length, dispatched },
        DispatchService.name,
      );
    }
    return dispatched;
  }

  /** Búsqueda manual de un perfil: despacha todas sus fuentes habilitadas. */
  async runProfile(profileId: string): Promise<{ dispatched: number }> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: profileId },
      include: { sources: { where: { enabled: true } } },
    });
    if (!profile) throw new NotFoundException(`Profile ${profileId} no existe`);
    const dispatched = await this.dispatchProfileSources(profile.id, profile.sources);
    return { dispatched };
  }

  /**
   * Despacha las fuentes de un perfil saltándose su nextRunAt individual
   * (el cron del perfil manda).
   */
  private async dispatchProfileSources(
    profileId: string,
    sources: Source[],
  ): Promise<number> {
    let dispatched = 0;
    for (const source of sources) {
      try {
        await this.dispatchSource(source);
        dispatched += 1;
      } catch (err) {
        this.logger.error(
          { msg: 'dispatch failed (perfil)', profileId, sourceId: source.id, err: String(err) },
          DispatchService.name,
        );
      }
    }
    return dispatched;
  }

  /** Disparo manual de una fuente (API), incluso si no está vencida. */
  async runSource(sourceId: string): Promise<{ requestId: string }> {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
    });
    if (!source) throw new NotFoundException(`Source ${sourceId} no existe`);
    return this.dispatchSource(source);
  }

  async dispatchSource(source: Source): Promise<{ requestId: string }> {
    const requestId = newRequestId();
    await this.prisma.scrapeRun.create({
      data: { sourceId: source.id, requestId },
    });

    const payload: ScrapeRequestPayload = {
      schemaVersion: '1',
      requestId,
      sourceId: source.id,
      sourceName: source.name,
      baseUrl: source.baseUrl,
      listUrl: source.listUrl,
      recipe: { selectors: source.selectors, limits: source.limits },
    };

    try {
      await this.redis.xadd(
        STREAMS.REQUESTS,
        '*',
        'payload',
        JSON.stringify(payload),
      );
    } catch (err) {
      await this.prisma.scrapeRun.updateMany({
        where: { requestId },
        data: { status: 'FAILED', finishedAt: new Date(), error: String(err) },
      });
      await this.notifications.create({
        type: 'SOURCE_ERROR',
        title: `No se pudo despachar "${source.name}"`,
        body: `El mensaje no llegó al scraper: ${String(err).slice(0, 200)}`,
        payload: { sourceId: source.id },
      });
      throw err;
    }

    const nextRunAt = new Date(
      Date.now() + source.intervalMinutes * 60_000,
    );
    await this.prisma.source.update({
      where: { id: source.id },
      data: { lastRunAt: new Date(), nextRunAt },
    });

    this.logger.log(
      {
        msg: 'dispatched scrape request',
        requestId,
        sourceId: source.id,
        sourceName: source.name,
        intervalMinutes: source.intervalMinutes,
      },
      DispatchService.name,
    );
    return { requestId };
  }
}
