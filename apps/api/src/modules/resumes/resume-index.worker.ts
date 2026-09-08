import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { z } from 'zod';
import { queueName, QUEUES } from '../../config/queue.config';
import { ResumesService } from './resumes.service';

const ResumeIndexJobSchema = z.object({ resumeId: z.string().min(1) });

/**
 * Indexa una hoja de vida en pgvector (chunks + embeddings) de forma asíncrona
 * para que la subida desde el dashboard no bloquee el request.
 */
@Processor(queueName(QUEUES.RESUME_INDEX), { concurrency: 2 })
export class ResumeIndexWorker extends WorkerHost {
  constructor(private readonly resumes: ResumesService) {
    super();
  }

  async process(job: Job): Promise<void> {
    const data = ResumeIndexJobSchema.parse(job.data);
    await this.resumes.index(data.resumeId);
  }
}
