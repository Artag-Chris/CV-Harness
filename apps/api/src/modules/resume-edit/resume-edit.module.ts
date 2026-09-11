import { Module } from '@nestjs/common';
import { ResumeEditController } from './resume-edit.controller';
import { ResumeEditService } from './resume-edit.service';

/** Reorganización del borrador de HV con IA (LlmModule es @Global). */
@Module({
  controllers: [ResumeEditController],
  providers: [ResumeEditService],
  exports: [ResumeEditService],
})
export class ResumeEditModule {}
