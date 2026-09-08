import {
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

export const UpsertSourceSchema = z.object({
  name: z.string().min(1),
  kind: z.string().default('HTML_RECIPE'),
  baseUrl: z.string().url(),
  listUrl: z.string().url(),
  selectors: SelectorRecipeSchema,
  limits: LimitsSchema,
  enabled: z.boolean().default(true),
  intervalMinutes: z.number().int().positive().default(1440),
  profileId: z.string().nullable().optional(),
});

export type UpsertSourceInput = z.infer<typeof UpsertSourceSchema>;

@Injectable()
export class SourcesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<Source[]> {
    return this.prisma.source.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { vacancies: true } } },
    });
  }

  async get(id: string): Promise<Source | null> {
    const source = await this.prisma.source.findUnique({ where: { id } });
    if (!source) throw new NotFoundException(`Source ${id} no existe`);
    return source;
  }

  async create(input: unknown): Promise<Source> {
    const data = UpsertSourceSchema.parse(input);
    return this.prisma.source.create({
      data: {
        name: data.name,
        kind: data.kind,
        baseUrl: data.baseUrl,
        listUrl: data.listUrl,
        selectors: data.selectors as Prisma.InputJsonValue,
        limits: data.limits as Prisma.InputJsonValue,
        enabled: data.enabled,
        intervalMinutes: data.intervalMinutes,
        profileId: data.profileId ?? null,
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
        ...(data.profileId !== undefined && { profileId: data.profileId }),
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
