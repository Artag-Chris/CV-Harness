import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { JsonLogger } from '../../common/json-logger.service';
import { PrismaService } from '../../common/prisma.service';
import { LLM_PROVIDER } from '../../config/tokens';
import { LlmProvider } from '../llm/llm-provider.port';
import { buildProfileSnapshot } from '../profiles/profile-snapshot';
import { analyzeAts, type AtsContent } from './analyzer';
import { toResumePayload } from './payload';
import type { AtsAnalysis } from './types';

const KEYWORD_PROMPT = `Eres un redactor de hojas de vida experto en filtros ATS. Recibes una hoja de vida en JSON y una lista de PALABRAS CLAVE de la vacante que hoy NO aparecen en el texto. Devuelves la MISMA hoja con el resumen y las viñetas reescritas para incluir esas palabras clave.

Devuelve ÚNICAMENTE JSON con la misma forma que la hoja recibida:
{
  "headline": "...", "summary": "...", "skills": [...], "experience": [{"role","company","period","bullets":[...]}],
  "projects": [{"name","highlights":[...]}], "education": [{"institution","degree","period"}],
  "softSkills": [...], "keywords": [...]
}

Reglas estrictas:
- SOLO podés integrar una palabra clave si está RESPALDADA por el perfil canónico que se te da. Si el candidato no la tiene, NO la menciones: es preferible dejarla afuera antes que mentir.
- PROHIBIDO inventar empresas, cargos, fechas, tecnologías, certificaciones o métricas.
- No elimines experiencia, formación ni logros existentes; no cambies los hechos ni los períodos.
- Mantené el idioma original del contenido, la misma cantidad de experiencias/proyectos y el mismo orden.
- Nada de listas de keywords sueltas: las palabras deben leerse naturalmente dentro de las frases.
- Conservá las viñetas que ya existían, aunque las reformules.`;

export interface KeywordFixResult {
  content: AtsContent & Record<string, unknown>;
  /** true si la IA propuso cambios; false si no se pudo (sin proveedor, etc.). */
  applied: boolean;
  /** Keywords que quedaron realmente integradas. */
  integrated: string[];
  note: string;
}

@Injectable()
export class AtsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly logger: JsonLogger,
  ) {}

  /**
   * Analiza el borrador. Si llega `content` se analiza ESO (las ediciones sin
   * guardar), que es lo que el usuario está viendo en la vista previa.
   */
  async analyze(draftId: string, override?: AtsContent): Promise<AtsAnalysis> {
    const draft = await this.loadDraft(draftId);
    const content = (override ?? draft.content ?? {}) as AtsContent;

    return analyzeAts({
      content,
      profile: draft.profile,
      vacancy: {
        title: draft.vacancy.title,
        descriptionRaw: draft.vacancy.descriptionRaw,
        enrichment: readEnrichment(draft.vacancy.enrichment),
        strategyKeywords: readStrategyKeywords(draft.match?.applicationStrategy),
      },
    });
  }

  /**
   * Propone integrar con IA las keywords faltantes. NO guarda: devuelve el
   * contenido para que se revise en la vista previa y se guarde a mano.
   */
  async proposeKeywordFix(draftId: string, override?: AtsContent): Promise<KeywordFixResult> {
    const draft = await this.loadDraft(draftId);
    const current = (override ?? draft.content ?? {}) as AtsContent;

    const analysis = await this.analyze(draftId, override);
    const missing = analysis.missingKeywords;
    if (missing.length === 0) {
      return {
        content: current as KeywordFixResult['content'],
        applied: false,
        integrated: [],
        note: 'No falta ninguna palabra clave: la cobertura ya está completa.',
      };
    }

    const profileSnapshot = await buildProfileSnapshot(this.prisma, draft.profileId);
    const ai = await this.llm.json(
      KEYWORD_PROMPT,
      `PALABRAS CLAVE FALTANTES:\n${missing.join(', ')}\n\nHOJA DE VIDA ACTUAL (JSON):\n${JSON.stringify(
        toResumePayload(current),
        null,
        2,
      )}\n\nHECHOS VERIFICADOS DEL PERFIL (única fuente de verdad):\n${profileSnapshot}`,
    );

    if (!ai) {
      return {
        content: current as KeywordFixResult['content'],
        applied: false,
        integrated: [],
        note: 'El proveedor de IA no está configurado: no se pudieron acomodar las palabras clave.',
      };
    }

    // Se conservan los datos que no son de redacción (carta, modo ATS, markdown).
    const proposed = { ...(current as Record<string, unknown>), ...(ai as object) };
    const after = analyzeAts({
      content: proposed as AtsContent,
      profile: draft.profile,
      vacancy: {
        title: draft.vacancy.title,
        descriptionRaw: draft.vacancy.descriptionRaw,
        enrichment: readEnrichment(draft.vacancy.enrichment),
        strategyKeywords: readStrategyKeywords(draft.match?.applicationStrategy),
      },
    });

    const stillMissing = new Set(after.missingKeywords.map((k) => k.toLowerCase()));
    const integrated = missing.filter((k) => !stillMissing.has(k.toLowerCase()));

    this.logger.log(
      {
        msg: 'propuesta de acomodo de keywords',
        draftId,
        requested: missing.length,
        integrated: integrated.length,
        provider: this.llm.name,
      },
      AtsService.name,
    );

    return {
      content: proposed as KeywordFixResult['content'],
      applied: true,
      integrated,
      note:
        integrated.length === 0
          ? 'La IA no pudo integrar ninguna palabra clave sin inventar: revisá tu perfil.'
          : `Integradas ${integrated.length} de ${missing.length}. Revisá la vista previa y guardá si te convence.`,
    };
  }

  private async loadDraft(draftId: string) {
    const draft = await this.prisma.resumeDraft.findUnique({
      where: { id: draftId },
      include: {
        profile: { include: { links: true } },
        vacancy: true,
      },
    });
    if (!draft) throw new NotFoundException(`Borrador ${draftId} no existe`);

    const match = await this.prisma.matchResult.findUnique({
      where: {
        vacancyId_profileId: { vacancyId: draft.vacancyId, profileId: draft.profileId },
      },
      select: { applicationStrategy: true },
    });

    const languages = Array.isArray(draft.profile.languages)
      ? (draft.profile.languages as { language: string; level: string }[])
      : [];

    return {
      ...draft,
      match,
      profile: {
        name: draft.profile.name,
        email: draft.profile.email,
        phone: draft.profile.phone,
        location: draft.profile.location,
        links: draft.profile.links.map((link) => ({ type: link.type, url: link.url })),
        languages,
      },
    };
  }
}

function readEnrichment(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const enr = value as Record<string, unknown>;
  return {
    keyRequirements: asStringArray(enr.keyRequirements),
    niceToHave: asStringArray(enr.niceToHave),
    skills: asStringArray(enr.skills),
  };
}

function readStrategyKeywords(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  return asStringArray((value as Record<string, unknown>).keywords);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}
