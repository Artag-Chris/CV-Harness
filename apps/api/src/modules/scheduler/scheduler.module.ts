import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { queueName, QUEUES } from '../../config/queue.config';
import { NotificationModule } from '../notification/notification.module';
import { CrawlScheduler } from './crawl-scheduler.service';
import { CrawlWorker } from './crawl.worker';
import { DispatchService } from './dispatch.service';

@Module({
  imports: [
    NotificationModule,
    BullModule.registerQueue({ name: queueName(QUEUES.CRAWL) }),
  ],
  providers: [CrawlScheduler, DispatchService, CrawlWorker],
  exports: [DispatchService],
})
export class SchedulerModule {}
