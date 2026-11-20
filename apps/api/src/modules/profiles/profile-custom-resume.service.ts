import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type ApplyLanguage,
  languageInstruction,
  normalizeApplyLanguage,
} from '../../common/apply-language';
import { PrismaService } from '../../common/prisma.service';
import { LLM_PROVIDER } from '../../config/tokens';
import { LlmProvider } from '../llm/llm-provider.port';
import {
  type ResumeContent,
  ResumeContentSchema,
} from '../pipeline/pipeline.types';
import { renderResumeMarkdown } from '../resume/resume-markdown';
import { buildProfileSnapshot } from './profile-snapshot';

export interface CustomResumeInput {
  /** Rol o título objetivo (ej. "Full Stack Engineer", "AI Engineer", "Ciberseguridad"). */
  title?: string;
  /** Instrucciones libres: enfoque, cualidades, stack o proyectos a resaltar. */
  prompt?: string;
  /** Idioma deseado: 'auto' | 'es' | 'en'. */
  language?: string;
  /** Si true, marca atsMode=true en el contenido devuelto. */
  atsMode?: boolean;
  /** Opcional: borrador actual si el usuario quiere refinarlo con una nueva instrucción. */
  currentContent?: Record<string, unknown>;
}

export interface CustomResumeResult {
  profileId: string;
  source: 'ia' | 'plantilla';
  content: ResumeContent & {
    markdown: string;
    language: ApplyLanguage;
    atsMode?: boolean;
  };
  note?: string;
}

const MIN_PROMPT_LENGTH = 5;
const MAX_PROMPT_LENGTH = 4000;

const GENERATE_SYSTEM_PROMPT = `Eres un redactor profesional de hojas de vida (ATS-friendly). A partir del perfil verificado de un candidato y las instrucciones del propio candidato (rol objetivo, enfoque, cualidades o stack a destacar), armas una hoja de vida a medida SIN inventar experiencia, logros, tecnologías, empresas ni métricas.

Devuelve ÚNICAMENTE JSON con esta forma exacta:
{
  "headline": "título profesional de una línea alineado al rol pedido",
  "summary": "resumen de 3-4 líneas enfocado en el rol y cualidades pedidas, usando solo hechos del perfil",
  "skills": ["skill", ...] (20 máximo, ordenadas por relevancia para el enfoque pedido),
  "experience": [{"role": "...", "company": "...", "period": "2024 – Presente", "bullets": ["...", ...]}],
  "projects": [{"name": "...", "highlights": ["...", ...]}],
  "education": [{"institution": "...", "degree": "...", "period": "2023 – Presente"}],
  "softSkills": ["...", ...máx 5],
  "keywords": ["palabra clave", ... máx 8]
}

Reglas estrictas:
- Si el usuario indica un título o rol objetivo, úsalo como base para "headline".
- Reordena y reescribe los bullets de experiencia y proyectos para destacar lo más relevante al enfoque pedido (ej. Full Stack, Backend, AI Engineer, Ciberseguridad), conservando exactamente los hechos verificados del perfil.
- Prohibido inventar empresas, cargos, certificaciones, tecnologías o métricas que no estén en el perfil.`;

const REFINE_SYSTEM_PROMPT = `Eres un editor profesional de hojas de vida. Recibes el borrador JSON actual de una HV, una instrucción del usuario y los hechos verificados del perfil. Debes ajustar el borrador siguiendo la instrucción SIN inventar hechos nuevos.

Devuelve ÚNICAMENTE JSON con la misma estructura exacta:
{
  "headline": "...",
  "summary": "...",
  "skills": [...],
  "experience": [{"role": "...", "company": "...", "period": "...", "bullets": [...]}],
  "projects": [{"name": "...", "highlights": [...]}],
  "education": [{"institution": "...", "degree": "...", "period": "..."}],
  "softSkills": [...],
  "keywords": [...]
}

No inventes experiencia, empresas, títulos ni métricas que no estén en los hechos del perfil.`;

/**
 * Genera (o refina) una hoja de vida personalizada a partir de un prompt libre
 * del usuario, usando los hechos verificados de su perfil canónico.
 * No crea vacantes falsas ni requiere migración de BD.
 */
