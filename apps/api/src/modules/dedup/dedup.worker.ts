import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { queueName, QUEUES } from '../../config/queue.config';
import { DedupService } from './dedup.service';

@Processor(queueName(QUEUES.DEDUP), { concurrency: 1 })
export class DedupWorker extends WorkerHost {
  constructor(private readonly dedup: DedupService) {
    super();
  }

  async process(_job: Job): Promise<void> {
    await this.dedup.run();
  }
}
