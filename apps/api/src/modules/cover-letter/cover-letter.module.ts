import { Module } from '@nestjs/common';
import { CoverLetterController } from './cover-letter.controller';
import { CoverLetterService } from './cover-letter.service';

/**
 * Carta de presentación: usa el LLM (LlmModule es @Global) y el snapshot del
 * perfil. No importa otros módulos de dominio.
 */
@Module({
  controllers: [CoverLetterController],
  providers: [CoverLetterService],
  exports: [CoverLetterService],
})
export class CoverLetterModule {}
