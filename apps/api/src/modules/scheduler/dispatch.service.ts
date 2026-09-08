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

  /** Ciclo del cron: despacha todas las fuentes habilitadas y vencidas. */
  async runCycle(): Promise<number> {
    const due = await this.prisma.source.findMany({
      where: { enabled: true, nextRunAt: { lte: new Date() } },
    });
    let dispatched = 0;
    for (const source of due) {
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
    if (due.length > 0) {
      this.logger.log(
        { msg: 'crawl-cycle done', sourcesDue: due.length, dispatched },
        DispatchService.name,
      );
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
