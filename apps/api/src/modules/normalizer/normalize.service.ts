import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { VacancyStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { JsonLogger } from '../../common/json-logger.service';
import { PrismaService } from '../../common/prisma.service';
import { cleanDescription } from '../../common/text.util';
import { queueName, QUEUES } from '../../config/queue.config';
import { LLM_PROVIDER } from '../../config/tokens';
import { LlmProvider } from '../llm/llm-provider.port';
import {
  NormalizeExtract,
  NormalizeExtractSchema,
} from '../pipeline/pipeline.types';

const SYSTEM_PROMPT = `Eres un parser experto de ofertas de empleo. A partir del texto de una vacante devuelve ÚNICAMENTE JSON con esta forma exacta:
{
  "title": "título normalizado (sin ruido, sin ubicación)",
  "company": "empresa o null",
  "location": "ciudad/país o null",
  "modality": "Remoto|Híbrido|Presencial o null",
  "salary": "rango salarial textual o null",
  "seniority": "seniority detectado (ej. Junior, Semi Senior, Senior, Lead) o null",
  "summary": "resumen de 2-3 oraciones con lo más importante del rol",
  "keyRequirements": ["requisito", "requisito", ...máx 10, los más concretos y detallados"],
  "niceToHave": ["deseable", ...],
  "skills": ["habilidad técnica", ... máx 15]
}
No inventes requisitos que no estén en el texto. No agregues markdown ni texto fuera del JSON.`;

const TECH_DICTIONARY = [
  'typescript', 'javascript', 'node', 'nest', 'nestjs', 'express', 'react', 'next', 'nextjs',
  'vue', 'angular', 'rust', 'python', 'go', 'java', 'php', 'c#', '.net', 'c++',
  'postgres', 'postgresql', 'mysql', 'mongodb', 'sqlite', 'redis', 'prisma', 'typeorm',
  'docker', 'kubernetes', 'k8s', 'aws', 'gcp', 'azure', 'nginx', 'terraform',
  'rabbitmq', 'kafka', 'bullmq', 'nats', 'websocket', 'graphql', 'rest', 'grpc',
  'llm', 'openai', 'anthropic', 'claude', 'groq', 'langchain', 'rag', 'pgvector',
  'puppeteer', 'playwright', 'scrapy', 'jwt', 'oauth', 'ci/cd', 'github actions', 'gitlab',
  'vitest', 'jest', 'cypress', 'tailwind', 'flutter', 'react native', 'linux', 'bash',
];

/**
 * Etapa "normalizar": filtra la información más importante y detallada de la
 * vacante (limpieza local + extracción estructurada con IA) y encola el match.
 */
@Injectable()
export class NormalizeService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    @InjectQueue(queueName(QUEUES.MATCH)) private readonly matchQueue: Queue,
    private readonly logger: JsonLogger,
  ) {}

  async handle(vacancyId: string): Promise<void> {
    const vacancy = await this.prisma.vacancy.findUnique({
      where: { id: vacancyId },
    });
    if (!vacancy) return;
    if (vacancy.status === VacancyStatus.APPLIED || vacancy.status === VacancyStatus.IGNORED) return;

    const cleaned = cleanDescription(vacancy.descriptionRaw);
    const ai = await this.llm.json(SYSTEM_PROMPT, this.buildUserPrompt(vacancy, cleaned));
    const extracted: NormalizeExtract = ai
      ? NormalizeExtractSchema.parse(ai)
      : this.deterministicExtract(vacancy, cleaned);

    const enrichment = {
      ...extracted,
      // Campos extraídos que el LLM normaliza mejor que el scrape crudo:
    };

    await this.prisma.vacancy.update({
      where: { id: vacancy.id },
      data: {
        enrichment: enrichment as object,
        status: VacancyStatus.NORMALIZED,
        company: vacancy.company ?? extracted.company ?? null,
        location: vacancy.location ?? extracted.location ?? null,
        salary: vacancy.salary ?? extracted.salary ?? null,
        modality: vacancy.modality ?? extracted.modality ?? null,
      },
    });

    // Fan-out N:M: un job de match por cada perfil que ve la vacante (o solo el
    // perfil elegido, si la vacante se cargó dirigida a uno — oferta pegada).
    const profiles = await this.targetProfileIds(vacancy.sourceId, vacancy.profileId);
    for (const profileId of profiles) {
      await this.prisma.vacancyProfile.upsert({
        where: { vacancyId_profileId: { vacancyId: vacancy.id, profileId } },
        update: {},
        create: { vacancyId: vacancy.id, profileId },
      });
      await this.matchQueue.add(
        'default',
        { vacancyId: vacancy.id, profileId },
        {
          jobId: `match-${vacancy.id}-${profileId}`,
          attempts: 4,
          backoff: { type: 'exponential' as const, delay: 3000 },
          removeOnComplete: { age: 86400, count: 1000 },
          removeOnFail: { age: 7 * 86400 },
        },
      );
    }
    this.logger.log(
      { msg: 'match jobs encolados (por perfil)', vacancyId: vacancy.id, profiles: profiles.length },
      NormalizeService.name,
    );
  }

  /**
   * Perfiles que ven esta vacante: si la vacante viene dirigida a uno (ofertas
   * pegadas a mano) solo ese; si no, las selecciones habilitadas de la fuente y,
   * si no hay ninguna, el perfil primario.
   */
  private async targetProfileIds(
    sourceId: string,
    directedProfileId: string | null,
  ): Promise<string[]> {
    if (directedProfileId) return [directedProfileId];
    const selections = await this.prisma.profileSource.findMany({
      where: { sourceId, enabled: true },
      select: { profileId: true },
    });
    const ids = selections.map((s) => s.profileId);
    if (ids.length > 0) return [...new Set(ids)];
    const primary = await this.prisma.profile.findFirst({
      where: { isPrimary: true },
      select: { id: true },
    });
    return primary ? [primary.id] : [];
  }

  private buildUserPrompt(vacancy: unknown, cleaned: string): string {
    return `Vacante scrapeada:\nTítulo: ${(vacancy as { title: string }).title}\nEmpresa: ${(vacancy as { company: string | null }).company ?? 'desconocida'}\nUbicación: ${(vacancy as { location: string | null }).location ?? 'desconocida'}\n\nTexto completo de la oferta:\n${cleaned.slice(0, 8000)}`;
  }

  private deterministicExtract(
    vacancy: { title: string; company: string | null; location: string | null; descriptionRaw: string },
    cleaned: string,
  ): NormalizeExtract {
    const lower = cleaned.toLowerCase();
    const modality =
      (lower.includes('remoto') && lower.includes('híbrido')) || (lower.includes('remoto') && lower.includes('hibrido'))
        ? 'Híbrido / Remoto'
        : lower.includes('remoto')
          ? 'Remoto'
          : lower.includes('híbrido') || lower.includes('hibrido')
            ? 'Híbrido'
            : lower.includes('presencial')
              ? 'Presencial'
              : null;

    const salaryMatch = cleaned.match(/((?:\$|COP\s*)?[\d.,]+(?:\s*-\s*[\d.,]+)?\s*(?:COP|USD|millones|pesos)?)/i);
    const salary = salaryMatch && /[\d.]{4,}/.test(salaryMatch[1]) ? salaryMatch[1].trim() : null;

    const seniority =
      (lower.includes('lead') || lower.includes('team leader') || lower.includes('tech lead'))
        ? 'Lead'
        : lower.includes('senior') || lower.includes('sr.')
          ? 'Senior'
          : lower.includes('semi senior') || lower.includes('semisenior')
            ? 'Semi Senior'
            : lower.includes('junior') || lower.includes('jr.')
              ? 'Junior'
              : lower.includes('trainee')
                ? 'Trainee'
                : null;

    const bullets = cleaned
      .split('\n')
      .map((l) => l.replace(/^[•·\-\*\d.)\s]+/, '').trim())
      .filter((l) => l.length > 15 && l.length < 240)
      .slice(0, 12);

    // Líneas que parecen requisitos: contienen verbos típicos o empiezan con mayúscula y son concretas.
    const requirementHints = ['experiencia', 'conocimiento', 'dominio', 'manejo', 'deseable', 'requisito', 'exigimos', 'buscamos', 'debes', 'deber', 'inglés', 'ingles'];
    const keyRequirements = bullets.filter((b) =>
      requirementHints.some((hint) => b.toLowerCase().includes(hint)),
    ).slice(0, 10);
    if (keyRequirements.length === 0) {
      keyRequirements.push(...bullets.slice(0, 5));
    }

    const skills = [...new Set(
      TECH_DICTIONARY.filter((tok) => lower.includes(tok)),
    )].slice(0, 15);

    const summary = cleaned.split('\n').slice(0, 3).join(' ').slice(0, 400);

    return {
      title: vacancy.title,
      company: vacancy.company,
      location: vacancy.location,
      modality,
      salary,
      seniority,
      summary,
      keyRequirements,
      niceToHave: bullets.filter((b) => /deseable|plus|nice to have/i.test(b)).slice(0, 5),
      skills,
    };
  }

  private jobOpts(jobId: string) {
    return {
      jobId: `match-${jobId}`,
      attempts: 4,
      backoff: { type: 'exponential' as const, delay: 3000 },
      removeOnComplete: { age: 86400, count: 1000 },
      removeOnFail: { age: 7 * 86400 },
    };
  }
}
