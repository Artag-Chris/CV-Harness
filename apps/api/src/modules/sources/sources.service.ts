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
import { API_SOURCE_KIND, parseApiSpec } from './api-source';
import { SOURCE_TEMPLATES, type SourceTemplate } from './sources.templates';

/** Re-export para quien importaba las plantillas desde este módulo. */
export { SOURCE_TEMPLATES, type SourceTemplate };

/**
 * Receta de una fuente. En el camino HTML es la receta CSS (`item` + `title`
 * obligatorios); en el camino API es `{ api: { … } }`. La validación de forma
 * depende del `kind`, así que se hace por separado y no en el schema Zod.
 */
const SelectorRecipeSchema = z.record(z.any());

/** El camino HTML exige selectores de tarjeta y título. */
function assertHtmlSelectors(selectors: Record<string, unknown>): void {
  if (typeof selectors.item !== 'string' || !selectors.item.trim()) {
    throw new BadRequestException(
      'selectors.item es obligatorio (selector CSS de cada vacante)',
    );
  }
  if (typeof selectors.title !== 'string' || !selectors.title.trim()) {
    throw new BadRequestException('selectors.title es obligatorio (selector CSS del título)');
  }
}

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
    // Cabeceras extra por fuente (ej. Referer): se suman a las de navegador.
    headers: z.record(z.string()).optional(),
    // Reintentos de las fuentes API_JSON (los WAF alternan bloqueos).
    retryAttempts: z.number().int().min(1).max(5).optional(),
    retryDelayMs: z.number().int().min(0).optional(),
  })
  .default({});

/**
 * Las plantillas viven en sources.templates.ts (sin dependencias de Prisma) y
 * se re-exportan arriba para no romper a quien las importaba desde acá.
 */

export const UpsertSourceSchema = z.object({
  name: z.string().min(1),
  // El `kind` puede venir del body o de la plantilla; si no, es HTML con receta.
  kind: z.string().optional(),
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

/** Valida la receta según el camino: API oficial o receta CSS. */
function assertSourceRecipe(kind: string, selectors: Record<string, unknown>): void {
  if (kind === API_SOURCE_KIND) {
    const parsed = parseApiSpec(selectors);
    if (!parsed.ok) throw new BadRequestException(parsed.error);
    return;
  }
  assertHtmlSelectors(selectors);
}

/**
 * Valida con Zod traduciendo el fallo a un 400 legible. Sin esto, un error de
 * validación sale como ZodError y Nest responde 500 "Internal server error".
 */
function parseOrBadRequest<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const detail = result.error.issues
    .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
    .join('; ');
  throw new BadRequestException(`Datos inválidos — ${detail}`);
}

@Injectable()
export class SourcesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    return this.prisma.source.findMany({
      // La fuente sintética de las ofertas pegadas a mano no es un sitio: no se
      // muestra ni se edita desde Fuentes (solo existe porque sourceId es NOT NULL).
      where: { kind: { not: 'MANUAL' } },
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
    const data = parseOrBadRequest(UpsertSourceSchema, input);
    const template = resolveTemplate(data.templateId);
    if (!data.selectors && !template) {
      throw new BadRequestException(
        'Se necesita "templateId" (plantilla) o "selectors" (editor avanzado)',
      );
    }
    const kind = data.kind ?? template?.kind ?? 'HTML_RECIPE';
    const selectors = (data.selectors ?? template?.selectors ?? {}) as Record<string, unknown>;
    const limits = data.limits ?? template?.limits ?? {};
    assertSourceRecipe(kind, selectors);
    return this.prisma.source.create({
      data: {
        name: data.name,
        kind,
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
    const data = parseOrBadRequest(UpsertSourceSchema.partial(), input);
    // Cambiar el kind o la receta debe dejar la fuente en un estado usable: si
    // se pasa a API sin spec (o al revés), se rechaza acá y no en la corrida.
    if (data.kind !== undefined || data.selectors !== undefined) {
      const selectors = (data.selectors ?? source.selectors) as Record<string, unknown>;
      assertSourceRecipe(data.kind ?? source.kind, selectors);
    }
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

  /**
   * Borra una fuente. Por defecto se niega si ya trajo vacantes (para no perder
   * historial sin querer); con `force` borra en cascada vacantes, matches,
   * borradores y corridas.
   */
  async remove(id: string, force = false): Promise<{ deletedVacancies: number }> {
    const source = await this.prisma.source.findUnique({
      where: { id },
      include: { _count: { select: { vacancies: true } } },
    });
    if (!source) throw new NotFoundException(`Source ${id} no existe`);
    const vacancies = source._count.vacancies;
    if (vacancies > 0 && !force) {
      throw new ConflictException(
        `La fuente tiene ${vacancies} vacantes: deshabilítala, o confirmá el borrado (force=true) para eliminarla con sus vacantes`,
      );
    }
    await this.prisma.source.delete({ where: { id } });
    return { deletedVacancies: vacancies };
  }
}
