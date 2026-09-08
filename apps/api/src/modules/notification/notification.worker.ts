import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { queueName, QUEUES } from '../../config/queue.config';
import { NotificationJobSchema } from '../pipeline/pipeline.types';
import { NotificationService } from './notification.service';

/**
 * Persiste notificaciones en la bandeja web. En fase 2 el mismo NotificationPort
 * alimentará adapters de email/telegram sin tocar los emisores del pipeline.
 */
@Processor(queueName(QUEUES.NOTIFICATION), { concurrency: 4 })
export class NotificationWorker extends WorkerHost {
  constructor(private readonly notifications: NotificationService) {
    super();
  }

  async process(job: Job): Promise<void> {
    const data = NotificationJobSchema.parse(job.data);
    await this.notifications.create(data);
  }
}
