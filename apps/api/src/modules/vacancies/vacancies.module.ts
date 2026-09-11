import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { queueName, QUEUES } from '../../config/queue.config';
import { ResumeController } from './resumes.controller';
import { VacanciesController } from './vacancies.controller';
import { VacanciesService } from './vacancies.service';

@Module({
  imports: [
    // Permite forzar la generación de HV (por debajo del umbral de match).
    BullModule.registerQueue({ name: queueName(QUEUES.RESUME) }),
  ],
  controllers: [VacanciesController, ResumeController],
  providers: [VacanciesService],
  exports: [VacanciesService],
})
export class VacanciesModule {}
