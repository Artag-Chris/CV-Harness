import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, VacancyProfileStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { languageInstruction, resolveApplyLanguage } from '../../common/apply-language';
import { JsonLogger } from '../../common/json-logger.service';
import { PrismaService } from '../../common/prisma.service';
import { queueName, QUEUES } from '../../config/queue.config';
import { LLM_PROVIDER } from '../../config/tokens';
import { LlmProvider } from '../llm/llm-provider.port';
import {
  InterviewPrepContent,
  InterviewPrepContentSchema,
} from '../pipeline/pipeline.types';
import { buildProfileSnapshot } from '../profiles/profile-snapshot';

const SYSTEM_PROMPT = `Eres un coach técnico que prepara a un candidato para la entrevista de una vacante específica. Conoces el perfil real del candidato y la oferta, y armas un plan de preparación accionable. NUNCA inventas experiencia, logros ni datos del candidato: todo lo que propongas debe apoyarse en hechos del perfil.

Devuelve ÚNICAMENTE JSON con esta forma exacta:
{
  "summary": "diagnóstico breve: cómo se ve el candidato frente a esta vacante y qué debe priorizar",
  "focusAreas": ["tema que conviene dominar", ...],
  "studyPlan": [{"topic": "...", "why": "...", "resources": ["qué estudiar o repasar"], "practice": "ejercicio concreto de práctica"}],
  "likelyQuestions": [{"question": "...", "category": "técnica|conductual|del rol|de la empresa", "answerOutline": "cómo estructurar la respuesta (STAR) usando hechos del perfil"}],
  "trickyQuestions": [{"question": "pregunta capciosa o engañosa", "whyTricky": "qué trampa o sesgo esconde", "howToAnswer": "cómo responderla sin caer en la trampa"}],
  "redFlags": ["señal de alerta detectada en la oferta (si hay)"],
  "questionsToAsk": ["pregunta inteligente para hacerle al entrevistador", ...],
  "checklist": [{"item": "acción concreta antes de la entrevista", "done": false}]
}

Reglas:
- El plan de estudio debe priorizar los requisitos clave y las brechas reales del candidato, no un temario genérico.
- Incluye al menos 6 preguntas probables y al menos 4 preguntas capciosas con su explicación.
- Las respuestas sugeridas se redactan en primera persona y se apoyan en la experiencia y proyectos REALES del perfil.
- Sé concreto y breve en cada campo; nada de relleno.`;

/** Contenido extendido con el avance local (checkbox por tema). */
type PrepContent = InterviewPrepContent & {
  studyPlan: (InterviewPrepContent['studyPlan'][number] & { done?: boolean })[];
};

/**
 * Preparación de entrevista por (vacante, perfil). Se genera a pedido cuando la
 * postulación está APPLIED y se guarda como artefacto propio (no dentro de la HV).
 */
