import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { JsonLogger } from '../../common/json-logger.service';
import { PrismaService } from '../../common/prisma.service';
import { LLM_PROVIDER } from '../../config/tokens';
import { LlmProvider } from '../llm/llm-provider.port';

/** Texto mínimo: por debajo de esto no es una HV, es un titular suelto. */
const MIN_LENGTH = 200;

const SYSTEM_PROMPT = `Eres un parser experto de hojas de vida. Recibes el texto de una HV (markdown o texto) y devuelves ÚNICAMENTE JSON con los datos ESTRUCTURADOS del perfil, con esta forma exacta:
{
  "name": "nombre completo",
  "headline": ["titular 1", "titular 2"],
  "summary": "resumen profesional, tal como aparece en el texto",
  "email": "email o null",
  "phone": "teléfono o null",
  "location": "ciudad, país o null",
  "languages": [{"language": "Español", "level": "Nativo"}],
  "softSkills": ["soft skill", ...],
  "links": [{"type": "github|website|linkedin", "url": "https://..."}],
  "experiences": [{"role": "...", "company": "...", "periodStart": "2024", "periodEnd": "Ago 2026 o null", "isCurrent": false, "bullets": ["...", ...]}],
  "education": [{"institution": "...", "degree": "...", "periodStart": "2023", "periodEnd": "2025 o null"}],
  "projects": [{"name": "...", "summary": "...", "stack": ["..."], "repositoryUrl": "https://... o null", "websiteUrl": "https://... o null", "visibility": "public|proprietary|private", "highlights": ["...", ...]}],
  "skills": [{"category": "IA & LLMs|Backend|Frontend|Databases|Infra & Cloud|Integrations|Mobile|Dev Tools|Methodologies", "name": "...", "rating": 3, "knowledge": "..."}]
}

Reglas ESTRICTAS:
- Extrae SOLO hechos presentes en el texto. PROHIBIDO inventar empresas, cargos, fechas, tecnologías, métricas o certificaciones.
- Los bullets se copian o condensan del texto, sin agregar logros nuevos.
- Si una sección no aparece en el texto, devuélvela vacía ([]). NO la rellenes.
- periodStart/periodEnd son strings libres ("2024", "Ago 2026", "Presente"); si el cargo es el actual, isCurrent = true.
- Si el texto no asigna un nivel 1-5 a una skill, usa 3.
- No agregues markdown ni texto fuera del JSON.`;

/**
 * Salida del LLM. `summary`/`email` van opcionales a propósito: un parseo
 * parcial no debe vaciar campos que ya existían en el perfil.
 */
