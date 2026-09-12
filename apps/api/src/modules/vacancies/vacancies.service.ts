import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma, VacancyProfileStatus, VacancyStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../../common/prisma.service';
import type { ModalityType, SeniorityLevel } from '../../common/job-facets';
import { queueName, QUEUES } from '../../config/queue.config';
import { recomputeVacancyAggregate } from './aggregate';

export interface VacancyListQuery {
  status?: VacancyStatus | 'ALL';
  sourceId?: string;
  /** Solo vacantes evaluadas por este perfil, con SU score (no el mejor global). */
  profileId?: string;
  q?: string;
  limit?: number;
  offset?: number;
  /** Solo vacantes con algún match >= minScore (evita listar el ruido). */
  minScore?: number;
  /** Facets canónicos: modalidad (inclusivo) y seniority. */
  modality?: ModalityType[];
  seniority?: SeniorityLevel[];
  /** Búsqueda por texto en la ubicación (ej. "Bogotá", "Medellín"). */
  location?: string;
}

const ALLOWED_STATUS: VacancyStatus[] = [
  VacancyStatus.RAW,
  VacancyStatus.NORMALIZED,
  VacancyStatus.MATCHED,
  VacancyStatus.RESUME_READY,
  VacancyStatus.APPLIED,
  VacancyStatus.IGNORED,
];

const vacancyListInclude = {
  source: { select: { id: true, name: true, kind: true } },
  vacancyProfiles: {
    select: {
      id: true,
      status: true,
      profile: { select: { id: true, name: true } },
    },
  },
  matches: {
    select: { id: true, score: true, verdict: true, profileId: true },
  },
  drafts: {
    select: { id: true, profileId: true, status: true, version: true, updatedAt: true },
  },
} satisfies Prisma.VacancyInclude;

const detailInclude = {
  source: { select: { id: true, name: true, baseUrl: true, kind: true } },
  vacancyProfiles: {
    include: { profile: { select: { id: true, name: true } } },
  },
  matches: { include: { profile: { select: { id: true, name: true } } } },
  drafts: { include: { profile: { select: { id: true, name: true } } } },
} satisfies Prisma.VacancyInclude;

type ListRow = Prisma.VacancyGetPayload<{ include: typeof vacancyListInclude }>;
type DetailRow = Prisma.VacancyGetPayload<{ include: typeof detailInclude }>;

