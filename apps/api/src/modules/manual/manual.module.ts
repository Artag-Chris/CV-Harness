import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { queueName, QUEUES } from '../../config/queue.config';
import { ManualController } from './manual.controller';
import { ManualIntakeService } from './manual.service';

/** Intake de ofertas pegadas a mano (entra al mismo pipeline que el scraping). */
@Module({
  imports: [
    BullModule.registerQueue({ name: queueName(QUEUES.NORMALIZE) }),
    BullModule.registerQueue({ name: queueName(QUEUES.MATCH) }),
  ],
  controllers: [ManualController],
  providers: [ManualIntakeService],
})
export class ManualModule {}
