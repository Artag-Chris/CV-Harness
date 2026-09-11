import { detectLanguage, LEGACY_HEADINGS, STANDARD_HEADINGS, type AtsLanguage } from './headings';
import { checkCoverage, extractTargetKeywords, stateFactor, type KeywordSources } from './keywords';
import { normalizeForAts } from './normalize';
import type { AtsAnalysis, AtsBreakdown, AtsKeyword, AtsGrade } from './types';

export interface AtsContent {
  headline?: string;
  summary?: string;
  skills?: string[];
  experience?: { role?: string; company?: string; period?: string; bullets?: string[] }[];
  projects?: { name?: string; highlights?: string[] }[];
  education?: { institution?: string; degree?: string; period?: string }[];
  softSkills?: string[];
  keywords?: string[];
  /** Interruptor por borrador: decide qué encabezados y maquetación imprime el PDF. */
  atsMode?: boolean;
}

export interface AtsProfile {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  links?: { type: string; url: string }[];
  languages?: { language: string; level: string }[];
}

export interface AnalyzeInput {
  content: AtsContent;
  profile?: AtsProfile | null;
  /** Keywords objetivo: título, texto crudo, enrichment y strategy del match. */
  vacancy?: KeywordSources | null;
}

/**
 * Pesos del score. La cobertura manda porque es lo que decide si un ATS te
 * encuentra para la búsqueda; el formato solo evita que te descarte antes.
 */
const WEIGHTS = { keywords: 0.45, structure: 0.2, contact: 0.15, format: 0.2 } as const;

/**
 * Tokens que un ATS asocia a cada sección. Un encabezado "cuenta" si contiene
 * alguno: por eso `TECHNICAL SKILLS` se reconoce como skills, pero
 * `ACADEMIC BACKGROUND` NO se reconoce como educación.
 */
const SECTION_TOKENS: Record<string, string[]> = {
  summary: ['summary', 'profile', 'perfil'],
  experience: ['experience', 'experiencia'],
  skills: ['skills', 'habilidad'],
  education: ['education', 'educacion', 'formacion'],
  projects: ['project', 'proyecto'],
  languages: ['language', 'idioma'],
  softSkills: ['soft', 'blandas'],
};

/** Texto que el ATS usa para buscar keywords: excluye el contacto a propósito. */
export function resumeText(content: AtsContent): string {
  const parts: string[] = [content.headline ?? '', content.summary ?? ''];
  parts.push(...(content.skills ?? []));
  for (const exp of content.experience ?? []) {
    parts.push(exp.role ?? '', exp.company ?? '', ...(exp.bullets ?? []));
  }
  for (const project of content.projects ?? []) {
    parts.push(project.name ?? '', ...(project.highlights ?? []));
  }
  for (const edu of content.education ?? []) parts.push(edu.degree ?? '', edu.institution ?? '');
  parts.push(...(content.softSkills ?? []));
  return parts.filter(Boolean).join('\n');
}

