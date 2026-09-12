import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JsonLogger } from '../../common/json-logger.service';
import { PrismaService } from '../../common/prisma.service';
import {
  languageInstruction,
  resolveApplyLanguage,
} from '../../common/apply-language';
import { LLM_PROVIDER } from '../../config/tokens';
import { LlmProvider } from '../llm/llm-provider.port';
import { buildProfileSnapshot } from '../profiles/profile-snapshot';

const SYSTEM_PROMPT = `Eres un redactor experto de cartas de presentación para procesos de selección técnicos. Escribes en primera persona, sobrio y concreto, sin clichés ni adjetivos vacíos.

Devuelve ÚNICAMENTE JSON con esta forma exacta:
{ "coverLetter": "texto completo de la carta" }

Reglas:
- Dirigida a la empresa de la vacante; si no hay empresa, a "el equipo de selección".
- Estructura: saludo, 3 o 4 párrafos, cierre con disponibilidad, y despedida con el nombre del candidato.
- Usa EXCLUSIVAMENTE hechos del perfil: experiencia, proyectos, skills, idiomas. Prohibido inventar empresas, títulos, métricas o certificaciones.
- Menciona el rol y 1-2 requisitos concretos de la vacante y conéctalos con logros reales del perfil.
- Separa los párrafos con una línea vacía. No uses markdown, viñetas, negritas ni títulos.
- Extensión: 250-350 palabras.`;

/** Datos que quedan guardados junto a la carta (para mostrarla/editar sin re-generar). */
interface StoredCoverLetter {
  coverLetter: string;
  coverLetterSource: 'ia' | 'plantilla' | 'editada';
  coverLetterUpdatedAt: string;
}

