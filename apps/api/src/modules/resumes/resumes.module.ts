import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { queueName, QUEUES } from '../../config/queue.config';
import { ProfilesModule } from '../profiles/profiles.module';
import { ResumeIndexWorker } from './resume-index.worker';
import { ResumesController } from './resumes.controller';
import { ResumesService } from './resumes.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: queueName(QUEUES.RESUME_INDEX) }),
    // Necesario para re-evaluar las vacantes viejas cuando la HV queda activa.
    ProfilesModule,
  ],
  controllers: [ResumesController],
  providers: [ResumesService, ResumeIndexWorker],
  exports: [ResumesService],
})
export class ResumesModule {}
