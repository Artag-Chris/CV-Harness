import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Contrato del stream scraper:results (Rust → Nest)
// ─────────────────────────────────────────────────────────────────────────────

export const ScraperItemSchema = z.object({
  externalId: z.string().optional().nullable(),
  url: z.string().min(1),
  title: z.string().min(1),
  company: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  salary: z.string().optional().nullable(),
  modality: z.string().optional().nullable(),
  postedAt: z.string().optional().nullable(), // texto crudo (Rust no parsea fechas)
  descriptionText: z.string().optional().nullable(),
  descriptionHtml: z.string().optional().nullable(),
  applyUrl: z.string().optional().nullable(),
});

export const ScraperResultPayloadSchema = z.object({
  schemaVersion: z.string().optional().default('1'),
  requestId: z.string().min(1),
  sourceId: z.string().optional().nullable(),
  scrapedAt: z.string().optional().nullable(),
  error: z.string().optional().nullable().default(null),
  items: z.array(ScraperItemSchema).default([]),
});

export type ScraperResultPayload = z.infer<typeof ScraperResultPayloadSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Payloads de jobs BullMQ del pipeline
// ─────────────────────────────────────────────────────────────────────────────

export const VacancyJobSchema = z.object({
  vacancyId: z.string().min(1),
  // N:M: el job de match/resume corre por perfil.
  profileId: z.string().optional(),
});
export type VacancyJob = z.infer<typeof VacancyJobSchema>;

export const NotificationJobSchema = z.object({
  type: z.enum(['MATCH_READY', 'RESUME_READY', 'SCRAPE_ERROR', 'SOURCE_ERROR', 'INFO']),
  title: z.string(),
  body: z.string(),
  payload: z.record(z.unknown()).default({}),
});
export type NotificationJob = z.infer<typeof NotificationJobSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Salidas LLM por etapa
// ─────────────────────────────────────────────────────────────────────────────

export const NormalizeExtractSchema = z.object({
  title: z.string().optional(),
  company: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  modality: z.string().optional().nullable(),
  salary: z.string().optional().nullable(),
  seniority: z.string().optional().nullable(),
  summary: z.string().optional().default(''),
  keyRequirements: z.array(z.string()).default([]),
  niceToHave: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
});
export type NormalizeExtract = z.infer<typeof NormalizeExtractSchema>;

export const MatchOutcomeSchema = z.object({
  score: z.number().int().min(0).max(100),
  reasons: z.array(z.string()).default([]),
  gaps: z.array(z.string()).default([]),
  applicationStrategy: z.object({
    highlights: z.array(z.string()).default([]),
    keywords: z.array(z.string()).default([]),
    angle: z.string().default(''),
    suggestedChannel: z.string().default(''),
  }),
  coverLetterDraft: z.string().optional().default(''),
});
export type MatchOutcome = z.infer<typeof MatchOutcomeSchema>;

export const ResumeContentSchema = z.object({
  headline: z.string().default(''),
  summary: z.string().default(''),
  skills: z.array(z.string()).default([]),
  experience: z
    .array(
      z.object({
        role: z.string(),
        company: z.string(),
        period: z.string(),
        bullets: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  projects: z
    .array(
      z.object({ name: z.string(), highlights: z.array(z.string()).default([]) }),
    )
    .default([]),
  education: z
    .array(
      z.object({
        institution: z.string(),
        degree: z.string(),
        period: z.string().default(''),
      }),
    )
    .default([]),
  softSkills: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
});
export type ResumeContent = z.infer<typeof ResumeContentSchema>;
