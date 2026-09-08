export interface SourceRow {
  id: string;
  name: string;
  kind: string;
  baseUrl: string;
  listUrl: string;
  enabled: boolean;
  intervalMinutes: number;
  profileId: string | null;
  lastRunAt: string | null;
  nextRunAt: string;
  _count?: { vacancies: number };
  profile?: { id: string; name: string } | null;
}

export interface SourceTemplate {
  id: string;
  label: string;
  hint: string;
}

export interface ProfileRow {
  id: string;
  name: string;
  headline: string[];
  email: string | null;
  isPrimary: boolean;
  scheduleMinutes: number | null;
  nextRunAt: string | null;
  _count: {
    skills: number;
    projects: number;
    experiences: number;
    sources: number;
    resumes: number;
  };
}

export interface ResumeRow {
  id: string;
  name: string;
  kind: 'PDF' | 'MARKDOWN' | 'TEXT';
  filename: string | null;
  status: 'PENDING' | 'EMBEDDING' | 'READY' | 'FAILED';
  error: string | null;
  active: boolean;
  chunkCount: number;
  createdAt: string;
  _count?: { chunks: number };
}

export type VacancyStatus =
  | 'RAW'
  | 'NORMALIZED'
  | 'MATCHED'
  | 'RESUME_READY'
  | 'APPLIED'
  | 'IGNORED';

export interface VacancyListRow {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  salary: string | null;
  modality: string | null;
  status: VacancyStatus;
  matchScore: number | null;
  createdAt: string;
  source: { id: string; name: string };
  match: { id: string; score: number; verdict: string } | null;
  resume: { id: string; status: string; updatedAt: string } | null;
}

export interface VacancyDetail {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  salary: string | null;
  modality: string | null;
  url: string;
  postedAt: string | null;
  descriptionRaw: string;
  enrichment: {
    summary?: string;
    keyRequirements?: string[];
    niceToHave?: string[];
    skills?: string[];
    seniority?: string;
  } | null;
  raw: { applyUrl?: string } | Record<string, unknown>;
  status: VacancyStatus;
  matchScore: number | null;
  source: { name: string };
  match: MatchResult | null;
  resume: ResumeDraft | null;
}

export interface MatchResult {
  id: string;
  score: number;
  analysisScore: number | null;
  semanticScore: number | null;
  verdict: string;
  reasons: string[];
  gaps: string[];
  applicationStrategy: {
    highlights: string[];
    keywords: string[];
    angle: string;
    suggestedChannel: string;
  };
  coverLetterDraft: string | null;
}

export interface ResumeContent {
  headline: string;
  summary: string;
  skills: string[];
  experience: { role: string; company: string; period: string; bullets: string[] }[];
  projects: { name: string; highlights: string[] }[];
  education: { institution: string; degree: string; period: string }[];
  softSkills: string[];
  keywords?: string[];
  markdown?: string;
}

export interface ResumeDraft {
  id: string;
  vacancyId: string;
  content: ResumeContent;
  format: string;
  status: string;
  version: number;
  updatedAt: string;
}

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  payload: { vacancyId?: string; resumeId?: string };
  readAt: string | null;
  createdAt: string;
}
