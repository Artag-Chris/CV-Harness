import { Module } from '@nestjs/common';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { ProfilesController } from './profiles.controller';

@Module({
  imports: [SchedulerModule],
  controllers: [ProfilesController],
})
export class ProfilesModule {}
