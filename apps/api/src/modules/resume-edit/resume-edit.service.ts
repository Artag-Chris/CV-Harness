import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, VacancyProfileStatus } from '@prisma/client';
import { JsonLogger } from '../../common/json-logger.service';
import { PrismaService } from '../../common/prisma.service';
import { LLM_PROVIDER } from '../../config/tokens';
import { LlmProvider } from '../llm/llm-provider.port';
import { ResumeContent, ResumeContentSchema } from '../pipeline/pipeline.types';
import { normalizeParagraphs } from '../cover-letter/cover-letter.service';
import { buildProfileSnapshot } from '../profiles/profile-snapshot';
import { renderResumeMarkdown } from '../resume/resume-markdown';

/**
 * El LLM devuelve la HV reescrita. Se pide la MISMA forma que `ResumeContent`
 * para poder validarla con el schema del pipeline y renderizar el markdown.
 */
const SYSTEM_PROMPT = `Eres un editor experto de hojas de vida (ATS-friendly). Recibes una hoja de vida ya redactada en JSON y una instrucción del candidato, y devuelves la MISMA hoja reorganizada o reescrita según esa instrucción.

Devuelve ÚNICAMENTE JSON con esta forma exacta:
{
  "headline": "título de una línea",
  "summary": "resumen de 3-4 líneas",
  "skills": ["skill", ...] (máximo 22, ordenadas por relevancia),
  "experience": [{"role": "...", "company": "...", "period": "2024 - Presente", "bullets": ["...", ...]}],
  "projects": [{"name": "...", "highlights": ["...", ...]}],
  "education": [{"institution": "...", "degree": "...", "period": "..."}],
  "softSkills": ["...", ...máx 5],
  "keywords": ["palabra clave", ...máx 8]
}

Reglas estrictas:
- Puedes reordenar secciones y elementos, acortar, fusionar o reescribir frases, y cambiar el énfasis.
- PROHIBIDO inventar empresas, cargos, fechas, tecnologías, certificaciones o métricas que no estén en la hoja original o en el perfil.
- No elimines experiencia laboral ni formación, salvo que la instrucción lo pida explícitamente.
- Conserva el idioma original del contenido.
- Si la instrucción es vaga, mejora la claridad y el orden sin cambiar los hechos.`;

export interface RefineResult {
  id: string;
  content: ResumeContent & { markdown?: string; coverLetter?: string };
  /** true si hubo reescritura por IA; false si se devolvió el contenido tal cual. */
  applied: boolean;
  note: string;
}

/** Idiomas a los que se puede traducir (auto no aplica: no es un idioma). */
export type TargetLanguage = 'es' | 'en';

export interface TranslateResult {
  content: ResumeContent & { markdown?: string; coverLetter?: string; language?: string };
  applied: boolean;
  language: TargetLanguage;
  note: string;
}

const TRANSLATE_PROMPT = `Eres un traductor experto de hojas de vida. Recibes una HV en JSON y un IDIOMA DESTINO. Devuelves la MISMA HV traducida, conservando exactamente los hechos.

Devuelve ÚNICAMENTE JSON con la misma forma que la HV recibida:
{
  "headline": "...", "summary": "...", "skills": [...],
  "experience": [{"role":"...","company":"...","period":"...","bullets":["..."]}],
  "projects": [{"name":"...","highlights":["..."]}],
  "education": [{"institution":"...","degree":"...","period":"..."}],
  "softSkills": [...], "keywords": [...],
  "coverLetter": "solo si venía en la HV"
}

Reglas estrictas:
- Traducí TODO el texto al idioma destino.
- NO cambies hechos: empresas, cargos, fechas y métricas se conservan. Los nombres propios y de tecnologías (Node.js, PostgreSQL, NestJS, AWS…) NO se traducen.
- Mantené la MISMA cantidad y el MISMO orden de experiencias, proyectos, educación y viñetas.
- Si la HV traía "coverLetter", traducila y devolvé también "coverLetter".
- No agregues markdown ni texto fuera del JSON.`;

