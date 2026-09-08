import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, VacancyStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { JsonLogger } from '../../common/json-logger.service';
import { PrismaService } from '../../common/prisma.service';
import { queueName, QUEUES } from '../../config/queue.config';
import { LLM_PROVIDER } from '../../config/tokens';
import { env } from '../../config/env';
import { LlmProvider } from '../llm/llm-provider.port';
import {
  MatchOutcome,
  MatchOutcomeSchema,
} from '../pipeline/pipeline.types';
import { buildProfileSnapshot } from '../profiles/profile-snapshot';

const SYSTEM_PROMPT = `Eres un reclutador técnico senior experto en ATS. Comparas el perfil canónico de un candidato con una vacante y decides qué tan buen match es.

Devuelve ÚNICAMENTE JSON con esta forma exacta:
{
  "score": 0-100 entero,
  "reasons": ["razón 1", "razón 2", "razón 3"] (por qué el candidato encaja; máximo 4, concretas),
  "gaps": ["brecha 1", ...] (requisitos de la vacante que el candidato no cubre o cubre débil; máximo 4),
  "applicationStrategy": {
    "highlights": ["logro/habilidad que debe destacar", ... máximo 5],
    "keywords": ["palabra clave ATS", ... máximo 8],
    "angle": "ángulo narrativo de 1-2 oraciones: cómo posicionar al candidato para ESTA vacante",
    "suggestedChannel": "canal sugerido para aplicar (ej. LinkedIn, portal de la empresa, contacto directo)"
  },
  "coverLetterDraft": "primer párrafo de carta de presentación (3-4 oraciones) usando SOLO hechos del perfil"
}

Reglas: usa exclusivamente datos del perfil; no inventes experiencia ni skills. Sé estricto: skills que el candidato no domina (nivel ≤ 2) cuentan como brechas si la vacante los pide. Un match débil con skills irrelevantes debe dar score bajo.`;

/**
 * Etapa "match": evalúa la vacante contra el perfil canónico, guarda el score y
 * la fórmula de aplicación, y encola la generación de HV si pasa el umbral.
 */
