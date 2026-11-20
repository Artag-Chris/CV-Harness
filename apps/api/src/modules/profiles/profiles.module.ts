import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { queueName, QUEUES } from '../../config/queue.config';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { ProfileBackfillService } from './profile-backfill.service';
import { ProfileCustomResumeService } from './profile-custom-resume.service';
import { ProfileImportService } from './profile-import.service';
import { ProfilesController } from './profiles.controller';

@Module({
  imports: [
    SchedulerModule,
    BullModule.registerQueue({ name: queueName(QUEUES.MATCH) }),
  ],
  controllers: [ProfilesController],
  providers: [
    ProfileBackfillService,
    ProfileImportService,
    ProfileCustomResumeService,
  ],
  exports: [
    ProfileBackfillService,
    ProfileImportService,
    ProfileCustomResumeService,
  ],
})
export class ProfilesModule {}
