import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, VacancyProfileStatus, VacancyStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
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
  source: { select: { id: true, name: true } },
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
  source: { select: { id: true, name: true, baseUrl: true } },
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
  constructor(private readonly prisma: PrismaService) {}

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
