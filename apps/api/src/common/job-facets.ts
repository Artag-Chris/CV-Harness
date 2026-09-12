/**
 * Taxonomía canónica de modalidad y seniority.
 *
 * El texto que traen los portales (y el que devuelve el LLM) es libre:
 * "Remoto", "100% remoto", "Híbrido / Remoto", "Trabajo en oficina"…
 * Filtrar por ese texto es frágil, así que el pipeline guarda además los
 * facets canónicos (`Vacancy.modalityTypes` / `Vacancy.seniorityLevel`) y el
 * listado filtra por ellos. El texto original se conserva para mostrarlo.
 */

export const MODALITY_TYPES = ['REMOTE', 'HYBRID', 'ONSITE'] as const;
export type ModalityType = (typeof MODALITY_TYPES)[number];

/**
 * Orden de prioridad: de la banda más alta a la más baja. `SEMI_SENIOR` va
 * ANTES que `SENIOR` a propósito: "semi senior" contiene "senior" y, si no,
 * la extracción determinística lo clasificaba como Senior.
 */
export const SENIORITY_LEVELS = [
  'SEMI_SENIOR',
  'LEAD',
  'SENIOR',
  'JUNIOR',
  'TRAINEE',
] as const;
export type SeniorityLevel = (typeof SENIORITY_LEVELS)[number];

/** Etiqueta legible del facet (para `enrichment.seniority` y la UI). */
export const SENIORITY_LABELS: Record<SeniorityLevel, string> = {
  TRAINEE: 'Trainee',
  JUNIOR: 'Junior',
  SEMI_SENIOR: 'Semi Senior',
  SENIOR: 'Senior',
  LEAD: 'Lead',
};

/** Minúsculas, sin acentos y sin puntuación: base común para los matchers. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const MODALITY_PATTERNS: Record<ModalityType, RegExp> = {
  REMOTE: /\b(remot\w*|teletrabajo|home ?office|work from home|wfh|telecommut\w*)\b/,
  HYBRID: /\b(hibrid\w*|hybrid|mixt[oa])\b/,
  ONSITE: /\b(presencial\w*|on ?site|in ?person)\b/,
};

/**
 * Modalidades detectadas en el texto, sin duplicados. Un aviso "Híbrido /
 * Remoto" devuelve AMBAS, y por eso el filtro de la UI es inclusivo: pedir
 * "Remota" muestra también las que ofrecen remoto entre varias opciones.
 */
export function canonicalModalities(
  ...texts: (string | null | undefined)[]
): ModalityType[] {
  const blob = normalize(texts.filter(Boolean).join(' '));
  if (!blob) return [];
  return MODALITY_TYPES.filter((modality) => MODALITY_PATTERNS[modality].test(blob));
}

/** Seniority canónico (un solo valor) o null si el texto no lo dice. */
export function canonicalSeniority(
  ...texts: (string | null | undefined)[]
): SeniorityLevel | null {
  const blob = normalize(texts.filter(Boolean).join(' '));
  if (!blob) return null;
  if (/\b(semi ?senior|semisenior|ssr)\b/.test(blob)) return 'SEMI_SENIOR';
  if (/\b(tech lead|team lead|lead|lider|leadership|head of)\b/.test(blob)) return 'LEAD';
  if (/\b(senior|sr)\b/.test(blob)) return 'SENIOR';
  if (/\b(junior|jr)\b/.test(blob)) return 'JUNIOR';
  if (/\b(trainee|intern|internship|practicante|aprendiz|pasante)\b/.test(blob)) {
    return 'TRAINEE';
  }
  return null;
}

export function isModalityType(value: string): value is ModalityType {
  return (MODALITY_TYPES as readonly string[]).includes(value);
}

export function isSeniorityLevel(value: string): value is SeniorityLevel {
  return (SENIORITY_LEVELS as readonly string[]).includes(value);
}

/** "REMOTE,HYBRID" (query param) → facets válidos, ignorando basura. */
export function parseModalities(csv: string | null | undefined): ModalityType[] {
  return parseCsv(csv).filter(isModalityType);
}

export function parseSeniorities(csv: string | null | undefined): SeniorityLevel[] {
  return parseCsv(csv).filter(isSeniorityLevel);
}

function parseCsv(csv: string | null | undefined): string[] {
  if (!csv) return [];
  return [
    ...new Set(
      csv
        .split(',')
        .map((v) => v.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
}
