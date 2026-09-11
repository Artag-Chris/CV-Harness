import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, VacancyProfileStatus, VacancyStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { JsonLogger } from '../../common/json-logger.service';
import { PrismaService } from '../../common/prisma.service';
import { queueName, QUEUES } from '../../config/queue.config';
import { LLM_PROVIDER } from '../../config/tokens';
import { LlmProvider } from '../llm/llm-provider.port';
import {
  ResumeContent,
  ResumeContentSchema,
} from '../pipeline/pipeline.types';
import { buildProfileSnapshot } from '../profiles/profile-snapshot';
import { recomputeVacancyAggregate } from '../vacancies/aggregate';
import { renderResumeMarkdown } from './resume-markdown';

const SYSTEM_PROMPT = `Eres un redactor profesional de hojas de vida (ATS-friendly). Reescribes el perfil de un candidato para una vacante específica maximizando el match con palabras clave, SIN inventar experiencia, logros, tecnologías ni datos.

Devuelve ÚNICAMENTE JSON con esta forma exacta:
{
  "headline": "título de una línea orientado a la vacante",
  "summary": "resumen de 3-4 líneas enfocado en lo que la vacante pide, usando solo hechos del perfil",
  "skills": ["skill", ...] (20 máximo, ordenadas por relevancia),
  "experience": [{"role": "...", "company": "...", "period": "2024 – Presente", "bullets": ["...", ...]}],
  "projects": [{"name": "...", "highlights": ["...", ...]}],
  "education": [{"institution": "...", "degree": "...", "period": "2023 – Presente"}],
  "softSkills": ["...", ...máx 5],
  "keywords": ["palabra clave", ... máx 8]
}

Reglas: los bullets de experiencia y proyectos deben reescribirse para resaltar lo relevante a la vacante, pero conservando exactamente los hechos del perfil. Prohibido agregar empresas, títulos, certificaciones o métricas que no estén en el perfil. Responde en español salvo que la vacante esté en otro idioma.`;

/**
 * Etapa "resume" N:M: genera el borrador de HV para (vacante, perfil).
 */
