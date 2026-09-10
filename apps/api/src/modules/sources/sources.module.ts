import { Module } from '@nestjs/common';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { RecipeProbeService } from './probe/recipe-probe.service';
import { SourcesController } from './sources.controller';
import { SourcesService } from './sources.service';

@Module({
  imports: [SchedulerModule],
  controllers: [SourcesController],
  providers: [SourcesService, RecipeProbeService],
  exports: [SourcesService],
})
export class SourcesModule {}
