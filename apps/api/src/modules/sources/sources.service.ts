import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Source } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma.service';
import { originOf } from '../../common/url.util';

/**
 * Receta CSS de una fuente. `item` y `title` son el mínimo para extraer algo;
 * el resto es opcional. El editor avanzado del dashboard arma este objeto.
 */
const SelectorRecipeSchema = z
  .record(z.any())
  .refine((s) => typeof s?.item === 'string' && s.item.trim().length > 0, {
    message: 'selectors.item es obligatorio (selector CSS de cada vacante)',
  })
  .refine((s) => typeof s?.title === 'string' && s.title.trim().length > 0, {
    message: 'selectors.title es obligatorio (selector CSS del título)',
  });

/** Campos de la última corrida que la UI muestra para diagnosticar fallos. */
const LAST_RUN_SELECT = {
  status: true,
  error: true,
  itemsFound: true,
  itemsNew: true,
  startedAt: true,
} as const;

const LimitsSchema = z
  .object({
    maxPages: z.number().int().positive().default(1),
    delayMs: z.number().int().min(0).default(500),
    timeoutMs: z.number().int().positive().default(20000),
    userAgent: z.string().default('cv-harness/0.1'),
    respectRobots: z.boolean().default(false),
    // Paginación por parámetro (?page=2) para portales que la dibujan con JS.
    pageParam: z.string().trim().min(1).optional(),
  })
  .default({});

/**
 * Plantillas de portales para crear fuentes pegando solo la URL del listado.
 * El editor avanzado de selectores CSS queda disponible por API.
 */
export interface SourceTemplate {
  id: string;
  label: string;
  hint: string;
  baseUrlDefault: string;
  selectors: Record<string, unknown>;
  limits: Record<string, unknown>;
}

export const SOURCE_TEMPLATES: SourceTemplate[] = [
  {
    id: 'computrabajo-co',
    label: 'Computrabajo Colombia',
    hint: 'URL del listado, ej. https://co.computrabajo.com/trabajo-de-desarrollador-y-programador',
    // www.computrabajo.com.co redirige (301) a co.computrabajo.com.
    baseUrlDefault: 'https://co.computrabajo.com',
    // Selectores verificados contra el HTML real (2026-09):
    //   <article class="box_offer …"> / <h2><a class="js-o-link">Título</a></h2>
    //   empresa: <a class="t_ellipsis"> · ubicación: <p class="fs16 fc_base mt5"><span class="mr10">
    //   salario: <div class="fs13 mt15"><span class="dIB mr10"> · publicada: <p class="fs13 fc_aux">
    //   paginación: <span title="Siguiente" data-path="…?p=2"> (NO es <a href>)
    selectors: {
      item: 'article.box_offer',
      title: 'h2 a.js-o-link',
      company: 'a.t_ellipsis',
      // :not(.dFlex) descarta el párrafo de la empresa, que en ofertas con
      // calificación trae <span class="fx_none mr10">4,7</span>.
      location: 'p.fs16.fc_base.mt5:not(.dFlex) span.mr10',
      salary: 'div.fs13 span.dIB.mr10',
      postedAt: 'p.fs13.fc_aux',
      applyUrl: 'h2 a.js-o-link',
      nextPage: '[title="Siguiente"]',
      // El listado no trae la descripción: se baja la página de detalle.
      fetchDetail: true,
      detail: { description: 'div[div-link="oferta"]' },
    },
    limits: {
      maxPages: 2,
      delayMs: 1000,
      timeoutMs: 20000,
      // Computrabajo (Cloudflare) responde 403 a UAs no-navegador
      // (`curl`, `cv-harness/0.1`): verificado 2026-09.
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      respectRobots: true,
    },
  },
  {
    id: 'jobsdev-fixture',
    label: 'JobsDev Fixture (E2E local)',
    hint: 'http://cvharness-fixture/jobs.html dentro de docker, o localhost:8090/jobs.html nativo',
    baseUrlDefault: 'http://cvharness-fixture',
    selectors: {
      item: '.job-item',
      title: '.job-title a',
      company: '.job-company',
      location: '.job-location',
      postedAt: '.job-date',
      description: '.job-description',
      applyUrl: '.job-title a',
    },
    limits: { maxPages: 1, delayMs: 300, timeoutMs: 15000, respectRobots: false },
  },
];

