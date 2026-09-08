import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { queueName, QUEUES } from '../../config/queue.config';
import { NormalizeService } from './normalize.service';
import { NormalizeWorker } from './normalize.worker';

@Module({
  imports: [
    BullModule.registerQueue({ name: queueName(QUEUES.NORMALIZE) }),
    BullModule.registerQueue({ name: queueName(QUEUES.MATCH) }),
  ],
  providers: [NormalizeService, NormalizeWorker],
})
export class NormalizerModule {}
