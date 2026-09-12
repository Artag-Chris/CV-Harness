import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProfileScheduleDto, ImportProfileResumeDto } from '../../common/api-dto';
import { normalizeApplyLanguage } from '../../common/apply-language';
import { PrismaService } from '../../common/prisma.service';
import { DispatchService } from '../scheduler/dispatch.service';
import { ProfileBackfillService } from './profile-backfill.service';
import { ProfileImportService } from './profile-import.service';

/** Campos editables de un perfil desde el dashboard. */
interface UpdateProfileBody {
  name?: string;
  headline?: string[];
  summary?: string;
  email?: string | null;
  isPrimary?: boolean;
  /** Idioma de postulación por defecto: 'auto' (idioma de la vacante) | 'es' | 'en'. */
  applyLanguage?: string;
}

@Controller('profiles')
export class ProfilesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatch: DispatchService,
    private readonly backfill: ProfileBackfillService,
    private readonly profileImport: ProfileImportService,
  ) {}

  @Post()
  async create(@Body() body: { name?: string; headline?: string[]; summary?: string; email?: string }) {
    if (!body.name?.trim()) throw new BadRequestException('name es requerido');
    const name = body.name.trim();
    // El primer perfil nace primario: sin primario, las fuentes que nadie
    // tilda no tendrían a quién asignarse en el fan-out del match.
    const isFirst = (await this.prisma.profile.count()) === 0;
    return this.prisma.profile.create({
      data: {
        name,
        headline: body.headline ?? [name],
        summary: body.summary ?? '',
        email: body.email ?? null,
        isPrimary: isFirst,
      },
    });
  }

  /** Edita los datos del perfil (y opcionalmente lo marca como primario). */
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: UpdateProfileBody) {
    const profile = await this.prisma.profile.findUnique({ where: { id } });
    if (!profile) throw new NotFoundException(`Profile ${id} no existe`);

    const data: Prisma.ProfileUpdateInput = {};
    if (body.name !== undefined) {
      if (!body.name.trim()) throw new BadRequestException('name no puede quedar vacío');
      data.name = body.name.trim();
    }
    if (body.headline !== undefined) data.headline = body.headline;
    if (body.summary !== undefined) data.summary = body.summary;
    if (body.email !== undefined) data.email = body.email?.trim() || null;
    if (body.applyLanguage !== undefined) {
      const applyLanguage = normalizeApplyLanguage(body.applyLanguage);
      if (!applyLanguage) {
        throw new BadRequestException('applyLanguage debe ser "auto", "es" o "en"');
      }
      data.applyLanguage = applyLanguage;
    }

    if (body.isPrimary === true) {
      // Solo un primario: se degrada el resto en la misma transacción.
      const [, updated] = await this.prisma.$transaction([
        this.prisma.profile.updateMany({
          where: { id: { not: id }, isPrimary: true },
          data: { isPrimary: false },
        }),
        this.prisma.profile.update({ where: { id }, data: { ...data, isPrimary: true } }),
      ]);
      return updated;
    }
    if (Object.keys(data).length === 0) return profile;
    return this.prisma.profile.update({ where: { id }, data });
  }

  /**
   * Borra el perfil y todo lo suyo (HV, chunks, matches, borradores y sus
   * selecciones de fuentes). Las vacantes NO se borran: son del catálogo.
   */
  @Delete(':id')
  async remove(@Param('id') id: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { id },
      include: {
        _count: { select: { resumes: true, matches: true, sources: true } },
      },
    });
    if (!profile) throw new NotFoundException(`Profile ${id} no existe`);

    const total = await this.prisma.profile.count();
    if (total <= 1) {
      throw new BadRequestException(
        'Es el único perfil: creá otro antes de borrarlo (el sistema necesita al menos uno)',
      );
    }

    // Si era el primario, se promueve otro para no dejar el sistema sin primario.
    if (profile.isPrimary) {
      const heir = await this.prisma.profile.findFirst({
        where: { id: { not: id } },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (heir) {
        await this.prisma.profile.update({
          where: { id: heir.id },
          data: { isPrimary: true },
        });
      }
    }

    await this.prisma.profile.delete({ where: { id } });
    return {
      ok: true,
      deleted: {
        resumes: profile._count.resumes,
        matches: profile._count.matches,
        sources: profile._count.sources,
      },
    };
  }

  /** Re-evalúa las vacantes ya guardadas contra este perfil (backfill). */
  @Post(':id/backfill')
  async runBackfill(@Param('id') id: string) {
    const profile = await this.prisma.profile.findUnique({ where: { id } });
    if (!profile) throw new NotFoundException(`Profile ${id} no existe`);
    const result = await this.backfill.enqueueForProfile(id);
    return { ok: true, ...result };
  }

  /**
   * Importa una HV (markdown/texto) al perfil ESTRUCTURADO con IA. Hace falta
   * porque `POST /resumes/text` solo indexa el texto para el match semántico:
   * la HV que redacta la IA se arma del perfil (experiencias, proyectos, skills).
   */
  @Post(':id/import-resume')
  async importResume(@Param('id') id: string, @Body() body: ImportProfileResumeDto) {
    if (!body.content?.trim()) {
      throw new BadRequestException('content es requerido');
    }
    return this.profileImport.importFromMarkdown(id, body.content);
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
    // Las vacantes ya guardadas de esos sitios se evalúan enseguida.
    await this.backfill.enqueueForProfile(id);
    return this.get(id);
  }

  /** Habilita/deshabilita un sitio para el perfil (sin borrarlo de los guardados). */
  @Patch(':profileId/sources/:sourceId')
  async toggleSource(
    @Param('profileId') profileId: string,
    @Param('sourceId') sourceId: string,
    @Body() body: { enabled?: boolean },
  ) {
    const selection = await this.prisma.profileSource.upsert({
      where: { profileId_sourceId: { profileId, sourceId } },
      update: { enabled: body.enabled ?? true },
      create: { profileId, sourceId, enabled: body.enabled ?? true },
    });
    // Al tildar un sitio, las vacantes viejas de ese sitio se evalúan ya.
    if (selection.enabled) await this.backfill.enqueueForProfile(profileId);
    return selection;
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
  async get(@Param('id') id: string) {
    const profile = await this.prisma.profile.findUnique({
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
    if (!profile) throw new NotFoundException(`Profile ${id} no existe`);
    return profile;
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
