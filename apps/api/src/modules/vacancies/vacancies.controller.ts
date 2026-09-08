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
import { VacanciesService } from './vacancies.service';

const VALID_STATUS = new Set(['APPLIED', 'IGNORED']);

@Controller('vacancies')
export class VacanciesController {
  constructor(private readonly vacancies: VacanciesService) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('sourceId') sourceId?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.vacancies.list({
      status: (status as VacancyStatus) || 'ALL',
      sourceId,
      q,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.vacancies.get(id);
  }

  @Post(':id/status')
  async setStatus(@Param('id') id: string, @Body() body: { status?: string }) {
    if (!body.status || !VALID_STATUS.has(body.status)) {
      throw new BadRequestException('status debe ser APPLIED o IGNORED');
    }
    const updated = await this.vacancies.setStatus(
      id,
      body.status as 'APPLIED' | 'IGNORED',
    );
    return { ok: true, vacancy: updated };
  }
}
