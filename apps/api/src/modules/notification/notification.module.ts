import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { queueName, QUEUES } from '../../config/queue.config';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationWorker } from './notification.worker';

@Module({
  imports: [
    BullModule.registerQueue({ name: queueName(QUEUES.NOTIFICATION) }),
  ],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationWorker],
  exports: [NotificationService],
})
export class NotificationModule {}
