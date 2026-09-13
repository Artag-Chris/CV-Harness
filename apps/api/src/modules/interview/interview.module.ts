import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { queueName, QUEUES } from '../../config/queue.config';
import {
  InterviewPrepController,
  InterviewVacancyController,
} from './interview.controller';
import { InterviewService } from './interview.service';
import { InterviewWorker } from './interview.worker';

@Module({
  imports: [
    BullModule.registerQueue({ name: queueName(QUEUES.INTERVIEW) }),
    BullModule.registerQueue({ name: queueName(QUEUES.NOTIFICATION) }),
  ],
  controllers: [InterviewVacancyController, InterviewPrepController],
  providers: [InterviewService, InterviewWorker],
  exports: [InterviewService],
})
export class InterviewModule {}