@Injectable()
export class ResumeEditService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly logger: JsonLogger,
  ) {}

  /**
   * Organizar/reescribir el borrador con IA según una instrucción libre
   * ("hazlo más corto", "reordena por impacto", "enfócalo a IA"…).
   *
   * El resultado se guarda en el borrador (misma versión incrementada) y se
   * preserva la carta de presentación, que vive en el mismo JSON.
   */
  async refine(draftId: string, instruction: string): Promise<RefineResult> {
    const draft = await this.prisma.resumeDraft.findUnique({
      where: { id: draftId },
      include: { profile: true, vacancy: { include: { source: true } } },
    });
    if (!draft) throw new NotFoundException(`Borrador ${draftId} no existe`);

    const previous = (draft.content ?? {}) as Record<string, unknown>;
    const current = ResumeContentSchema.parse(previous);
    const cleanInstruction = instruction.trim();

    const [profileSnapshot, match] = await Promise.all([
      buildProfileSnapshot(this.prisma, draft.profileId),
      this.prisma.matchResult.findUnique({
        where: {
          vacancyId_profileId: { vacancyId: draft.vacancyId, profileId: draft.profileId },
        },
      }),
    ]);

    const ai = cleanInstruction
      ? await this.llm.json(
          SYSTEM_PROMPT,
          this.buildPrompt(draft.vacancy, current, profileSnapshot, cleanInstruction),
        )
      : null;

    // Sin proveedor LLM (o sin instrucción) se devuelve lo mismo, sin tocar la BD.
    if (!ai) {
      return {
        id: draft.id,
        content: { ...current, ...pickCoverLetter(previous) },
        applied: false,
        note: cleanInstruction
          ? 'El proveedor de IA no está configurado: no se pudo reorganizar.'
          : 'Escribí qué querés que organice la IA.',
      };
    }

    const parsed = ResumeContentSchema.parse(ai);
    const markdown = renderResumeMarkdown(parsed, draft.profile?.name ?? 'CV');
    const content: Record<string, unknown> = {
      ...parsed,
      markdown,
      ...pickCoverLetter(previous),
      // Preferencias del borrador que no son texto redactado y que la IA no
      // devuelve: sin rescatarlas, reorganizar apagaba el Modo ATS y perdía el
      // idioma elegido para esa HV.
      ...(previous.atsMode ? { atsMode: true } : {}),
      ...(typeof previous.language === 'string' ? { language: previous.language } : {}),
    };

    const updated = await this.prisma.resumeDraft.update({
      where: { id: draftId },
      data: {
        content: content as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    });

    // Deja el estado del perfil consistente si todavía no tenía HV lista.
    await this.prisma.vacancyProfile.upsert({
      where: { vacancyId_profileId: { vacancyId: draft.vacancyId, profileId: draft.profileId } },
      update: { status: VacancyProfileStatus.RESUME_READY },
      create: {
        vacancyId: draft.vacancyId,
        profileId: draft.profileId,
        status: VacancyProfileStatus.RESUME_READY,
      },
    });

    this.logger.log(
      {
        msg: 'borrador reorganizado con IA',
        draftId,
        profileId: draft.profileId,
        instruction: cleanInstruction,
        provider: this.llm.name,
        score: match?.score ?? null,
      },
      ResumeEditService.name,
    );

    return {
      id: updated.id,
      content: content as RefineResult['content'],
      applied: true,
      note: 'Borrador reorganizado. Revisá la vista previa y ajustá lo que quieras.',
    };
  }

  /**
   * Traduce el borrador a `target` CONSERVANDO las ediciones: no re-redacta
   * desde el perfil, solo cambia el idioma del contenido que el usuario ya
   * revisó (y de la carta, si la tenía). Guarda en el mismo borrador.
   */
  async translate(draftId: string, target: TargetLanguage): Promise<TranslateResult> {
    const draft = await this.prisma.resumeDraft.findUnique({
      where: { id: draftId },
      include: { profile: true },
    });
    if (!draft) throw new NotFoundException(`Borrador ${draftId} no existe`);

    const previous = (draft.content ?? {}) as Record<string, unknown>;
    const current = ResumeContentSchema.parse(previous);
    const currentLetter =
      typeof previous.coverLetter === 'string' ? previous.coverLetter : undefined;

    const ai = await this.llm.json(
      TRANSLATE_PROMPT,
      `IDIOMA DESTINO: ${target === 'en' ? 'inglés' : 'español'}\n\nHOJA DE VIDA (JSON):\n${JSON.stringify(
        { ...current, ...(currentLetter ? { coverLetter: currentLetter } : {}) },
        null,
        2,
      )}`,
    );

    if (!ai) {
      return {
        content: { ...current, ...(currentLetter ? { coverLetter: currentLetter } : {}) },
        applied: false,
        language: target,
        note: 'El proveedor de IA no está configurado: no se pudo traducir la HV.',
      };
    }

    const parsed = ResumeContentSchema.parse(ai);
    const markdown = renderResumeMarkdown(parsed, draft.profile?.name ?? 'CV');
    const translatedLetter =
      typeof ai.coverLetter === 'string' && ai.coverLetter.trim().length > 0
        ? normalizeParagraphs(ai.coverLetter)
        : currentLetter;
    const content: Record<string, unknown> = {
      ...parsed,
      markdown,
      language: target,
      // El modo ATS es una preferencia del borrador, no del texto: se conserva.
      ...(previous.atsMode ? { atsMode: true } : {}),
      ...(translatedLetter
        ? {
            coverLetter: translatedLetter,
            coverLetterSource: 'ia',
            coverLetterUpdatedAt: new Date().toISOString(),
          }
        : {}),
    };

    await this.prisma.resumeDraft.update({
      where: { id: draftId },
      data: { content: content as Prisma.InputJsonValue, version: { increment: 1 } },
    });

    this.logger.log(
      { msg: 'borrador traducido (ediciones conservadas)', draftId, target, provider: this.llm.name },
      ResumeEditService.name,
    );

    return {
      content: content as TranslateResult['content'],
      applied: true,
      language: target,
      note: `HV traducida a ${target === 'en' ? 'inglés' : 'español'}. Revisá la vista previa.`,
    };
  }

  private buildPrompt(
    vacancy: { title: string; company: string | null },
    current: ResumeContent,
    profileSnapshot: string,
    instruction: string,
  ): string {
    return `INSTRUCCIÓN DEL CANDIDATO:
${instruction}

VACANTE A LA QUE APUNTA:
${vacancy.title}${vacancy.company ? ` — ${vacancy.company}` : ''}

HOJA DE VIDA ACTUAL (JSON):
${JSON.stringify(current, null, 2)}

HECHOS VERIFICADOS DEL PERFIL (no inventar nada fuera de esto):
${profileSnapshot}`;
  }
}

/** La carta vive en el mismo JSON del borrador y hay que conservarla. */
function pickCoverLetter(previous: Record<string, unknown>): Record<string, unknown> {
  if (typeof previous.coverLetter !== 'string') return {};
  return {
    coverLetter: previous.coverLetter,
    coverLetterSource: previous.coverLetterSource,
    coverLetterUpdatedAt: previous.coverLetterUpdatedAt,
  };
}