const ImportSchema = z.object({
  name: z.string().optional(),
  headline: z.array(z.string()).default([]),
  summary: z.string().optional(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  languages: z
    .array(z.object({ language: z.string(), level: z.string().default('') }))
    .default([]),
  softSkills: z.array(z.string()).default([]),
  links: z.array(z.object({ type: z.string(), url: z.string() })).default([]),
  experiences: z
    .array(
      z.object({
        role: z.string(),
        company: z.string().default(''),
        periodStart: z.string().default(''),
        periodEnd: z.string().optional().nullable(),
        isCurrent: z.boolean().optional().default(false),
        bullets: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  education: z
    .array(
      z.object({
        institution: z.string(),
        degree: z.string().default(''),
        periodStart: z.string().default(''),
        periodEnd: z.string().optional().nullable(),
      }),
    )
    .default([]),
  projects: z
    .array(
      z.object({
        name: z.string(),
        summary: z.string().default(''),
        stack: z.array(z.string()).default([]),
        repositoryUrl: z.string().optional().nullable(),
        websiteUrl: z.string().optional().nullable(),
        visibility: z.string().default('public'),
        highlights: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  skills: z
    .array(
      z.object({
        category: z.string().default('General'),
        name: z.string(),
        rating: z.number().int().min(1).max(5).default(3),
        knowledge: z.string().optional().nullable(),
      }),
    )
    .default([]),
});

export type ProfileImportData = z.infer<typeof ImportSchema>;

export interface ProfileImportResult {
  applied: boolean;
  note: string;
  /** Cuántas entidades se guardaron por sección (0 = se mantuvo lo anterior). */
  counts?: {
    experiences: number;
    education: number;
    projects: number;
    skills: number;
    links: number;
  };
}

/**
 * Importa una HV en markdown/texto al perfil ESTRUCTURADO.
 *
 * Por qué existe: `POST /resumes/text` solo indexa el texto para el match
 * semántico; la HV que redacta la IA se arma del perfil (experiencias,
 * proyectos, skills…). Sin esto, pegar el markdown no evita que la HV generada
 * salga vacía.
 *
 * Garantía anti-pérdida: cada sección se REEMPLAZA solo si el parseo trae
 * elementos. Un parseo parcial mantiene lo que ya había en vez de borrarlo.
 */
@Injectable()
export class ProfileImportService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly logger: JsonLogger,
  ) {}

  async importFromMarkdown(profileId: string, content: string): Promise<ProfileImportResult> {
    const profile = await this.prisma.profile.findUnique({ where: { id: profileId } });
    if (!profile) throw new NotFoundException(`Profile ${profileId} no existe`);

    const text = (content ?? '').trim();
    if (text.length < MIN_LENGTH) {
      throw new BadRequestException(
        `El texto es muy corto para ser una HV (mínimo ${MIN_LENGTH} caracteres)`,
      );
    }

    const ai = await this.llm.json(SYSTEM_PROMPT, `HOJA DE VIDA A IMPORTAR:\n\n${text}`);
    if (!ai) {
      return {
        applied: false,
        note: 'El proveedor de IA no está configurado: no se pudo importar. Configurá DEEPSEEK_API_KEY (o LLM_PROVIDER).',
      };
    }

    const data = ImportSchema.parse(ai);
    const skillIds = await this.ensureSkills(data.skills.map((s) => s.name));

    const ops: Prisma.PrismaPromise<unknown>[] = [];

    // Campos escalares: solo se pisan si el parseo trae algo.
    const scalars: Prisma.ProfileUpdateInput = {};
    if (data.name?.trim()) scalars.name = data.name.trim();
    if (data.headline.length > 0) scalars.headline = data.headline.map((h) => h.trim()).filter(Boolean);
    if (data.summary?.trim()) scalars.summary = data.summary.trim();
    if (data.email?.trim()) scalars.email = data.email.trim();
    if (data.phone?.trim()) scalars.phone = data.phone.trim();
    if (data.location?.trim()) scalars.location = data.location.trim();
    if (data.languages.length > 0) scalars.languages = data.languages as Prisma.InputJsonValue;
    if (data.softSkills.length > 0) scalars.softSkills = data.softSkills as Prisma.InputJsonValue;
    if (Object.keys(scalars).length > 0) {
      ops.push(this.prisma.profile.update({ where: { id: profileId }, data: scalars }));
    }

    // Experiencia.
    if (data.experiences.length > 0) {
      ops.push(this.prisma.experience.deleteMany({ where: { profileId } }));
      data.experiences.forEach((exp, i) => {
        ops.push(
          this.prisma.experience.create({
            data: {
              profileId,
              role: exp.role,
              company: exp.company,
              periodStart: exp.periodStart,
              periodEnd: exp.periodEnd ?? null,
              isCurrent: exp.isCurrent ?? false,
              bullets: exp.bullets as Prisma.InputJsonValue,
              sortOrder: i,
            },
          }),
        );
      });
    }

    // Formación.
    if (data.education.length > 0) {
      ops.push(this.prisma.education.deleteMany({ where: { profileId } }));
      data.education.forEach((edu, i) => {
        ops.push(
          this.prisma.education.create({
            data: {
              profileId,
              institution: edu.institution,
              degree: edu.degree,
              periodStart: edu.periodStart,
              periodEnd: edu.periodEnd ?? null,
              sortOrder: i,
            },
          }),
        );
      });
    }

    // Proyectos.
    if (data.projects.length > 0) {
      ops.push(this.prisma.project.deleteMany({ where: { profileId } }));
      data.projects.forEach((proj) => {
        ops.push(
          this.prisma.project.create({
            data: {
              profileId,
              name: proj.name,
              summary: proj.summary,
              stack: proj.stack as Prisma.InputJsonValue,
              repositoryUrl: proj.repositoryUrl ?? null,
              websiteUrl: proj.websiteUrl ?? null,
              visibility: proj.visibility,
              highlights: proj.highlights as Prisma.InputJsonValue,
            },
          }),
        );
      });
    }

    // Skills: entidades Skill (catálogo) + relación ProfileSkill del perfil.
    // Se deduplica por nombre: el unique (profileId, skillId) no admite repetidos.
    const seenSkill = new Set<string>();
    const validSkills = data.skills.filter((s) => {
      const name = s.name.trim();
      if (!name || !skillIds.has(name) || seenSkill.has(name)) return false;
      seenSkill.add(name);
      return true;
    });
    if (validSkills.length > 0) {
      ops.push(this.prisma.profileSkill.deleteMany({ where: { profileId } }));
      for (const skill of validSkills) {
        ops.push(
          this.prisma.profileSkill.create({
            data: {
              profileId,
              skillId: skillIds.get(skill.name.trim())!,
              category: skill.category,
              rating: skill.rating,
              provenance: 'import-md',
              knowledge: skill.knowledge ?? null,
            },
          }),
        );
      }
    }

    // Enlaces de contacto (se deduplica por URL).
    const links = dedupeLinks(data.links);
    if (links.length > 0) {
      ops.push(this.prisma.contactLink.deleteMany({ where: { profileId } }));
      links.forEach((link, i) => {
        ops.push(
          this.prisma.contactLink.create({
            data: { profileId, type: link.type, url: link.url, isPrimary: i === 0 },
          }),
        );
      });
    }

    await this.prisma.$transaction(ops);

    const result: ProfileImportResult = {
      applied: true,
      note: 'Perfil actualizado desde el markdown. Revisá los datos y, si cambió la HV, usá «Re-evaluar vacantes».',
      counts: {
        experiences: data.experiences.length,
        education: data.education.length,
        projects: data.projects.length,
        skills: validSkills.length,
        links: links.length,
      },
    };

    this.logger.log(
      {
        msg: 'perfil importado desde markdown',
        profileId,
        provider: this.llm.name,
        counts: result.counts,
      },
      ProfileImportService.name,
    );

    return result;
  }

  /** Asegura las entidades Skill del catálogo y devuelve nombre → id. */
  private async ensureSkills(names: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
    const map = new Map<string, string>();
    for (const name of unique) {
      const skill = await this.prisma.skill.upsert({
        where: { name },
        update: {},
        create: { name },
      });
      map.set(name, skill.id);
    }
    return map;
  }
}

function dedupeLinks(links: { type: string; url: string }[]): { type: string; url: string }[] {
  const seen = new Set<string>();
  const out: { type: string; url: string }[] = [];
  for (const link of links) {
    const url = link.url?.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ type: link.type?.trim() || 'link', url });
  }
  return out;
}
