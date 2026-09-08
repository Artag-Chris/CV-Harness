import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { queueName, QUEUES } from '../../config/queue.config';
import { MatchService } from './match.service';
import { MatchWorker } from './match.worker';

@Module({
  imports: [
    BullModule.registerQueue({ name: queueName(QUEUES.MATCH) }),
    BullModule.registerQueue({ name: queueName(QUEUES.RESUME) }),
  ],
  providers: [MatchService, MatchWorker],
})
export class MatcherModule {}
