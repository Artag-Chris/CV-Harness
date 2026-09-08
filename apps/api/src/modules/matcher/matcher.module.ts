import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { queueName, QUEUES } from '../../config/queue.config';
import { ResumesModule } from '../resumes/resumes.module';
import { MatchService } from './match.service';
import { MatchWorker } from './match.worker';

@Module({
  imports: [
    ResumesModule,
    BullModule.registerQueue({ name: queueName(QUEUES.MATCH) }),
    BullModule.registerQueue({ name: queueName(QUEUES.RESUME) }),
  ],
  providers: [MatchService, MatchWorker],
})
export class MatcherModule {}
