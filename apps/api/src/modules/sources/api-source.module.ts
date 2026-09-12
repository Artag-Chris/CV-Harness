import { Module } from '@nestjs/common';
import { ApiSourceService } from './api-source.service';

/**
 * Consulta de fuentes por API oficial. Vive en su propio módulo (y no en
 * SourcesModule) porque lo consume el SchedulerModule: así no se crea un ciclo
 * entre "fuentes" y "scheduler".
 */
@Module({
  providers: [ApiSourceService],
  exports: [ApiSourceService],
})
export class ApiSourceModule {}
