import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { VacancyStatus } from '@prisma/client';
import { VacancyStatusDto } from '../../common/api-dto';
import { parseModalities, parseSeniorities } from '../../common/job-facets';
import { VacanciesService } from './vacancies.service';

const VALID_STATUS = new Set(['APPLIED', 'IGNORED']);

@Controller('vacancies')
export class VacanciesController {
  constructor(private readonly vacancies: VacanciesService) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('sourceId') sourceId?: string,
    @Query('profileId') profileId?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('minScore') minScore?: string,
    @Query('modality') modality?: string,
    @Query('seniority') seniority?: string,
    @Query('location') location?: string,
  ) {
    const parsedMin = minScore != null && minScore !== '' ? Number(minScore) : undefined;
    return this.vacancies.list({
      status: (status as VacancyStatus) || 'ALL',
      sourceId,
      profileId,
      q,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      minScore: parsedMin != null && Number.isFinite(parsedMin) ? parsedMin : undefined,
      modality: parseModalities(modality),
      seniority: parseSeniorities(seniority),
      location: location?.trim() || undefined,
    });
  }

  @Get(':id')
  get(@Param('id') id: string, @Query('profileId') profileId?: string) {
    return this.vacancies.get(id, profileId);
  }

  @Post(':id/status')
  async setStatus(@Param('id') id: string, @Body() body: VacancyStatusDto) {
    if (!VALID_STATUS.has(body.status)) {
      throw new BadRequestException('status debe ser APPLIED o IGNORED');
    }
    const updated = await this.vacancies.setStatus(id, body.status, body.profileId);
    return { ok: true, vacancy: updated };
  }

  /**
   * Fuerza la generación de HV (y su carta) aunque el match no llegue al umbral.
   * Es una acción explícita del usuario, no automática.
   */
  @Post(':id/generate-resume')
  generateResume(@Param('id') id: string, @Query('profileId') profileId?: string) {
    return this.vacancies.enqueueResume(id, profileId);
  }
}
