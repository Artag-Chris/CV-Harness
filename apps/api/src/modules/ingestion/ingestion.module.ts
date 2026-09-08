import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { queueName, QUEUES } from '../../config/queue.config';
import { NotificationModule } from '../notification/notification.module';
import { IngestionService } from './ingestion.service';
import { ResultsConsumer } from './results.consumer';

@Module({
  imports: [
    NotificationModule,
    BullModule.registerQueue({ name: queueName(QUEUES.NORMALIZE) }),
  ],
  providers: [IngestionService, ResultsConsumer],
  exports: [IngestionService],
})
export class IngestionModule {}
