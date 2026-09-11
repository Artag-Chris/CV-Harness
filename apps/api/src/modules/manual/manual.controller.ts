import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { ManualIntakeService } from './manual.service';

interface CreateFromTextDto {
  text?: unknown;
  profileId?: unknown;
  title?: unknown;
  company?: unknown;
  url?: unknown;
}

/** Opcional y de texto libre: si viene vacío o no es string se toma como null. */
function optionalString(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new BadRequestException(`${field} debe ser texto`);
  return value.trim() || null;
}

/**
 * Ofertas pegadas a mano. Vive en el mismo prefijo que `VacanciesController`
 * para que el recurso sea uno solo (`/vacancies`).
 */
@Controller('vacancies')
export class ManualController {
  constructor(private readonly manual: ManualIntakeService) {}

  /** Crea (o reusa) una vacante a partir del texto pegado y arranca el pipeline. */
  @Post('from-text')
  createFromText(@Body() body: CreateFromTextDto) {
    if (typeof body.text !== 'string' || body.text.trim().length === 0) {
      throw new BadRequestException('text es requerido');
    }
    return this.manual.createFromText({
      text: body.text,
      profileId: optionalString(body.profileId, 'profileId'),
      title: optionalString(body.title, 'title'),
      company: optionalString(body.company, 'company'),
      url: optionalString(body.url, 'url'),
    });
  }
}
