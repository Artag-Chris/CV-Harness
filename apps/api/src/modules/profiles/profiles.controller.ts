import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ProfileScheduleDto } from '../../common/api-dto';
import { PrismaService } from '../../common/prisma.service';
import { DispatchService } from '../scheduler/dispatch.service';

@Controller('profiles')
export class ProfilesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatch: DispatchService,
  ) {}

  @Get()
  list() {
    return this.prisma.profile.findMany({
      select: {
        id: true,
        name: true,
        headline: true,
        email: true,
        isPrimary: true,
        scheduleMinutes: true,
        nextRunAt: true,
        _count: { select: { skills: true, projects: true, experiences: true, sources: true, resumes: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  @Get('primary')
  primary() {
    return this.prisma.profile.findFirst({
      where: { isPrimary: true },
      include: {
        links: true,
        experiences: { orderBy: { sortOrder: 'asc' } },
        education: { orderBy: { sortOrder: 'asc' } },
        projects: true,
        skills: { include: { skill: true }, orderBy: { rating: 'desc' } },
      },
    });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.prisma.profile.findUnique({
      where: { id },
      include: {
        links: true,
        experiences: { orderBy: { sortOrder: 'asc' } },
        education: { orderBy: { sortOrder: 'asc' } },
        projects: true,
        skills: { include: { skill: true }, orderBy: { rating: 'desc' } },
        sources: {
          select: { id: true, name: true, enabled: true, listUrl: true, intervalMinutes: true },
        },
      },
    });
  }

  /** Cadencia del cron del perfil: cada cuántos minutos corre SUS fuentes. */
  @Patch(':id/schedule')
  async schedule(@Param('id') id: string, @Body() body: ProfileScheduleDto) {
    const minutes = body.scheduleMinutes == null ? null : Math.max(5, Math.round(body.scheduleMinutes));
    const profile = await this.prisma.profile.findUnique({ where: { id } });
    if (!profile) return { error: 'perfil no existe' };
    return this.prisma.profile.update({
      where: { id },
      data: {
        scheduleMinutes: minutes,
        // Si se activa, la próxima corrida del crawl-cycle lo toma enseguida.
        nextRunAt: minutes ? new Date() : null,
      },
    });
  }

  /** Buscar ahora: despacha todas las fuentes habilitadas del perfil. */
  @Post(':id/run')
  async run(@Param('id') id: string) {
    const result = await this.dispatch.runProfile(id);
    return { ok: true, ...result };
  }
}