@Injectable()
export class CoverLetterService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly logger: JsonLogger,
  ) {}

  /**
   * Genera (o regenera) la carta de presentación de un borrador de HV.
   * Si no hay proveedor LLM configurado, arma una carta determinística.
   */
  async generate(draftId: string) {
    const draft = await this.prisma.resumeDraft.findUnique({
      where: { id: draftId },
      include: {
        profile: true,
        vacancy: { include: { source: true } },
      },
    });
    if (!draft) throw new NotFoundException(`Borrador ${draftId} no existe`);

    const [match, profileSnapshot] = await Promise.all([
      this.prisma.matchResult.findUnique({
        where: {
          vacancyId_profileId: { vacancyId: draft.vacancyId, profileId: draft.profileId },
        },
      }),
      buildProfileSnapshot(this.prisma, draft.profileId),
    ]);

    // El idioma de la carta sigue el del borrador/perfil (auto = idioma de la vacante).
    const language = resolveApplyLanguage(
      (draft.content as Record<string, unknown> | null)?.language,
      draft.profile.applyLanguage,
    );
    const ai = await this.llm.json(
      `${SYSTEM_PROMPT}\n\nIdioma de salida: ${languageInstruction(language)}`,
      this.buildUserPrompt(draft.vacancy, match, profileSnapshot),
    );
    const aiLetter =
      ai && typeof ai.coverLetter === 'string' && ai.coverLetter.trim().length > 0
        ? normalizeParagraphs(ai.coverLetter)
        : null;
    // La fuente se decide por el texto que realmente se usa, no por si el LLM
    // respondió: una respuesta vacía cae al respaldo y NO es "ia".
    const generated =
      aiLetter ?? this.deterministicLetter(draft.vacancy, draft.profile.name, profileSnapshot);
    const source: StoredCoverLetter['coverLetterSource'] = aiLetter ? 'ia' : 'plantilla';

    const saved = await this.save(draftId, draft.content, generated, source);
    this.logger.log(
      { msg: 'carta de presentación generada', draftId, profileId: draft.profileId, source },
      CoverLetterService.name,
    );
    return saved;
  }

  /** Guarda una carta editada a mano desde el dashboard. */
  async saveEdited(draftId: string, coverLetter: string) {
    const draft = await this.prisma.resumeDraft.findUnique({ where: { id: draftId } });
    if (!draft) throw new NotFoundException(`Borrador ${draftId} no existe`);
    const clean = coverLetter.trim();
    if (clean.length === 0) {
      throw new BadRequestException('La carta no puede quedar vacía');
    }
    return this.save(draftId, draft.content, normalizeParagraphs(clean), 'editada');
  }

  /**
   * Fusiona la carta dentro del `content` del borrador. Se guarda en el mismo
   * JSON en vez de añadir columna: no requiere migración y viaja con el
   * borrador (que ya es por vacante + perfil).
   */
  private async save(
    draftId: string,
    currentContent: Prisma.JsonValue,
    coverLetter: string,
    source: StoredCoverLetter['coverLetterSource'],
  ) {
    const base =
      currentContent && typeof currentContent === 'object' && !Array.isArray(currentContent)
        ? (currentContent as Record<string, unknown>)
        : {};
    const content: Record<string, unknown> = {
      ...base,
      coverLetter,
      coverLetterSource: source,
      coverLetterUpdatedAt: new Date().toISOString(),
    };
    const updated = await this.prisma.resumeDraft.update({
      where: { id: draftId },
      data: { content: content as Prisma.InputJsonValue },
    });
    return { id: updated.id, ...(content as unknown as StoredCoverLetter) };
  }

  private buildUserPrompt(
    vacancy: {
      title: string;
      company: string | null;
      location: string | null;
      descriptionRaw: string;
      enrichment: Prisma.JsonValue | null;
    },
    match: { score: number; applicationStrategy: Prisma.JsonValue } | null,
    profileSnapshot: string,
  ): string {
    const enr = (vacancy.enrichment ?? {}) as Record<string, unknown>;
    const strategy = (match?.applicationStrategy ?? {}) as {
      angle?: string;
      keywords?: string[];
      highlights?: string[];
    };
    const structured = {
      titulo: vacancy.title,
      empresa: vacancy.company,
      ubicacion: vacancy.location,
      modalidad: enr.modality ?? null,
      seniority: enr.seniority ?? null,
      requisitos: enr.keyRequirements ?? [],
      deseables: enr.niceToHave ?? [],
      skills: enr.skills ?? [],
    };
    return `VACANTE:\n${JSON.stringify(structured, null, 2)}

TEXTO ORIGINAL (contexto):
${vacancy.descriptionRaw.slice(0, 4000)}

ÁNGULO SUGERIDO PARA ESTA POSTULACIÓN:
${strategy.angle ?? '(sin análisis previo)'}

PUNTOS A DESTACAR:
${(strategy.highlights ?? []).join('\n') || '(sin análisis previo)'}

${profileSnapshot}`;
  }

  /** Respaldo sin red: carta armada con los hechos del perfil y la vacante. */
  private deterministicLetter(
    vacancy: { title: string; company: string | null; location: string | null },
    candidateName: string,
    profileSnapshot: string,
  ): string {
    const recipient = vacancy.company ? `equipo de ${vacancy.company}` : 'equipo de selección';
    // Los bullets de experiencia del snapshot sirven como logros reales.
    const achievements = profileSnapshot
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('•'))
      .map((l) => l.replace(/^•\s*/, ''))
      .slice(0, 3);

    const paragraphs = [
      `Reciban un cordial saludo. Me dirijo a ustedes para postularme al cargo de ${vacancy.title}${
        vacancy.company ? ` en ${vacancy.company}` : ''
      }.`,
      `Soy ${candidateName} y mi experiencia combina desarrollo backend de sistemas distribuidos con aplicaciones de inteligencia artificial en producción. Considero que mi perfil encaja con lo que la vacante requiere${
        vacancy.location ? ` para una posición en ${vacancy.location}` : ''
      }.`,
      achievements.length > 0
        ? `Entre los aportes que puedo llevar al equipo destaco lo siguiente: ${achievements
            .map((a) => a.replace(/\.$/, ''))
            .join('; ')}.`
        : 'Puedo aportar experiencia comprobable en arquitectura backend, integraciones con APIs de terceros y despliegue de servicios en producción.',
      'Quedo a disposición para ampliar cualquier punto de mi hoja de vida en una entrevista y agradezco de antemano el tiempo dedicado a revisar mi postulación.',
      `Cordialmente,\n${candidateName}`,
    ];
    return paragraphs.join('\n\n');
  }
}

/**
 * Normaliza el espaciado del texto generado: colapsa saltos triples, quita
 * espacios al final de línea y asegura un solo salto entre párrafos.
 */
export function normalizeParagraphs(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
