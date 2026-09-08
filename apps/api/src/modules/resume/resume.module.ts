import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { queueName, QUEUES } from '../../config/queue.config';
import { NotificationModule } from '../notification/notification.module';
import { ResumeService } from './resume.service';
import { ResumeWorker } from './resume.worker';

@Module({
  imports: [
    NotificationModule,
    BullModule.registerQueue({ name: queueName(QUEUES.RESUME) }),
    BullModule.registerQueue({ name: queueName(QUEUES.NOTIFICATION) }),
  ],
  providers: [ResumeService, ResumeWorker],
})
export class ResumeModule {}
