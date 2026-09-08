import { Module } from '@nestjs/common';
import { ResumeController } from './resumes.controller';
import { VacanciesController } from './vacancies.controller';
import { VacanciesService } from './vacancies.service';

@Module({
  controllers: [VacanciesController, ResumeController],
  providers: [VacanciesService],
  exports: [VacanciesService],
})
export class VacanciesModule {}
