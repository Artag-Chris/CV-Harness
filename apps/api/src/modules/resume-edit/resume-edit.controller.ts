import { BadRequestException, Body, Controller, Param, Post } from '@nestjs/common';
import { ResumeEditService } from './resume-edit.service';

/**
 * Edición asistida del borrador de HV. El guardado manual del contenido usa
 * `PATCH /resumes/:id` (en VacanciesModule); acá vive la reorganización con IA.
 */
@Controller('resumes')
export class ResumeEditController {
  constructor(private readonly edits: ResumeEditService) {}

  /** Reorganiza/reescribe el borrador con IA según una instrucción libre. */
  @Post(':id/refine')
  refine(@Param('id') id: string, @Body() body: { instruction?: string }) {
    if (typeof body.instruction !== 'string') {
      throw new BadRequestException('instruction es requerido');
    }
    return this.edits.refine(id, body.instruction);
  }
}
