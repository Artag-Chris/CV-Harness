import { Inject, Injectable } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { Source } from '@prisma/client';
import Redis from 'ioredis';
import { JsonLogger } from '../../common/json-logger.service';
import { newRequestId } from '../../common/hash.util';
import { PrismaService } from '../../common/prisma.service';
import { STREAMS } from '../../config/queue.config';
import { REDIS } from '../../config/tokens';
import { originOf } from '../../common/url.util';
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

  /** Ciclo del cron: fuentes vencidas + perfiles con cron propio (sus selecciones). */
  async runCycle(): Promise<number> {
    const now = new Date();
    let dispatched = 0;
    const dispatchedIds = new Set<string>();
    const dispatchOnce = async (source: Source): Promise<boolean> => {
      if (dispatchedIds.has(source.id)) return false;
      dispatchedIds.add(source.id);
      try {
        await this.dispatchSource(source);
        dispatched += 1;
        return true;
      } catch (err) {
        this.logger.error(
          { msg: 'dispatch failed', sourceId: source.id, err: String(err) },
          DispatchService.name,
        );
        return false;
      }
    };

    // 1) Fuentes vencidas por su propia cadencia.
    const dueSources = await this.prisma.source.findMany({
      where: { enabled: true, nextRunAt: { lte: now } },
    });
    for (const source of dueSources) await dispatchOnce(source);

    // 2) Perfiles con cron propio: corren los sitios que tienen seleccionados.
    const dueProfiles = await this.prisma.profile.findMany({
      where: { scheduleMinutes: { not: null }, nextRunAt: { lte: now } },
      include: {
        sources: {
          // Solo si la selección está activa Y la fuente no está deshabilitada globalmente.
          where: { enabled: true, source: { enabled: true } },
          include: { source: true },
        },
      },
    });
    for (const profile of dueProfiles) {
      for (const sel of profile.sources) {
        await dispatchOnce(sel.source);
      }
      const interval = profile.scheduleMinutes ?? 0;
      await this.prisma.profile.update({
        where: { id: profile.id },
        data: { nextRunAt: new Date(now.getTime() + interval * 60_000) },
      });
    }

    if (dueSources.length + dueProfiles.length > 0) {
      this.logger.log(
        {
          msg: 'crawl-cycle done',
          sourcesDue: dueSources.length,
          profilesDue: dueProfiles.length,
          dispatched,
        },
        DispatchService.name,
      );
    }
    return dispatched;
  }

  /** Búsqueda manual de un perfil: despacha sus sitios seleccionados y habilitados. */
  async runProfile(profileId: string): Promise<{ dispatched: number }> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: profileId },
      include: {
        sources: { where: { enabled: true, source: { enabled: true } }, include: { source: true } },
      },
    });
    if (!profile) throw new NotFoundException(`Profile ${profileId} no existe`);
    let dispatched = 0;
    for (const sel of profile.sources) {
      await this.dispatchSource(sel.source);
      dispatched += 1;
    }
    return { dispatched };
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
      // Fallback para fuentes creadas sin baseUrl: sin esto los href relativos
      // de las ofertas no se pueden absolutizar y todas caen a listUrl.
      baseUrl: source.baseUrl?.trim() || originOf(source.listUrl),
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
