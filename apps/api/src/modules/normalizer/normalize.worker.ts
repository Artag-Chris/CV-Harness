import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { queueName, QUEUES } from '../../config/queue.config';
import { VacancyJobSchema } from '../pipeline/pipeline.types';
import { NormalizeService } from './normalize.service';

@Processor(queueName(QUEUES.NORMALIZE), { concurrency: 4 })
export class NormalizeWorker extends WorkerHost {
  constructor(private readonly normalize: NormalizeService) {
    super();
  }

  async process(job: Job): Promise<void> {
    const data = VacancyJobSchema.parse(job.data);
    await this.normalize.handle(data.vacancyId);
  }
}
