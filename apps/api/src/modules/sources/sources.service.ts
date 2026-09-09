import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Source } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma.service';

const SelectorRecipeSchema = z.record(z.any());
const LimitsSchema = z
  .object({
    maxPages: z.number().int().positive().default(1),
    delayMs: z.number().int().min(0).default(500),
    timeoutMs: z.number().int().positive().default(20000),
    userAgent: z.string().default('cv-harness/0.1'),
    respectRobots: z.boolean().default(false),
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
    hint: 'URL del listado, ej. https://www.computrabajo.com.co/trabajo-de-desarrollador-y-programador',
    baseUrlDefault: 'https://www.computrabajo.com.co',
    selectors: {
      item: 'article.box_oferta, .b-ox-oferta',
      title: 'h2 a, .tOferta a',
      company: '.dataOferta .e, .dOferta .e',
      location: '.dataOferta .d, .lc',
      postedAt: '.dataOferta .f, .fc',
      description: '.dOferta .fs16, .cOferta',
      applyUrl: 'h2 a',
      nextPage: 'a[title="Siguiente"]',
      fetchDetail: true,
      detail: { description: '.box_detalle_oferta, .ficha_oferta' },
    },
    limits: {
      maxPages: 2,
      delayMs: 1500,
      timeoutMs: 20000,
      userAgent: 'cv-harness/0.1 (+tracker personal de vacantes)',
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

  async list(): Promise<Source[]> {
    return this.prisma.source.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        _count: { select: { vacancies: true } },
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
  async listByProfile(profileId: string): Promise<Source[]> {
    return this.prisma.source.findMany({
      where: { selections: { some: { profileId } } },
      orderBy: { createdAt: 'asc' },
      include: {
        _count: { select: { vacancies: true } },
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
        baseUrl: data.baseUrl ?? template?.baseUrlDefault ?? '',
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