@Injectable()
export class VacanciesService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(queueName(QUEUES.RESUME)) private readonly resumeQueue: Queue,
  ) {}

  async list(query: VacancyListQuery) {
    const limit = Math.min(query.limit ?? 100, 200);
    const offset = query.offset ?? 0;
    const statusFilter =
      query.status && query.status !== 'ALL' && ALLOWED_STATUS.includes(query.status as VacancyStatus)
        ? (query.status as VacancyStatus)
        : undefined;
    // El perfil acota las dos cosas: qué vacantes se ven (las que evaluó) y a
    // qué match se refiere minScore (el SUYO, no el mejor de cualquier perfil).
    const profileScope = query.profileId ? { profileId: query.profileId } : {};
    const where: Prisma.VacancyWhereInput = {
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(query.sourceId ? { sourceId: query.sourceId } : {}),
      ...(query.profileId
        ? { vacancyProfiles: { some: { profileId: query.profileId } } }
        : {}),
      // Al menos un perfil con match suficiente. Sin esto, todo lo que el
      // scraping trae (incluido lo que no encaja) inunda la pestaña Vacantes.
      ...(typeof query.minScore === 'number' && Number.isFinite(query.minScore)
        ? { matches: { some: { ...profileScope, score: { gte: query.minScore } } } }
        : {}),
      // Modalidad inclusiva: pedir "Remota" trae también las que ofrecen remoto
      // entre varias opciones ("Híbrido / Remoto" → REMOTE + HYBRID).
      ...(query.modality?.length
        ? { modalityTypes: { hasSome: query.modality } }
        : {}),
      ...(query.seniority?.length ? { seniorityLevel: { in: query.seniority } } : {}),
      ...(query.location
        ? { location: { contains: query.location, mode: 'insensitive' as const } }
        : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' as const } },
              { descriptionRaw: { contains: query.q, mode: 'insensitive' as const } },
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
    return { rows: rows.map((row) => mapListRow(row, query.profileId)), total, limit, offset };
  }

  async get(id: string, profileId?: string) {
    const vacancy = await this.prisma.vacancy.findUnique({
      where: { id },
      include: detailInclude,
    });
    if (!vacancy) throw new NotFoundException(`Vacancy ${id} no existe`);
    return mapDetail(vacancy, profileId);
  }

  /** Aplicar/ignorar por perfil (si hay un solo VP no hace falta profileId). */
  async setStatus(id: string, status: 'APPLIED' | 'IGNORED', profileId?: string) {
    const vacancy = await this.prisma.vacancy.findUnique({ where: { id } });
    if (!vacancy) throw new NotFoundException(`Vacancy ${id} no existe`);

    let target = profileId
      ? await this.prisma.vacancyProfile.findUnique({
          where: { vacancyId_profileId: { vacancyId: id, profileId } },
        })
      : null;
    if (!target) {
      const rows = await this.prisma.vacancyProfile.findMany({ where: { vacancyId: id } });
      if (rows.length === 1) target = rows[0];
      else if (rows.length === 0 && profileId) {
        target = await this.prisma.vacancyProfile.create({
          data: { vacancyId: id, profileId },
        });
      }
    }
    if (!target) {
      throw new NotFoundException(
        'Vacante sin perfil definido: enviá profileId (hay varios perfiles evaluando)',
      );
    }

    await this.prisma.vacancyProfile.update({
      where: { id: target.id },
      data: {
        status:
          status === 'APPLIED' ? VacancyProfileStatus.APPLIED : VacancyProfileStatus.IGNORED,
        appliedAt: status === 'APPLIED' ? new Date() : null,
      },
    });

    await recomputeVacancyAggregate(this.prisma, id);
    return this.get(id, profileId);
  }

  /**
   * Genera la HV a pedido, sin importar el score: el pipeline solo la encola
   * cuando el match supera `MATCH_MIN_SCORE`, y hay ofertas que interesan aunque
   * el encaje sea bajo. Requiere el análisis previo (de él sale el ángulo de la HV).
   */
  async enqueueResume(id: string, profileId?: string) {
    const target = await this.resolveProfileFor(id, profileId);

    const match = await this.prisma.matchResult.findUnique({
      where: { vacancyId_profileId: { vacancyId: id, profileId: target } },
      select: { id: true },
    });
    if (!match) {
      throw new BadRequestException(
        'Todavía no hay análisis de encaje para esta vacante con ese perfil',
      );
    }

    const vp = await this.prisma.vacancyProfile.findUnique({
      where: { vacancyId_profileId: { vacancyId: id, profileId: target } },
      select: { status: true },
    });
    if (
      vp?.status === VacancyProfileStatus.APPLIED ||
      vp?.status === VacancyProfileStatus.IGNORED
    ) {
      throw new BadRequestException('La vacante ya está marcada como aplicada o ignorada');
    }

    await this.resumeQueue.add(
      'default',
      { vacancyId: id, profileId: target },
      {
        // Id único por pedido: con un `jobId` fijo, BullMQ descarta el encolado
        // mientras el anterior siga retenido (`removeOnComplete` = 24 h) y el
        // usuario veía que «regenerar la HV» no hacía nada.
        jobId: `resume-${id}-${target}-${Date.now()}`,
        attempts: 4,
        backoff: { type: 'exponential' as const, delay: 3000 },
        removeOnComplete: { age: 86400, count: 1000 },
        removeOnFail: { age: 7 * 86400 },
      },
    );
    return { ok: true, queued: true, profileId: target };
  }

  /** Perfil objetivo: el pedido (validado contra la vacante) o el único que la evaluó. */
  private async resolveProfileFor(id: string, profileId?: string): Promise<string> {
    const vacancy = await this.prisma.vacancy.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!vacancy) throw new NotFoundException(`Vacancy ${id} no existe`);

    if (profileId) {
      const vp = await this.prisma.vacancyProfile.findUnique({
        where: { vacancyId_profileId: { vacancyId: id, profileId } },
        select: { profileId: true },
      });
      if (!vp) throw new BadRequestException('Ese perfil no evaluó esta vacante');
      return vp.profileId;
    }

    const rows = await this.prisma.vacancyProfile.findMany({
      where: { vacancyId: id },
      select: { profileId: true },
    });
    if (rows.length !== 1) {
      throw new BadRequestException(
        'Enviá profileId: hay varios perfiles (o ninguno) asociados a esta vacante',
      );
    }
    return rows[0].profileId;
  }
}

