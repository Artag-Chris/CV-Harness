import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { queueName, QUEUES } from '../../config/queue.config';
import { VacancyJobSchema } from '../pipeline/pipeline.types';
import { InterviewService } from './interview.service';

@Processor(queueName(QUEUES.INTERVIEW), { concurrency: 2 })
export class InterviewWorker extends WorkerHost {
  constructor(private readonly interviews: InterviewService) {
    super();
  }

  async process(job: Job): Promise<void> {
    const data = VacancyJobSchema.parse(job.data);
    if (!data.profileId) return;
    await this.interviews.handle(data.vacancyId, data.profileId);
  }
}
