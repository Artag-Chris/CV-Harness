import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, VacancyStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

const vacancyListInclude = {
  source: { select: { id: true, name: true } },
  profile: { select: { id: true, name: true } },
  match: { select: { id: true, score: true, verdict: true } },
  resume: { select: { id: true, status: true, version: true, updatedAt: true } },
} satisfies Prisma.VacancyInclude;

export interface VacancyListQuery {
  status?: VacancyStatus | 'ALL';
  sourceId?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

const ALLOWED_STATUS: VacancyStatus[] = [
  VacancyStatus.RAW,
  VacancyStatus.NORMALIZED,
  VacancyStatus.MATCHED,
  VacancyStatus.RESUME_READY,
  VacancyStatus.APPLIED,
  VacancyStatus.IGNORED,
];

@Injectable()
export class VacanciesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: VacancyListQuery) {
    const limit = Math.min(query.limit ?? 100, 200);
    const offset = query.offset ?? 0;
    // El status llega como string del query string: solo se filtra si es válido.
    const statusFilter =
      query.status && query.status !== 'ALL' && ALLOWED_STATUS.includes(query.status as VacancyStatus)
        ? (query.status as VacancyStatus)
        : undefined;
    const where: Prisma.VacancyWhereInput = {
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(query.sourceId ? { sourceId: query.sourceId } : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' as const } },
              {
                descriptionRaw: { contains: query.q, mode: 'insensitive' as const },
              },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.vacancy.findMany({
        where,
        include: vacancyListInclude,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.vacancy.count({ where }),
    ]);
    return { rows, total, limit, offset };
  }

  async get(id: string) {
    const vacancy = await this.prisma.vacancy.findUnique({
      where: { id },
      include: {
        source: { select: { id: true, name: true, baseUrl: true } },
        profile: { select: { id: true, name: true } },
        match: true,
        resume: true,
      },
    });
    if (!vacancy) throw new NotFoundException(`Vacancy ${id} no existe`);
    return vacancy;
  }

  async setStatus(id: string, status: 'APPLIED' | 'IGNORED') {
    const vacancy = await this.prisma.vacancy.findUnique({ where: { id } });
    if (!vacancy) throw new NotFoundException(`Vacancy ${id} no existe`);
    return this.prisma.vacancy.update({
      where: { id },
      data: {
        status,
        appliedAt: status === 'APPLIED' ? new Date() : vacancy.appliedAt,
      },
      include: vacancyListInclude,
    });
  }
}