export function analyzeAts({ content, profile, vacancy }: AnalyzeInput): AtsAnalysis {
  const atsMode = content.atsMode === true;
  const language = detectLanguage(content.summary, content.headline, ...(content.skills ?? []));
  const text = resumeText(content);
  const warnings: string[] = [];
  const suggestions: string[] = [];

  // ── 1. Cobertura de keywords ────────────────────────────────────────────
  const targets = extractTargetKeywords({
    title: vacancy?.title,
    descriptionRaw: vacancy?.descriptionRaw,
    enrichment: vacancy?.enrichment,
    strategyKeywords: vacancy?.strategyKeywords,
  });
  const keywords: AtsKeyword[] = checkCoverage(targets, text);

  const totalWeight = keywords.reduce(
    (sum, k) => sum + (k.importance === 'high' ? 2 : 1),
    0,
  );
  const earned = keywords.reduce(
    (sum, k) => sum + (k.importance === 'high' ? 2 : 1) * stateFactor(k.state),
    0,
  );
  const keywordScore = totalWeight > 0 ? Math.round((earned / totalWeight) * 100) : 0;

  const notCovered = keywords.filter((k) => k.state !== 'covered');
  const missingKeywords = sortByImportance(notCovered).map((k) => k.keyword);
  const presentKeywords = keywords.filter((k) => k.state === 'covered').map((k) => k.keyword);

  if (keywords.length === 0) {
    suggestions.push(
      'No hay requisitos extraídos de la vacante: corré el análisis de encaje para poder medir la cobertura.',
    );
  } else if (missingKeywords.length > 0) {
    suggestions.push(
      `Faltan ${missingKeywords.length} de ${keywords.length} palabras clave. Integrá las que sean verdad en tu perfil.`,
    );
  }

  // ── 2. Estructura (encabezados + orden de lectura) ──────────────────────
  // Se separan las secciones que un ATS ESPERA (summary/experience/skills/
  // education) de las opcionales: que falte una sección núcleo tiene que doler,
  // si no una HV casi vacía sacaría buena nota de estructura.
  const CORE_SECTIONS = ['summary', 'experience', 'skills', 'education'];
  const OPTIONAL_SECTIONS = ['projects', 'languages', 'softSkills'];

  const present = new Set(
    [
      { id: 'summary', ok: !!content.summary?.trim() },
      { id: 'experience', ok: (content.experience ?? []).length > 0 },
      { id: 'skills', ok: (content.skills ?? []).length > 0 },
      { id: 'education', ok: (content.education ?? []).length > 0 },
      { id: 'projects', ok: (content.projects ?? []).length > 0 },
      { id: 'languages', ok: (profile?.languages ?? []).length > 0 },
      { id: 'softSkills', ok: (content.softSkills ?? []).length > 0 },
    ]
      .filter((section) => section.ok)
      .map((section) => section.id),
  );

  const standard = STANDARD_HEADINGS[language];
  const printedHeading = (id: string) =>
    atsMode ? standard[id] : (LEGACY_HEADINGS as Record<string, string>)[id];

  const sectionsFound: string[] = [];
  const coreScore = meanRatio(
    CORE_SECTIONS.map((id) => present.has(id) && isRecognized(printedHeading(id), id)),
  );
  const presentOptional = OPTIONAL_SECTIONS.filter((id) => present.has(id));
  const optionalScore =
    presentOptional.length === 0
      ? 1
      : meanRatio(presentOptional.map((id) => isRecognized(printedHeading(id), id)));

  for (const id of present) {
    const heading = printedHeading(id);
    if (heading && isRecognized(heading, id)) sectionsFound.push(heading);
  }

  const recognizedRatio = coreScore * 0.8 + optionalScore * 0.2;
  const expectedHeadings = [...CORE_SECTIONS, ...presentOptional]
    .map((id) => standard[id])
    .filter(Boolean);

  // El orden de lectura de la maquetación de dos columnas no es lineal: el texto
  // de la columna derecha sale después de toda la izquierda.
  const orderScore = atsMode ? 100 : 40;
  const structureScore = Math.round(recognizedRatio * 100 * 0.7 + orderScore * 0.3);

  if (!atsMode) {
    const unrecognized = [...CORE_SECTIONS, ...presentOptional].filter(
      (id) => present.has(id) && !isRecognized(printedHeading(id), id),
    );
    if (unrecognized.length > 0) {
      warnings.push(
        `Encabezados que un ATS no reconoce: ${unrecognized
          .map((id) => (LEGACY_HEADINGS as Record<string, string>)[id])
          .join(', ')}.`,
      );
      suggestions.push('Encendé el Modo ATS para usar encabezados estándar.');
    }
    const missingCore = CORE_SECTIONS.filter((id) => !present.has(id));
    if (missingCore.length > 0) {
      warnings.push(`Faltan secciones que un ATS espera: ${missingCore.join(', ')}.`);
    }
    warnings.push(
      'La maquetación es de dos columnas: el ATS puede leer la columna derecha después de toda la izquierda.',
    );
    warnings.push(
      'El encabezado "WORK EXPERIENCE" encabeza tus proyectos, no tus empleos: un ATS puede confundirlos.',
    );
  } else {
    const missingCore = CORE_SECTIONS.filter((id) => !present.has(id));
    if (missingCore.length > 0) {
      warnings.push(`Faltan secciones que un ATS espera: ${missingCore.join(', ')}.`);
    }
  }

  // ── 3. Contacto ─────────────────────────────────────────────────────────
  const email = (profile?.email ?? '').trim();
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
  const phoneDigits = (profile?.phone ?? '').replace(/\D/g, '');
  const phoneValid = phoneDigits.length >= 7;

  let contactScore = 0;
  if (emailValid) contactScore += atsMode ? 60 : 45;
  if (phoneValid) contactScore += atsMode ? 30 : 25;
  if (profile?.location?.trim()) contactScore += 5;
  if ((profile?.links ?? []).some((l) => l?.url)) contactScore += 5;

  if (!emailValid) {
    warnings.push('No hay un email válido en el perfil: el ATS no puede contactarte.');
  } else if (!atsMode) {
    // La plantilla heredada imprime el email en MAYÚSCULAS siempre (no depende
    // de cómo esté guardado en el perfil).
    warnings.push('El email se imprime en MAYÚSCULAS: algunos parsers no lo reconocen.');
  }
  if (!phoneValid) warnings.push('No hay un teléfono con dígitos suficientes en el perfil.');
  if (!atsMode) {
    warnings.push('El teléfono se imprime con el prefijo "CEL: ", que es ruido para el parser.');
  }

  // ── 4. Formato ──────────────────────────────────────────────────────────
  const words = text.split(/\s+/).filter(Boolean).length;
  const lengthScore = words === 0 ? 0 : words < 200 ? Math.round((words / 200) * 100) : words > 900 ? Math.max(50, 100 - Math.round((words - 900) / 10)) : 100;
  const datesScore = dateConsistencyScore(content);
  const discarded = discardedChars(text);
  const charsetScore = discarded.count === 0 ? 100 : Math.max(0, 100 - discarded.count * 5);

  const formatScore = Math.round(
    (atsMode ? 100 : 45) * 0.4 +
      lengthScore * 0.25 +
      datesScore * 0.2 +
      charsetScore * 0.15,
  );

  if (discarded.count > 0) {
    warnings.push(
      `Hay ${discarded.count} caracteres que el PDF descarta (emojis o símbolos fuera de Latin-1), como ${discarded.sample}.`,
    );
  }
  if (words > 900) warnings.push(`La HV tiene ${words} palabras: puede quedar larga para el filtro.`);
  if (words > 0 && words < 200) {
    suggestions.push('La HV es muy corta: sumá logros concretos con métricas.');
  }
  if (datesScore < 100) {
    warnings.push('Hay períodos sin año detectable o con formato inconsistente.');
  }

  // ── Score final ─────────────────────────────────────────────────────────
  const breakdown: AtsBreakdown[] = [
    {
      id: 'keywords',
      label: 'Cobertura de palabras clave',
      score: keywordScore,
      weight: WEIGHTS.keywords,
      detail: `${keywords.length - missingKeywords.length}/${keywords.length} cubiertas`,
    },
    {
      id: 'structure',
      label: 'Estructura y encabezados',
      score: structureScore,
      weight: WEIGHTS.structure,
      detail: atsMode
        ? 'Encabezados estándar y lectura lineal'
        : `${CORE_SECTIONS.filter((id) => present.has(id) && !isRecognized(printedHeading(id), id)).length} encabezados núcleo no estándar · dos columnas`,
    },
    {
      id: 'contact',
      label: 'Contacto parseable',
      score: contactScore,
      weight: WEIGHTS.contact,
      detail: atsMode ? 'Email en minúsculas y teléfono limpio' : 'Email en mayúsculas y prefijo "CEL:"',
    },
    {
      id: 'format',
      label: 'Formato y legibilidad',
      score: formatScore,
      weight: WEIGHTS.format,
      detail: `${words} palabras`,
    },
  ];

  const score = clamp(
    Math.round(breakdown.reduce((sum, block) => sum + block.score * block.weight, 0)),
  );

  return {
    score,
    grade: gradeOf(score),
    atsMode,
    language,
    breakdown,
    missingKeywords,
    presentKeywords,
    keywords: sortByImportance(keywords),
    warnings,
    suggestions,
    expectedHeadings,
    sectionsFound,
  };
}

