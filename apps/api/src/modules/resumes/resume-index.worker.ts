import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { z } from 'zod';
import { JsonLogger } from '../../common/json-logger.service';
import { queueName, QUEUES } from '../../config/queue.config';
import { ProfileBackfillService } from '../profiles/profile-backfill.service';
import { ResumesService } from './resumes.service';

const ResumeIndexJobSchema = z.object({ resumeId: z.string().min(1) });

/**
 * Indexa una hoja de vida en pgvector (chunks + embeddings) de forma asíncrona
 * para que la subida desde el dashboard no bloquee el request.
 *
 * Al terminar, si la HV quedó ACTIVA, re-evalúa las vacantes viejas del perfil:
 * el match semántico necesita los embeddings listos, así que este es el único
 * punto correcto para dispararlo.
 */
@Processor(queueName(QUEUES.RESUME_INDEX), { concurrency: 2 })
export class ResumeIndexWorker extends WorkerHost {
  constructor(
    private readonly resumes: ResumesService,
    private readonly backfill: ProfileBackfillService,
    private readonly logger: JsonLogger,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    const data = ResumeIndexJobSchema.parse(job.data);
    // Se lee antes de indexar: `index()` puede fallar y queremos el perfil igual.
    const resume = await this.resumes.get(data.resumeId);
    await this.resumes.index(data.resumeId);

    if (!resume.active) return;
    const result = await this.backfill.enqueueForProfile(resume.profileId);
    this.logger.log(
      { msg: 'backfill tras indexar HV activa', resumeId: data.resumeId, ...result },
      ResumeIndexWorker.name,
    );
  }
}