export const UpsertSourceSchema = z.object({
  name: z.string().min(1),
  kind: z.string().default('HTML_RECIPE'),
  // Plantilla + URL (dashboard) o selectores manuales (API avanzada).
  templateId: z.string().optional(),
  baseUrl: z.string().url().optional(),
  listUrl: z.string().url(),
  selectors: SelectorRecipeSchema.optional(),
  limits: LimitsSchema.optional(),
  enabled: z.boolean().default(true),
  intervalMinutes: z.number().int().positive().default(1440),
});

export type UpsertSourceInput = z.infer<typeof UpsertSourceSchema>;

function resolveTemplate(templateId: string | undefined) {
  if (!templateId) return null;
  return SOURCE_TEMPLATES.find((t) => t.id === templateId) ?? null;
}

@Injectable()
export class SourcesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    return this.prisma.source.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        _count: { select: { vacancies: true } },
        // Última corrida: hace visible en la UI si el scrape falló (403, timeout…).
        runs: { take: 1, orderBy: { startedAt: 'desc' }, select: LAST_RUN_SELECT },
        selections: {
          select: {
            id: true,
            enabled: true,
            intervalMinutes: true,
            profile: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  templates(): SourceTemplate[] {
    return SOURCE_TEMPLATES;
  }

  /** Sitios que vigila un perfil (selección N:M). */
  async listByProfile(profileId: string) {
    return this.prisma.source.findMany({
      where: { selections: { some: { profileId } } },
      orderBy: { createdAt: 'asc' },
      include: {
        _count: { select: { vacancies: true } },
        runs: { take: 1, orderBy: { startedAt: 'desc' }, select: LAST_RUN_SELECT },
        selections: {
          where: { profileId },
          select: {
            id: true,
            enabled: true,
            intervalMinutes: true,
            profile: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  async get(id: string): Promise<Source | null> {
    const source = await this.prisma.source.findUnique({ where: { id } });
    if (!source) throw new NotFoundException(`Source ${id} no existe`);
    return source;
  }

  async create(input: unknown): Promise<Source> {
    const data = UpsertSourceSchema.parse(input);
    const template = resolveTemplate(data.templateId);
    if (!data.selectors && !template) {
      throw new BadRequestException(
        'Se necesita "templateId" (plantilla) o "selectors" (editor avanzado)',
      );
    }
    const selectors = data.selectors ?? template?.selectors ?? {};
    const limits = data.limits ?? template?.limits ?? {};
    return this.prisma.source.create({
      data: {
        name: data.name,
        kind: data.kind,
        // Con receta propia no hay baseUrl: se deriva del origen del listado,
        // para poder absolutizar los href relativos de cada oferta.
        baseUrl: data.baseUrl ?? template?.baseUrlDefault ?? originOf(data.listUrl),
        listUrl: data.listUrl,
        selectors: selectors as Prisma.InputJsonValue,
        limits: limits as Prisma.InputJsonValue,
        enabled: data.enabled,
        intervalMinutes: data.intervalMinutes,
      },
    });
  }

  async update(id: string, input: unknown): Promise<Source> {
    const source = await this.prisma.source.findUnique({ where: { id } });
    if (!source) throw new NotFoundException(`Source ${id} no existe`);
    const data = UpsertSourceSchema.partial().parse(input);
    return this.prisma.source.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.kind !== undefined && { kind: data.kind }),
        ...(data.baseUrl !== undefined && { baseUrl: data.baseUrl }),
        ...(data.listUrl !== undefined && { listUrl: data.listUrl }),
        ...(data.selectors !== undefined && {
          selectors: data.selectors as Prisma.InputJsonValue,
        }),
        ...(data.limits !== undefined && {
          limits: data.limits as Prisma.InputJsonValue,
        }),
        ...(data.enabled !== undefined && { enabled: data.enabled }),
        ...(data.intervalMinutes !== undefined && {
          intervalMinutes: data.intervalMinutes,
        }),
      },
    });
  }

  async remove(id: string): Promise<void> {
    const source = await this.prisma.source.findUnique({
      where: { id },
      include: { _count: { select: { vacancies: true } } },
    });
    if (!source) throw new NotFoundException(`Source ${id} no existe`);
    if (source._count.vacancies > 0) {
      throw new ConflictException(
        `La fuente tiene ${source._count.vacancies} vacantes: deshabilítala en vez de borrarla`,
      );
    }
    await this.prisma.source.delete({ where: { id } });
  }
}