function mapListRow(v: ListRow, profileId?: string) {
  const profiles = v.vacancyProfiles.map((vp) => ({
    profileId: vp.profile.id,
    profileName: vp.profile.name,
    status: vp.status,
    score: v.matches.find((m) => m.profileId === vp.profile.id)?.score ?? null,
    hasResume: v.drafts.some((d) => d.profileId === vp.profile.id),
  }));
  // Con perfil elegido manda SU match (score y HV propios); sin perfil, el mejor.
  const scoped = profileId ? (v.matches.find((m) => m.profileId === profileId) ?? null) : null;
  const best = scoped ?? [...v.matches].sort((a, b) => b.score - a.score)[0] ?? null;
  const bestDraft = profileId
    ? (v.drafts.find((d) => d.profileId === profileId) ?? null)
    : (v.drafts.find((d) => d.profileId === best?.profileId) ?? v.drafts[0] ?? null);
  return {
    ...v,
    // Las ofertas pegadas a mano se marcan en la UI (fuente sintética MANUAL).
    isManual: v.source.kind === 'MANUAL',
    matchScore: best?.score ?? v.matchScore,
    match: best,
    resume: bestDraft
      ? {
          id: bestDraft.id,
          profileId: bestDraft.profileId,
          status: bestDraft.status,
          version: bestDraft.version,
          updatedAt: bestDraft.updatedAt,
        }
      : null,
    profiles,
  };
}

function mapDetail(v: DetailRow, profileId?: string) {
  const profiles = v.vacancyProfiles.map((vp) => {
    const match = v.matches.find((m) => m.profileId === vp.profile.id) ?? null;
    const resume = v.drafts.find((d) => d.profileId === vp.profile.id) ?? null;
    return {
      profileId: vp.profile.id,
      profileName: vp.profile.name,
      status: vp.status,
      score: match?.score ?? null,
      match: match ? toPublicMatch(match) : null,
      resume: resume
        ? {
            id: resume.id,
            version: resume.version,
            status: resume.status,
            content: resume.content,
          }
        : null,
    };
  });
  // Con perfil elegido se muestra SU match y SU HV; sin perfil, el mejor.
  const scoped = profileId ? (v.matches.find((m) => m.profileId === profileId) ?? null) : null;
  const bestMatch = scoped ?? [...v.matches].sort((a, b) => b.score - a.score)[0] ?? null;
  const bestResume = profileId
    ? (v.drafts.find((d) => d.profileId === profileId) ?? null)
    : (v.drafts.find((d) => d.profileId === bestMatch?.profileId) ?? v.drafts[0] ?? null);

  return {
    ...v,
    vacancyProfiles: undefined,
    matches: undefined,
    drafts: undefined,
    isManual: v.source.kind === 'MANUAL',
    matchScore: bestMatch?.score ?? v.matchScore,
    match: bestMatch ? toPublicMatch(bestMatch) : null,
    resume: bestResume
      ? {
          id: bestResume.id,
          // Perfil dueño del borrador: el dashboard necesita saber de quién es
          // la HV que está mostrando (contacto, QR, carta).
          profileId: bestResume.profileId,
          version: bestResume.version,
          status: bestResume.status,
          content: bestResume.content,
        }
      : null,
    profiles,
  };
}

function toPublicMatch(m: DetailRow['matches'][number]) {
  return {
    id: m.id,
    score: m.score,
    analysisScore: m.analysisScore,
    semanticScore: m.semanticScore,
    verdict: m.verdict,
    reasons: m.reasons,
    gaps: m.gaps,
    applicationStrategy: m.applicationStrategy,
    coverLetterDraft: m.coverLetterDraft,
  };
}
