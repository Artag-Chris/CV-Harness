import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
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

  @Post()
  async create(@Body() body: { name?: string; headline?: string[]; summary?: string; email?: string }) {
    if (!body.name?.trim()) throw new BadRequestException('name es requerido');
    return this.prisma.profile.create({
      data: {
        name: body.name.trim(),
        headline: body.headline ?? [body.name.trim()],
        summary: body.summary ?? '',
        email: body.email ?? null,
      },
    });
  }

  /** Reemplaza los sitios guardados que vigila el perfil. */
  @Put(':id/sources')
  async setSources(
    @Param('id') id: string,
    @Body() body: { sourceIds: string[] },
  ) {
    const profile = await this.prisma.profile.findUnique({ where: { id } });
    if (!profile) throw new BadRequestException('perfil no existe');
    const ids = [...new Set((body.sourceIds ?? []).filter(Boolean))];
    const existing = await this.prisma.source.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    if (existing.length !== ids.length) {
      throw new BadRequestException('Algunos sourceIds no existen');
    }
    await this.prisma.$transaction([
      this.prisma.profileSource.deleteMany({ where: { profileId: id } }),
      this.prisma.profileSource.createMany({
        data: ids.map((sourceId) => ({ profileId: id, sourceId })),
      }),
    ]);
    return this.get(id);
  }

  /** Habilita/deshabilita un sitio para el perfil (sin borrarlo de los guardados). */
  @Patch(':profileId/sources/:sourceId')
  async toggleSource(
    @Param('profileId') profileId: string,
    @Param('sourceId') sourceId: string,
    @Body() body: { enabled?: boolean },
  ) {
    return this.prisma.profileSource.upsert({
      where: { profileId_sourceId: { profileId, sourceId } },
      update: { enabled: body.enabled ?? true },
      create: { profileId, sourceId, enabled: body.enabled ?? true },
    });
  }

  /** Quita el sitio de la selección del perfil. */
  @Delete(':profileId/sources/:sourceId')
  async removeSource(@Param('profileId') profileId: string, @Param('sourceId') sourceId: string) {
    await this.prisma.profileSource.deleteMany({ where: { profileId, sourceId } });
    return { ok: true };
  }

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
          include: {
            source: {
              select: {
                id: true,
                name: true,
                kind: true,
                listUrl: true,
                enabled: true,
                intervalMinutes: true,
              },
            },
          },
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