@Injectable()
export class MatchService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    @InjectQueue(queueName(QUEUES.RESUME)) private readonly resumeQueue: Queue,
    private readonly logger: JsonLogger,
  ) {}

  async handle(vacancyId: string): Promise<void> {
    const vacancy = await this.prisma.vacancy.findUnique({
      where: { id: vacancyId },
      include: { source: true },
    });
    if (!vacancy) return;
    if (
      vacancy.status === VacancyStatus.APPLIED ||
      vacancy.status === VacancyStatus.IGNORED
    ) {
      return;
    }

    const profileSnapshot = await buildProfileSnapshot(
      this.prisma,
      vacancy.profileId,
    );

    const ai = await this.llm.json(SYSTEM_PROMPT, this.buildUserPrompt(vacancy, profileSnapshot));
    const outcome = ai
      ? MatchOutcomeSchema.parse(ai)
      : await this.deterministicOutcome(vacancy);

    const score = Math.round(outcome.score);
    const verdict =
      score >= 80 ? 'GOOD_MATCH' : score >= 60 ? 'POSSIBLE' : 'WEAK';

    const strategy: MatchOutcome['applicationStrategy'] = {
      highlights: outcome.applicationStrategy.highlights,
      keywords: outcome.applicationStrategy.keywords,
      angle: outcome.applicationStrategy.angle,
      suggestedChannel: outcome.applicationStrategy.suggestedChannel,
    };

    const matchResult = await this.prisma.matchResult.upsert({
      where: { vacancyId: vacancy.id },
      update: {
        score,
        verdict,
        reasons: outcome.reasons as Prisma.InputJsonValue,
        gaps: outcome.gaps as Prisma.InputJsonValue,
        applicationStrategy: strategy as Prisma.InputJsonValue,
        coverLetterDraft: outcome.coverLetterDraft || null,
      },
      create: {
        vacancyId: vacancy.id,
        score,
        verdict,
        reasons: outcome.reasons as Prisma.InputJsonValue,
        gaps: outcome.gaps as Prisma.InputJsonValue,
        applicationStrategy: strategy as Prisma.InputJsonValue,
        coverLetterDraft: outcome.coverLetterDraft || null,
      },
    });

    await this.prisma.vacancy.update({
      where: { id: vacancy.id },
      data: {
        matchScore: score,
        status:
          vacancy.status === VacancyStatus.RAW ||
          vacancy.status === VacancyStatus.NORMALIZED
            ? VacancyStatus.MATCHED
            : vacancy.status,
      },
    });

    const shouldGenerateResume = score >= env.MATCH_MIN_SCORE;
    this.logger.log(
      {
        msg: 'match calculado',
        vacancyId: vacancy.id,
        source: vacancy.source?.name,
        score,
        verdict,
        generateResume: shouldGenerateResume,
        threshold: env.MATCH_MIN_SCORE,
        provider: this.llm.name,
      },
      MatchService.name,
    );

    if (shouldGenerateResume) {
      await this.resumeQueue.add(
        'default',
        { vacancyId: vacancy.id },
        this.jobOpts(matchResult.id),
      );
    }
  }

  private buildUserPrompt(
    vacancy: {
      id: string;
      title: string;
      company: string | null;
      location: string | null;
      descriptionRaw: string;
      enrichment: Prisma.JsonValue | null;
    },
    profileSnapshot: string,
  ): string {
    const enr = (vacancy.enrichment ?? {}) as Record<string, unknown>;
    const structured = {
      titulo: vacancy.title,
      empresa: vacancy.company,
      ubicacion: vacancy.location,
      modalidad: enr.modality ?? null,
      salario: enr.salary ?? null,
      seniority: enr.seniority ?? null,
      resumen: enr.summary ?? null,
      requisitos: enr.keyRequirements ?? [],
      deseable: enr.niceToHave ?? [],
      skills: enr.skills ?? [],
    };
    return `VACANTE (estructurada):\n${JSON.stringify(structured, null, 2)}\n\nTEXTO ORIGINAL (contexto):\n${vacancy.descriptionRaw.slice(0, 6000)}\n\n${profileSnapshot}`;
  }

  /** Respaldo determinístico (sin red): solape de skills con el perfil. */
  private async deterministicOutcome(vacancy: {
    id: string;
    title: string;
    company: string | null;
    location: string | null;
    profileId: string | null;
    descriptionRaw: string;
    enrichment: Prisma.JsonValue | null;
  }): Promise<MatchOutcome> {
    const enr = (vacancy.enrichment ?? {}) as Record<string, unknown>;
    const vacancySkills = Array.isArray(enr.skills)
      ? (enr.skills as string[])
      : [];

    const profile = await this.prisma.profile.findFirst({
      where: vacancy.profileId ? { id: vacancy.profileId } : { isPrimary: true },
      include: { skills: { include: { skill: true } } },
    });
    const profileSkills = profile?.skills ?? [];
    const profileNames = profileSkills.map((ps) => ps.skill.name.toLowerCase());

    const matchName = (token: string): boolean =>
      profileNames.some(
        (name) => token.toLowerCase().includes(name) || name.includes(token.toLowerCase()),
      );

    const matched = vacancySkills.filter(matchName);
    const missing = vacancySkills.filter((s) => !matchName(s));

    const score = Math.max(8, Math.min(96, 42 + matched.length * 7));
    const reasons =
      matched.length > 0
        ? [
            `El perfil domina ${matched.slice(0, 4).join(', ')} que la vacante pide.`,
            'Experiencia comprobable en sistemas backend y arquitectura en producción.',
            'Fuerte alineación con el stack y los patrones de la oferta.',
          ]
        : ['No hay solape claro de skills entre el perfil y la vacante.'];

    return {
      score,
      reasons,
      gaps: missing.slice(0, 4).map((s) => `No figura "${s}" en el perfil canónico.`),
      applicationStrategy: {
        highlights: matched.slice(0, 5),
        keywords: [vacancy.title, ...matched.slice(0, 7)],
        angle: `Posicionar a Christian como ${vacancy.title.toLowerCase()} con foco en ${matched.slice(0, 3).join(', ') || 'su experiencia backend y de sistemas distribuidos'}, mostrando proyectos concretos de arquitectura y automatización.`,
        suggestedChannel:
          vacancy.location?.toLowerCase().includes('remoto')
            ? 'Aplicar directo en el portal y reforzar con LinkedIn'
            : 'Aplicar en el portal de la empresa y contactar al reclutador por LinkedIn',
      },
      coverLetterDraft: `Hola equipo de ${vacancy.company ?? 'la empresa'}, soy Christian Henao, AI Engineer con liderazgo de equipos y experiencia en sistemas distribuidos y aplicaciones con IA en producción. Para el rol de ${vacancy.title} destacaría mi trabajo en ${matched.slice(0, 2).join(' y ') || 'arquitecturas backend escalables'}, donde apliqué los mismos patrones que la vacante requiere.`,
    };
  }

  private jobOpts(jobId: string) {
    return {
      jobId: `resume-${jobId}`,
      attempts: 4,
      backoff: { type: 'exponential' as const, delay: 3000 },
      removeOnComplete: { age: 86400, count: 1000 },
      removeOnFail: { age: 7 * 86400 },
    };
  }
}