function isRecognized(heading: string | undefined, sectionId: string): boolean {
  if (!heading) return false;
  const tokens = SECTION_TOKENS[sectionId] ?? [];
  const normalized = normalizeForAts(heading);
  return tokens.some((token) => normalized.includes(token));
}

/** Proporción de aciertos de una lista de booleanos (0 si está vacía). */
function meanRatio(flags: boolean[]): number {
  if (flags.length === 0) return 0;
  return flags.filter(Boolean).length / flags.length;
}

/** Períodos con año detectable y separador consistente. */
function dateConsistencyScore(content: AtsContent): number {
  const periods = [
    ...(content.experience ?? []).map((e) => e.period ?? ''),
    ...(content.education ?? []).map((e) => e.period ?? ''),
  ].filter((period) => period.trim().length > 0);
  if (periods.length === 0) return 100;
  const wellFormed = periods.filter((period) => /\d{4}/.test(period)).length;
  return Math.round((wellFormed / periods.length) * 100);
}

/** Caracteres que `sanitizeForPdf` elimina (fuera de Latin-1), con una muestra. */
function discardedChars(text: string): { count: number; sample: string } {
  const found: string[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code > 0xff) found.push(char);
  }
  return { count: found.length, sample: [...new Set(found)].slice(0, 5).join(' ') };
}

function sortByImportance<T extends { importance: 'high' | 'medium' }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.importance !== b.importance) return a.importance === 'high' ? -1 : 1;
    return 0;
  });
}

function gradeOf(score: number): AtsGrade {
  if (score >= 80) return 'PASS';
  if (score >= 60) return 'RISK';
  return 'FAIL';
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}
