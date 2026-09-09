import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { queueName, QUEUES } from '../../config/queue.config';
import { VacancyJobSchema } from '../pipeline/pipeline.types';
import { MatchService } from './match.service';

@Processor(queueName(QUEUES.MATCH), { concurrency: 4 })
export class MatchWorker extends WorkerHost {
  constructor(private readonly matcher: MatchService) {
    super();
  }

  async process(job: Job): Promise<void> {
    const data = VacancyJobSchema.parse(job.data);
    if (!data.profileId) return; // jobs viejos sin perfil: los re-emite el normalizer
    await this.matcher.handle(data.vacancyId, data.profileId);
  }
}