@Injectable()
export class InterviewService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    @InjectQueue(queueName(QUEUES.INTERVIEW))
    private readonly interviewQueue: Queue,
    @InjectQueue(queueName(QUEUES.NOTIFICATION))
    private readonly notificationQueue: Queue,
    private readonly logger: JsonLogger,
  ) {}

  /** Encola la generación (acción explícita del usuario desde el dashboard). */
  async enqueue(vacancyId: string, profileId?: string) {
    const target = await this.resolveProfileFor(vacancyId, profileId);

    const vp = await this.prisma.vacancyProfile.findUnique({
      where: { vacancyId_profileId: { vacancyId, profileId: target } },
      select: { status: true },
    });
    if (vp?.status !== VacancyProfileStatus.APPLIED) {
      throw new BadRequestException(
        'Marcá la vacante como aplicada antes de preparar la entrevista',
      );
    }

    await this.interviewQueue.add(
      'default',
      { vacancyId, profileId: target },
      {
        // jobId único por pedido: un id fijo haría que BullMQ descarte el
        // reencolado mientras el anterior siga retenido (regenerar no haría nada).
        jobId: `interview-${vacancyId}-${target}-${Date.now()}`,
        attempts: 4,
        backoff: { type: 'exponential' as const, delay: 3000 },
        removeOnComplete: { age: 86400, count: 1000 },
        removeOnFail: { age: 7 * 86400 },
      },
    );
    return { ok: true, queued: true, profileId: target };
  }

  /** Genera el plan con IA (o determinístico) y lo persiste. */
  async handle(vacancyId: string, profileId: string): Promise<void> {
    const [vacancy, profile] = await Promise.all([
      this.prisma.vacancy.findUnique({ where: { id: vacancyId }, include: { source: true } }),
      this.prisma.profile.findUnique({ where: { id: profileId } }),
    ]);
    if (!vacancy || !profile) return;

    const match = await this.prisma.matchResult.findUnique({
      where: { vacancyId_profileId: { vacancyId, profileId } },
    });

    // Idioma por defecto `auto`: sigue el de la vacante (override del perfil encima).
    const language = resolveApplyLanguage(undefined, profile.applyLanguage);
    const profileSnapshot = await buildProfileSnapshot(this.prisma, profileId);

    const ai = await this.llm.json(
      `${SYSTEM_PROMPT}\n\nIdioma de salida: ${languageInstruction(language)}`,
      this.buildUserPrompt(vacancy, match, profileSnapshot),
    );
    const generated: PrepContent = ai
      ? InterviewPrepContentSchema.parse(ai)
      : this.deterministicContent(vacancy, match);
    const source: 'ia' | 'plantilla' = ai ? 'ia' : 'plantilla';

    const previous = await this.prisma.interviewPrep.findUnique({
      where: { vacancyId_profileId: { vacancyId, profileId } },
      select: { content: true },
    });
    const content = withPreservedProgress(generated, previous?.content);

    const prep = await this.prisma.interviewPrep.upsert({
      where: { vacancyId_profileId: { vacancyId, profileId } },
      update: { content: content as unknown as Prisma.InputJsonValue, source, version: { increment: 1 } },
      create: {
        vacancyId,
        profileId,
        content: content as unknown as Prisma.InputJsonValue,
        source,
      },
    });

    await this.notificationQueue.add(
      'default',
      {
        type: 'INTERVIEW_READY',
        title: `Preparación lista: ${vacancy.title}`,
        body: `${profile.name} · ${vacancy.company ?? vacancy.source?.name ?? ''} — abrí el plan de entrevista en el dashboard.`,
        payload: { vacancyId, prepId: prep.id, profileId },
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 86400, count: 1000 },
        removeOnFail: { age: 7 * 86400 },
      },
    );

    this.logger.log(
      { msg: 'preparación de entrevista generada', vacancyId, profileId, prepId: prep.id, source, provider: this.llm.name },
      InterviewService.name,
    );
  }

  /** Guarda el plan editado a mano desde el dashboard. */
  async saveEdited(id: string, content: Record<string, unknown>) {
    const prep = await this.prisma.interviewPrep.findUnique({ where: { id } });
    if (!prep) throw new NotFoundException(`Preparación ${id} no existe`);

    const previous =
      prep.content && typeof prep.content === 'object' && !Array.isArray(prep.content)
        ? (prep.content as Record<string, unknown>)
        : {};
    // Merge: no revalidamos con el schema completo porque zod descartaría campos
    // que no define (p. ej. el avance `done` de temas y checklist).
    const merged = { ...previous, ...content };

    const updated = await this.prisma.interviewPrep.update({
      where: { id },
      data: {
        content: merged as Prisma.InputJsonValue,
        status: 'FINAL',
        source: 'editada',
        version: { increment: 1 },
      },
    });
    return mapPrep(updated);
  }

  private buildUserPrompt(
    vacancy: {
      title: string;
      company: string | null;
      location: string | null;
      modality: string | null;
      seniorityLevel: string | null;
      descriptionRaw: string;
      enrichment: Prisma.JsonValue | null;
    },
    match: { score: number; gaps: Prisma.JsonValue; applicationStrategy: Prisma.JsonValue } | null,
    profileSnapshot: string,
  ): string {
    const enr = (vacancy.enrichment ?? {}) as Record<string, unknown>;
    const strategy = (match?.applicationStrategy ?? {}) as { angle?: string };
    const structured = {
      titulo: vacancy.title,
      empresa: vacancy.company,
      ubicacion: vacancy.location,
      modalidad: enr.modality ?? vacancy.modality ?? null,
      seniority: enr.seniority ?? vacancy.seniorityLevel ?? null,
      resumen: enr.summary ?? null,
      requisitos: enr.keyRequirements ?? [],
      deseables: enr.niceToHave ?? [],
      skills: enr.skills ?? [],
    };
    return `VACANTE:\n${JSON.stringify(structured, null, 2)}

TEXTO ORIGINAL (contexto):
${vacancy.descriptionRaw.slice(0, 4000)}

MATCH: ${match ? `${match.score}/100` : '(sin análisis previo)'}
BRECHAS DETECTADAS:
${((match?.gaps as string[]) ?? []).join('\n') || '(sin análisis previo)'}
ÁNGULO SUGERIDO PARA LA POSTULACIÓN:
${strategy.angle ?? '(sin análisis previo)'}

${profileSnapshot}`;
  }

  /** Respaldo sin red: plan armado con lo que la oferta pide y las brechas del match. */
  private deterministicContent(
    vacancy: {
      title: string;
      company: string | null;
      enrichment: Prisma.JsonValue | null;
    },
    match: { gaps: Prisma.JsonValue } | null,
  ): PrepContent {
    const enr = (vacancy.enrichment ?? {}) as Record<string, unknown>;
    const requirements = ((enr.keyRequirements as string[]) ?? []).slice(0, 8);
    const niceToHave = ((enr.niceToHave as string[]) ?? []).slice(0, 4);
    const skills = ((enr.skills as string[]) ?? []).slice(0, 8);
    const gaps = ((match?.gaps as string[]) ?? []).slice(0, 6);

    const topics = unique([...requirements, ...skills, ...niceToHave, ...gaps]).slice(0, 8);
    const studyPlan = topics.map((topic) => ({
      topic,
      why: requirements.some((r) => r.toLowerCase().includes(topic.toLowerCase()))
        ? 'Requisito clave de la oferta.'
        : 'Aparece en la oferta y conviene poder hablar de ello con ejemplos.',
      resources: [`Repasar el concepto de ${topic} y cómo lo has usado en tus proyectos.`],
      practice: `Preparar un ejemplo real (situación, acción, resultado) donde hayas trabajado con ${topic}.`,
    }));

    return {
      summary: `Plan de preparación para ${vacancy.title}${
        vacancy.company ? ` en ${vacancy.company}` : ''
      }. Priorizá los requisitos de la oferta y las brechas de tu match.`,
      focusAreas: topics.slice(0, 6),
      studyPlan,
      likelyQuestions: [
        {
          question: `Contame sobre tu experiencia con ${topics[0] ?? 'las tecnologías de la vacante'}.`,
          category: 'técnica',
          answerOutline:
            'Usá STAR: situación, tarea, acción y resultado. Citá un proyecto real del perfil y la métrica del resultado.',
        },
        {
          question: `¿Cómo encararías las responsabilidades de ${vacancy.title}?`,
          category: 'del rol',
          answerOutline: 'Conectá los requisitos clave con logros concretos de tu experiencia.',
        },
        {
          question: '¿Cuál fue el proyecto más complejo que sacaste adelante?',
          category: 'conductual',
          answerOutline: 'Contá el reto, las decisiones técnicas y el impacto medible.',
        },
        {
          question: '¿Cómo manejás el trabajo en equipo y los desacuerdos técnicos?',
          category: 'conductual',
          answerOutline: 'Un ejemplo real de colaboración y cómo resolviste la diferencia.',
        },
        {
          question: '¿Por qué te interesa esta empresa y esta vacante?',
          category: 'de la empresa',
          answerOutline: 'Relacioná el producto/equipo con tus objetivos y lo que aportás.',
        },
        {
          question: '¿Qué harías en tus primeros 90 días?',
          category: 'del rol',
          answerOutline: 'Diagnóstico, aprendizaje del dominio y una entrega concreta temprana.',
        },
      ],
      trickyQuestions: [
        {
          question: '¿Cuál es tu mayor debilidad?',
          whyTricky: 'Busca autoconocimiento, no un disfraz de fortaleza ("soy perfeccionista").',
          howToAnswer: 'Nombrá una debilidad real, qué hiciste para mejorarla y el avance concreto.',
        },
        {
          question: '¿Por qué dejaste tu trabajo anterior?',
          whyTricky: 'Detecta conflictos o falta de compromiso; invita a hablar mal del empleador.',
          howToAnswer: 'Enfocate en el crecimiento y el proyecto nuevo, sin criticar a nadie.',
        },
        {
          question: '¿Cuáles son tus expectativas salariales?',
          whyTricky: 'Quiere anclarte a un número antes de que conozcas el rango o el paquete completo.',
          howToAnswer: 'Pedí el rango para el rol y respondé con un rango amplio y argumentado.',
        },
        {
          question: '¿Sos capaz de liderar aunque este rol sea individual?',
          whyTricky: 'Prueba si sobrevendés o si aterrizás tus respuestas.',
          howToAnswer: 'Respondé con honestidad según tu perfil y da un ejemplo real de mentoring o liderazgo.',
        },
      ],
      redFlags: [],
      questionsToAsk: [
        '¿Cómo se ve el éxito en este rol a los 6 meses?',
        '¿Cuál es el mayor desafío técnico del equipo hoy?',
        '¿Cómo es el proceso de revisión de código y despliegue?',
        '¿Qué oportunidades de crecimiento hay dentro del equipo?',
      ],
      checklist: [
        { item: 'Repasar tu HV y poder contar cada bullet con un ejemplo real.', done: false },
        { item: 'Investigar la empresa: producto, clientes y noticias recientes.', done: false },
        { item: 'Preparar 3 preguntas para el entrevistador.', done: false },
        { item: 'Tener a mano el rango salarial esperado y argumentarlo.', done: false },
        { item: 'Probar cámara, micrófono y conexión si la entrevista es remota.', done: false },
      ],
    };
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

export function mapPrep(prep: {
  id: string;
  profileId: string;
  version: number;
  status: string;
  source: string;
  content: Prisma.JsonValue;
}) {
  return {
    id: prep.id,
    profileId: prep.profileId,
    version: prep.version,
    status: prep.status,
    source: prep.source,
    content: prep.content,
  };
}

/**
 * Al regenerar se conserva el avance del usuario: re-aplica el `done` de los
 * temas y del checklist que coincidan por texto.
 */
export function withPreservedProgress(
  content: PrepContent,
  previous: Prisma.JsonValue | null | undefined,
): PrepContent {
  if (!previous || typeof previous !== 'object' || Array.isArray(previous)) return content;
  const prev = previous as Record<string, unknown>;

  const doneByTopic = new Map<string, boolean>();
  for (const raw of Array.isArray(prev.studyPlan) ? prev.studyPlan : []) {
    const item = raw as { topic?: unknown; done?: unknown };
    if (typeof item.topic === 'string' && item.done === true) doneByTopic.set(item.topic, true);
  }
  const doneByItem = new Map<string, boolean>();
  for (const raw of Array.isArray(prev.checklist) ? prev.checklist : []) {
    const item = raw as { item?: unknown; done?: unknown };
    if (typeof item.item === 'string' && item.done === true) doneByItem.set(item.item, true);
  }

  return {
    ...content,
    studyPlan: content.studyPlan.map((topic) =>
      doneByTopic.get(topic.topic) ? { ...topic, done: true } : topic,
    ),
    checklist: content.checklist.map((entry) =>
      doneByItem.get(entry.item) ? { ...entry, done: true } : entry,
    ),
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))];
}
