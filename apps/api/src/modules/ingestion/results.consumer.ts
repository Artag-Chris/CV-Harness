import { Inject, Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ZodError } from 'zod';
import { JsonLogger } from '../../common/json-logger.service';
import { STREAMS, STREAM_GROUPS } from '../../config/queue.config';
import { REDIS } from '../../config/tokens';
import { IngestionService } from './ingestion.service';

interface StreamEntry {
  id: string;
  payload: unknown;
}

/**
 * Consumidor de scraper:results (grupo "ingest"). Bloquea en XREADGROUP y
 * procesa cada entrada. Política de ack (at-least-once):
 *   - éxito                → XACK
 *   - payload inválido     → XACK (veneno: nunca va a procesar)
 *   - error transitorio    → NO XACK: queda pendiente y se reclama más tarde
 * Al arrancar y periódicamente reclama entradas huérfanas (XAUTOCLAIM); la
 * dedup por fingerprint hace que reprocesar sea idempotente.
 */
@Injectable()
export class ResultsConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private running = true;
  private idlePolls = 0;
  private readonly consumerName = `nest-${process.pid}`;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly ingest: IngestionService,
    private readonly logger: JsonLogger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureGroup();
    await this.claimOrphans();
    this.logger.log(
      { msg: 'consumiendo scraper:results', consumer: this.consumerName },
      ResultsConsumer.name,
    );
    void this.loop();
  }

  onModuleDestroy(): void {
    this.running = false;
  }

  private async ensureGroup(): Promise<void> {
    try {
      await this.redis.xgroup(
        'CREATE',
        STREAMS.RESULTS,
        STREAM_GROUPS.INGEST,
        '$',
        'MKSTREAM',
      );
    } catch (err) {
      if (!String(err).includes('BUSYGROUP')) throw err;
    }
  }

  private async claimOrphans(): Promise<void> {
    try {
      const result = await this.redis.xautoclaim(
        STREAMS.RESULTS,
        STREAM_GROUPS.INGEST,
        this.consumerName,
        120_000,
        '0-0',
        'COUNT',
        50,
      );
      // XAUTOCLAIM responde [nextId, entradas, idsBorrados], SIN envoltura por stream.
      const rawEntries = (result as [string, [string, string[]][], unknown[]])[1] ?? [];
      const entries = rawEntries.map(([id, fields]) => ({
        id,
        payload: this.parsePayload(fields),
      }));
      let reclaimed = 0;
      for (const entry of entries) {
        try {
          await this.ingest.processResult(entry.payload);
          await this.ack(entry.id);
          reclaimed += 1;
        } catch (err) {
          if (err instanceof ZodError) {
            // Payload que nunca va a parsear: confirmar para no bloquear el grupo.
            await this.ack(entry.id);
            reclaimed += 1;
          } else {
            this.logger.error(
              { msg: 'reclaim: error transitorio, queda pendiente', entryId: entry.id, err: String(err) },
              ResultsConsumer.name,
            );
          }
        }
      }
      if (reclaimed > 0) {
        this.logger.log(
          { msg: 'entradas huérfanas reprocesadas', count: reclaimed },
          ResultsConsumer.name,
        );
      }
    } catch (err) {
      this.logger.warn({ msg: 'claimOrphans falló', err: String(err) }, ResultsConsumer.name);
    }
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const result = await this.redis.xreadgroup(
          'GROUP',
          STREAM_GROUPS.INGEST,
          this.consumerName,
          'COUNT',
          10,
          'BLOCK',
          5000,
          'STREAMS',
          STREAMS.RESULTS,
          '>',
        );
        if (!result) {
          // Sin mensajes: cada ~20 iteraciones (~100s) reclama huérfanas.
          this.idlePolls += 1;
          if (this.idlePolls >= 20) {
            this.idlePolls = 0;
            await this.claimOrphans();
          }
          continue;
        }
        this.idlePolls = 0;
        for (const entry of this.flattenEntries(result)) {
          try {
            await this.ingest.processResult(entry.payload);
            await this.ack(entry.id);
          } catch (err) {
            if (err instanceof ZodError) {
              this.logger.warn(
                { msg: 'payload inválido descartado', entryId: entry.id, err: String(err) },
                ResultsConsumer.name,
              );
              await this.ack(entry.id);
            } else {
              this.logger.error(
                { msg: 'fallo transitorio al procesar (se reintentará por reclaim)', entryId: entry.id, err: String(err) },
                ResultsConsumer.name,
              );
            }
          }
        }
      } catch (err) {
        if (!this.running) break; // apagado
        this.logger.error(
          { msg: 'error en loop de scraper:results', err: String(err) },
          ResultsConsumer.name,
        );
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  private async ack(entryId: string): Promise<void> {
    await this.redis.xack(STREAMS.RESULTS, STREAM_GROUPS.INGEST, entryId);
  }

  /** [ [stream, [ [id, [field,value,...]], ...]], ... ] → entradas {id,payload}. */
  private flattenEntries(result: unknown): StreamEntry[] {
    const entries: StreamEntry[] = [];
    const streams = result as [string, [string, string[]][]][] | null;
    if (!streams) return entries;
    for (const [, streamEntries] of streams) {
      for (const [id, fields] of streamEntries) {
        entries.push({ id, payload: this.parsePayload(fields) });
      }
    }
    return entries;
  }

  private parsePayload(fields: string[]): unknown {
    const payloadIdx = fields.indexOf('payload');
    const payloadRaw = payloadIdx >= 0 ? fields[payloadIdx + 1] : undefined;
    if (!payloadRaw) return null;
    try {
      return JSON.parse(payloadRaw);
    } catch {
      return null;
    }
  }
}