@Injectable()
export class ProfileCustomResumeService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  async generate(
    profileId: string,
    input: CustomResumeInput,
  ): Promise<CustomResumeResult> {
    const prompt = (input.prompt ?? '').trim();
    if (prompt.length < MIN_PROMPT_LENGTH) {
      throw new BadRequestException(
        `Describí el enfoque o cualidades de la HV (mínimo ${MIN_PROMPT_LENGTH} caracteres)`,
      );
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      throw new BadRequestException(
        `El prompt supera el máximo permitido (${MAX_PROMPT_LENGTH} caracteres)`,
      );
    }

    const title = (input.title ?? '').trim().slice(0, 160);
    const profile = await this.prisma.profile.findUnique({
      where: { id: profileId },
    });
    if (!profile) {
      throw new NotFoundException(`Profile ${profileId} no existe`);
    }

    const requestedLanguage: ApplyLanguage =
      normalizeApplyLanguage(input.language) ??
      normalizeApplyLanguage(profile.applyLanguage) ??
      'auto';
    const atsMode = Boolean(input.atsMode);

    const profileSnapshot = await buildProfileSnapshot(this.prisma, profileId);

    let systemPrompt: string;
    let userPrompt: string;
    if (input.currentContent && typeof input.currentContent === 'object') {
      const parsedCurrent = ResumeContentSchema.safeParse(input.currentContent);
      const currentForPrompt = parsedCurrent.success
        ? parsedCurrent.data
        : input.currentContent;
      systemPrompt = `${REFINE_SYSTEM_PROMPT}\n\nIdioma de salida: ${languageInstruction(requestedLanguage)}`;
      userPrompt = [
        title ? `TÍTULO OBJETIVO: ${title}` : null,
        `INSTRUCCIÓN DEL USUARIO:\n${prompt}`,
        `BORRADOR ACTUAL (JSON):\n${JSON.stringify(currentForPrompt, null, 2)}`,
        `HECHOS VERIFICADOS DEL PERFIL:\n${profileSnapshot}`,
      ]
        .filter(Boolean)
        .join('\n\n');
    } else {
      systemPrompt = `${GENERATE_SYSTEM_PROMPT}\n\nIdioma de salida: ${languageInstruction(requestedLanguage)}`;
      userPrompt = [
        title ? `TÍTULO / ROL OBJETIVO: ${title}` : null,
        `INSTRUCCIONES Y ENFOQUE PEDIDO POR EL USUARIO:\n${prompt}`,
        `PERFIL VERIFICADO DEL CANDIDATO:\n${profileSnapshot}`,
      ]
        .filter(Boolean)
        .join('\n\n');
    }

    const ai = await this.llm.json(systemPrompt, userPrompt, {
      stage: 'custom-resume',
    });

    if (ai) {
      const content = ResumeContentSchema.parse(ai);
      const markdown = renderResumeMarkdown(content, profile.name);
      return {
        profileId,
        source: 'ia',
        content: {
          ...content,
          markdown,
          language: requestedLanguage,
          ...(atsMode ? { atsMode: true } : {}),
        },
      };
    }

    const fallback = await this.deterministicContent(profileId, title);
    const markdown = renderResumeMarkdown(fallback, profile.name);
    return {
      profileId,
      source: 'plantilla',
      content: {
        ...fallback,
        markdown,
        language: 'auto',
        ...(atsMode ? { atsMode: true } : {}),
      },
      note: 'Sin proveedor de IA disponible (o tope diario alcanzado): se armó una base determinística con los datos del perfil.',
    };
  }

  private async deterministicContent(
    profileId: string,
    title: string,
  ): Promise<ResumeContent> {
    const profile = await this.prisma.profile.findUniqueOrThrow({
      where: { id: profileId },
      include: {
        experiences: { orderBy: { sortOrder: 'asc' } },
        education: { orderBy: { sortOrder: 'asc' } },
        projects: true,
        skills: { include: { skill: true }, orderBy: { rating: 'desc' } },
      },
    });

    const skills = profile.skills.slice(0, 20).map((s) => s.skill.name);
    const softSkills = Array.isArray(profile.softSkills)
      ? (profile.softSkills as string[]).slice(0, 5)
      : [];

    return {
      headline: title || profile.headline.join(' · ') || profile.name,
      summary: profile.summary,
      skills,
      experience: profile.experiences.map((e) => ({
        role: e.role,
        company: e.company,
        period: `${e.periodStart} – ${e.periodEnd ?? 'Presente'}`,
        bullets: Array.isArray(e.bullets) ? (e.bullets as string[]) : [],
      })),
      projects: profile.projects.map((p) => ({
        name: p.name,
        highlights: Array.isArray(p.highlights)
          ? (p.highlights as string[])
          : [p.summary],
      })),
      education: profile.education.map((ed) => ({
        institution: ed.institution,
        degree: ed.degree,
        period: `${ed.periodStart} – ${ed.periodEnd ?? 'Presente'}`,
      })),
      softSkills,
      keywords: skills.slice(0, 8),
    };
  }
}
