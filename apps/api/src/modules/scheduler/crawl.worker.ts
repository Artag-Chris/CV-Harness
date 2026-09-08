import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { queueName, QUEUES } from '../../config/queue.config';
import { CrawlJobData, DispatchService } from './dispatch.service';

/**
 * Worker del cron y de los disparos manuales: despacha fuentes al scraper.
 */
@Processor(queueName(QUEUES.CRAWL), { concurrency: 1 })
export class CrawlWorker extends WorkerHost {
  constructor(private readonly dispatch: DispatchService) {
    super();
  }

  async process(job: Job<CrawlJobData>): Promise<void> {
    if (job.data.type === 'source') {
      await this.dispatch.runSource(job.data.sourceId);
    } else {
      await this.dispatch.runCycle();
    }
  }
}
