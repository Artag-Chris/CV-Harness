import { Body, Controller, Param, Post } from '@nestjs/common';
import { AtsService } from './ats.service';
import type { AtsContent } from './analyzer';

/**
 * Medidor de ATS. El análisis es determinístico (sin IA) y acepta el contenido
 * sin guardar, para que el score refleje lo que el usuario ve en la vista previa.
 */
@Controller('resumes')
export class AtsController {
  constructor(private readonly ats: AtsService) {}

  @Post(':id/ats')
  analyze(@Param('id') id: string, @Body() body: { content?: AtsContent }) {
    return this.ats.analyze(id, body?.content);
  }

  /** Propone integrar las keywords faltantes. No guarda: se revisa y se guarda. */
  @Post(':id/ats/keywords')
  fixKeywords(@Param('id') id: string, @Body() body: { content?: AtsContent }) {
    return this.ats.proposeKeywordFix(id, body?.content);
  }
}
