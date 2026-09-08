import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { env } from '../../config/env';
import { queueName, QUEUES } from '../../config/queue.config';
import { JsonLogger } from '../../common/json-logger.service';

/**
 * Registra el cron real del sistema: un job repeatable de BullMQ
 * ("crawl-cycle") cada CRON_INTERVAL_MINUTES minutos. El worker CrawlWorker
 * despacha las fuentes vencidas al scraper Rust.
 */
@Injectable()
export class CrawlScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(queueName(QUEUES.CRAWL))
    private readonly queue: Queue,
    private readonly logger: JsonLogger,
  ) {}

  async onModuleInit(): Promise<void> {
    const everyMs = env.CRON_INTERVAL_MINUTES * 60_000;
    await this.queue.upsertJobScheduler(
      'crawl-cycle',
      { every: everyMs },
      { data: { type: 'cycle' } },
    );
    this.logger.log(
      { msg: 'crawl-cycle registrado', everyMs },
      CrawlScheduler.name,
    );
  }
}
