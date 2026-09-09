import { Prisma, VacancyProfileStatus, VacancyStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

type P = PrismaService;

/**
 * Recalcula el estado global y el mejor score de una vacante a partir de sus
 * VacancyProfile / MatchResult (agregado N:M para el listado del dashboard).
 */
export async function recomputeVacancyAggregate(
  prisma: P,
  vacancyId: string,
): Promise<void> {
  const [vps, matches] = await Promise.all([
    prisma.vacancyProfile.findMany({
      where: { vacancyId },
      select: { status: true },
    }),
    prisma.matchResult.findMany({
      where: { vacancyId },
      select: { score: true },
    }),
  ]);

  if (vps.length === 0) return;

  const counts = {
    APPLIED: vps.filter((v) => v.status === VacancyProfileStatus.APPLIED).length,
    IGNORED: vps.filter((v) => v.status === VacancyProfileStatus.IGNORED).length,
    RESUME_READY: vps.filter((v) => v.status === VacancyProfileStatus.RESUME_READY).length,
    MATCHED: vps.filter((v) => v.status === VacancyProfileStatus.MATCHED).length,
  };

  let status: VacancyStatus;
  if (counts.APPLIED > 0 && counts.RESUME_READY === 0 && counts.MATCHED === 0) {
    status = VacancyStatus.APPLIED;
  } else if (counts.RESUME_READY > 0) {
    status = VacancyStatus.RESUME_READY;
  } else if (counts.MATCHED > 0) {
    status = VacancyStatus.MATCHED;
  } else if (counts.IGNORED === vps.length) {
    status = VacancyStatus.IGNORED;
  } else {
    status = VacancyStatus.NORMALIZED;
  }

  const best = matches.reduce((max, m) => Math.max(max, m.score), 0);
  const hasApplied = vps.some((v) => v.status === VacancyProfileStatus.APPLIED);

  await prisma.vacancy.update({
    where: { id: vacancyId },
    data: {
      status,
      matchScore: best > 0 ? best : null,
      appliedAt: hasApplied ? await firstAppliedAt(prisma, vacancyId) : undefined,
    },
  });
}

async function firstAppliedAt(prisma: P, vacancyId: string): Promise<Date | null> {
  const row = await prisma.vacancyProfile.findFirst({
    where: { vacancyId, appliedAt: { not: null } },
    orderBy: { appliedAt: 'asc' },
    select: { appliedAt: true },
  });
  return row?.appliedAt ?? null;
}

/** Tipos exportados para reuso (evita importar Prisma en consumidores). */
export type { Prisma };
