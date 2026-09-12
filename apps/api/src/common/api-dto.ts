import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTOs para la documentación OpenAPI (/api/docs). La validación real sigue
 * viviendo en los servicios con Zod; estos tipos solo modelan el contrato.
 */

export class LoginDto {
  @ApiProperty({ example: 'admin@cvharness.local' })
  email: string;

  @ApiProperty({ example: 'admin1234' })
  password: string;
}

export class VacancyStatusDto {
  @ApiProperty({ enum: ['APPLIED', 'IGNORED'] })
  status: 'APPLIED' | 'IGNORED';

  @ApiPropertyOptional({ description: 'Perfil (requerido con varios perfiles por vacante)' })
  profileId?: string;
}

export class ProfileScheduleDto {
  @ApiPropertyOptional({
    description: 'Minutos entre corridas del cron del perfil. null/vacío = off.',
    example: 360,
  })
  scheduleMinutes?: number | null;
}

export class ImportProfileResumeDto {
  @ApiProperty({
    description:
      'HV en markdown o texto. La IA la parsea a datos estructurados del perfil (experiencias, proyectos, skills…).',
  })
  content: string;
}

export class ResumeTextDto {
  @ApiProperty()
  profileId: string;

  @ApiPropertyOptional()
  name?: string;

  @ApiProperty({ description: 'Contenido en texto plano o markdown' })
  content: string;
}

export class ActivateResumeDto {
  @ApiProperty()
  profileId: string;
}

export class CreateSourceDto {
  @ApiProperty({ example: 'Computrabajo React' })
  name: string;

  @ApiProperty({ enum: ['computrabajo-co', 'jobsdev-fixture'] })
  templateId: string;

  @ApiProperty({ example: 'https://www.computrabajo.com.co/trabajo-de-…' })
  listUrl: string;

  @ApiPropertyOptional({ example: 'https://www.computrabajo.com.co' })
  baseUrl?: string;

  @ApiPropertyOptional({ description: 'Perfil dueño; null = compartida' })
  profileId?: string | null;

  @ApiPropertyOptional({ example: 1440 })
  intervalMinutes?: number;

  @ApiPropertyOptional({ description: 'Editor avanzado: selectores CSS (sin templateId)' })
  selectors?: Record<string, unknown>;

  @ApiPropertyOptional()
  limits?: Record<string, unknown>;
}
