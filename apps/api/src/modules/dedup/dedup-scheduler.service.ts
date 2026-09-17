import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { JsonLogger } from '../../common/json-logger.service';
import { env } from '../../config/env';
import { queueName, QUEUES } from '../../config/queue.config';

/**
 * Registra el pase de dedup cada DEDUP_INTERVAL_MINUTES y dispara uno al
 * arrancar (para backfill de filas viejas y duplicados ya guardados).
 */
@Injectable()
export class DedupScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(queueName(QUEUES.DEDUP))
    private readonly queue: Queue,
    private readonly logger: JsonLogger,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!env.DEDUP_ENABLED) {
      this.logger.log({ msg: 'dedup deshabilitado (DEDUP_ENABLED=false)' }, DedupScheduler.name);
      return;
    }
    const everyMs = env.DEDUP_INTERVAL_MINUTES * 60_000;
    await this.queue.upsertJobScheduler(
      'dedup-cycle',
      { every: everyMs },
      { data: { type: 'cycle' } },
    );
    await this.queue.add(
      'default',
      { type: 'boot' },
      { removeOnComplete: { age: 3600, count: 10 }, removeOnFail: { age: 86400 } },
    );
    this.logger.log({ msg: 'dedup-cycle registrado', everyMs }, DedupScheduler.name);
  }
}
