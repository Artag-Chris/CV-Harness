import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { queueName, QUEUES } from '../../config/queue.config';
import { VacancyJobSchema } from '../pipeline/pipeline.types';
import { ResumeService } from './resume.service';

@Processor(queueName(QUEUES.RESUME), { concurrency: 2 })
export class ResumeWorker extends WorkerHost {
  constructor(private readonly resumes: ResumeService) {
    super();
  }

  async process(job: Job): Promise<void> {
    const data = VacancyJobSchema.parse(job.data);
    if (!data.profileId) return;
    await this.resumes.handle(data.vacancyId, data.profileId);
  }
}
