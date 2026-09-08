import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { bullConnection } from './config/queue.config';
import { InfraModule } from './common/infra.module';
import { LlmModule } from './modules/llm/llm.module';
import { EmbeddingsModule } from './modules/embeddings/embeddings.module';
import { ResumesModule } from './modules/resumes/resumes.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';
import { NormalizerModule } from './modules/normalizer/normalizer.module';
import { MatcherModule } from './modules/matcher/matcher.module';
import { ResumeModule } from './modules/resume/resume.module';
import { NotificationModule } from './modules/notification/notification.module';
import { SourcesModule } from './modules/sources/sources.module';
import { VacanciesModule } from './modules/vacancies/vacancies.module';
import { ProfilesModule } from './modules/profiles/profiles.module';

@Module({
  imports: [
    BullModule.forRoot(bullConnection),
    InfraModule,
    LlmModule,
    EmbeddingsModule,
    ResumesModule,
    AuthModule,
    NotificationModule,
    SchedulerModule,
    IngestionModule,
    NormalizerModule,
    MatcherModule,
    ResumeModule,
    SourcesModule,
    VacanciesModule,
    ProfilesModule,
    HealthModule,
  ],
})
export class AppModule {}
