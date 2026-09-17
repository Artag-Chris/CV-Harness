import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { queueName, QUEUES } from '../../config/queue.config';
import { DedupController } from './dedup.controller';
import { DedupScheduler } from './dedup-scheduler.service';
import { DedupService } from './dedup.service';
import { DedupWorker } from './dedup.worker';

@Module({
  imports: [BullModule.registerQueue({ name: queueName(QUEUES.DEDUP) })],
  controllers: [DedupController],
  providers: [DedupService, DedupWorker, DedupScheduler],
  exports: [DedupService],
})
export class DedupModule {}
