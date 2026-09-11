import { BadRequestException, Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { CoverLetterService } from './cover-letter.service';

/**
 * Carta de presentación del borrador de HV (por vacante + perfil).
 * Se guarda dentro del `content` del borrador, así que no hay migración.
 */
@Controller('resumes')
export class CoverLetterController {
  constructor(private readonly coverLetters: CoverLetterService) {}

  /** Genera la carta completa con IA (o determinística si no hay proveedor). */
  @Post(':id/cover-letter')
  generate(@Param('id') id: string) {
    return this.coverLetters.generate(id);
  }

  /** Guarda la carta que el usuario editó en el dashboard. */
  @Patch(':id/cover-letter')
  save(@Param('id') id: string, @Body() body: { coverLetter?: string }) {
    if (typeof body.coverLetter !== 'string') {
      throw new BadRequestException('coverLetter es requerido');
    }
    return this.coverLetters.saveEdited(id, body.coverLetter);
  }
}