@Injectable()
export class ResumeService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    @InjectQueue(queueName(QUEUES.NOTIFICATION))
    private readonly notificationQueue: Queue,
    private readonly logger: JsonLogger,
  ) {}

  async handle(vacancyId: string, profileId: string): Promise<void> {
    const [vacancy, profile] = await Promise.all([
      this.prisma.vacancy.findUnique({
        where: { id: vacancyId },
        include: { source: true },
      }),
      this.prisma.profile.findUnique({ where: { id: profileId } }),
    ]);
    if (!vacancy || !profile) return;

    // Si este perfil ya se aplicó/ignoró, no regenerar.
    const vp = await this.prisma.vacancyProfile.findUnique({
      where: { vacancyId_profileId: { vacancyId, profileId } },
    });
    if (
      vp?.status === VacancyProfileStatus.APPLIED ||
      vp?.status === VacancyProfileStatus.IGNORED
    ) {
      return;
    }

    const match = await this.prisma.matchResult.findUnique({
      where: { vacancyId_profileId: { vacancyId, profileId } },
    });
    if (!match) return;

    const profileSnapshot = await buildProfileSnapshot(this.prisma, profileId);
    const ai = await this.llm.json(
      SYSTEM_PROMPT,
      this.buildUserPrompt(vacancy, match, profileSnapshot),
    );
    const content: ResumeContent = ai
      ? ResumeContentSchema.parse(ai)
      : await this.deterministicContent(vacancy, profileId, match);

    const markdown = renderResumeMarkdown(content, profile.name);

    // Al regenerar la HV se conserva la carta de presentación ya escrita: vive
    // en el mismo JSON y perderla obligaría a re-generarla (y a re-editarla).
    const existingDraft = await this.prisma.resumeDraft.findUnique({
      where: { vacancyId_profileId: { vacancyId, profileId } },
      select: { content: true },
    });
    const previous = (existingDraft?.content ?? {}) as Record<string, unknown>;
    const coverLetterFields =
      typeof previous.coverLetter === 'string'
        ? {
            coverLetter: previous.coverLetter,
            coverLetterSource: previous.coverLetterSource,
            coverLetterUpdatedAt: previous.coverLetterUpdatedAt,
          }
        : {};

    const resume = await this.prisma.resumeDraft.upsert({
      where: { vacancyId_profileId: { vacancyId, profileId } },
      update: {
        content: { ...content, markdown, ...coverLetterFields } as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
      create: {
        vacancyId,
        profileId,
        content: { ...content, markdown } as Prisma.InputJsonValue,
      },
    });

    await this.prisma.vacancyProfile.upsert({
      where: { vacancyId_profileId: { vacancyId, profileId } },
      update: { status: VacancyProfileStatus.RESUME_READY },
      create: { vacancyId, profileId, status: VacancyProfileStatus.RESUME_READY },
    });

    await recomputeVacancyAggregate(this.prisma, vacancyId);

    await this.notificationQueue.add(
      'default',
      {
        type: 'RESUME_READY',
        title: `HV lista: ${vacancy.title}`,
        body: `${profile.name} · ${vacancy.company ?? vacancy.source?.name ?? ''} · match ${match.score}/100 — revisa el borrador en el dashboard.`,
        payload: { vacancyId, resumeId: resume.id, profileId },
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 86400, count: 1000 },
        removeOnFail: { age: 7 * 86400 },
      },
    );

    this.logger.log(
      {
        msg: 'borrador de HV generado (por perfil)',
        vacancyId,
        profileId,
        profileName: profile.name,
        resumeId: resume.id,
        provider: this.llm.name,
      },
      ResumeService.name,
    );
  }

  private buildUserPrompt(
    vacancy: { title: string; company: string | null },
    match: {
      score: number;
      applicationStrategy: Prisma.JsonValue;
      coverLetterDraft: string | null;
    },
    profileSnapshot: string,
  ): string {
    const strategy = (match.applicationStrategy ?? {}) as {
      highlights?: string[];
      keywords?: string[];
      angle?: string;
    };
    return `VACANTE: ${vacancy.title}${vacancy.company ? ` — ${vacancy.company}` : ''} (match ${match.score}/100)
ÁNGULO SUGERIDO: ${strategy.angle ?? ''}
KEYWORDS: ${(strategy.keywords ?? []).join(', ')}
BORRADOR DE CARTA: ${match.coverLetterDraft ?? ''}

${profileSnapshot}`;
  }

  /** Respaldo determinístico: perfil canónico + keywords del strategy. */
  private async deterministicContent(
    vacancy: { title: string; company: string | null },
    profileId: string,
    match: { applicationStrategy: Prisma.JsonValue },
  ): Promise<ResumeContent> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: profileId },
      include: {
        experiences: { orderBy: { sortOrder: 'asc' } },
        education: { orderBy: { sortOrder: 'asc' } },
        projects: true,
        skills: { include: { skill: true }, orderBy: { rating: 'desc' } },
      },
    });
    if (!profile) throw new Error('No hay perfil sembrado');

    const strategy = (match.applicationStrategy ?? {}) as {
      keywords?: string[];
    };
    const keywords = (strategy.keywords ?? []).map((k) => k.toLowerCase());

    const skills = [...profile.skills]
      .sort((a, b) => {
        const ka = keywords.some((k) => a.skill.name.toLowerCase().includes(k));
        const kb = keywords.some((k) => b.skill.name.toLowerCase().includes(k));
        return Number(kb) - Number(ka) || b.rating - a.rating;
      })
      .slice(0, 22)
      .map((ps) => ps.skill.name);

    const exp = profile.experiences.map((e) => ({
      role: e.role,
      company: e.company,
      period: e.periodEnd ? `${e.periodStart} – ${e.periodEnd}` : e.periodStart,
      bullets: (e.bullets as string[]) ?? [],
    }));

    const projects = profile.projects.slice(0, 4).map((p) => ({
      name: p.name,
      highlights: (p.highlights as string[] ?? []).slice(0, 3),
    }));

    const summary = `${profile.headline[0]} con base en backend distribuido, IA en producción y arquitecturas event-driven. Enfocado en aportar al equipo de ${vacancy.company ?? vacancy.title}.`;

    return {
      headline: `${profile.headline[0]} — postulando a ${vacancy.title}`,
      summary,
      skills,
      experience: exp,
      projects,
      education: profile.education.map((e) => ({
        institution: e.institution,
        degree: e.degree,
        period: e.periodEnd ? `${e.periodStart} – ${e.periodEnd}` : e.periodStart,
      })),
      softSkills: (profile.softSkills as string[] ?? []).slice(0, 5),
      keywords: keywords.slice(0, 8),
    };
  }
}
