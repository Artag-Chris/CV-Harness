/**
 * Encabezados estándar que busca un ATS, y detección de idioma.
 *
 * IMPORTANTE: este mapa se **duplica** en el renderer del PDF del dashboard
 * (`src/lib/pdf/headings.ts`) porque son repos separados y no hay import
 * cruzado. Si se cambia acá y no allá (o al revés), el medidor dejaría de
 * reflejar el PDF: los tests fijan el contrato para que la divergencia se vea.
 */

export type AtsLanguage = 'es' | 'en';

export const STANDARD_HEADINGS: Record<AtsLanguage, Record<string, string>> = {
  en: {
    summary: 'PROFESSIONAL SUMMARY',
    experience: 'PROFESSIONAL EXPERIENCE',
    skills: 'SKILLS',
    education: 'EDUCATION',
    projects: 'PROJECTS',
    languages: 'LANGUAGES',
    softSkills: 'SOFT SKILLS',
  },
  es: {
    summary: 'PERFIL PROFESIONAL',
    experience: 'EXPERIENCIA PROFESIONAL',
    skills: 'HABILIDADES',
    education: 'EDUCACIÓN',
    projects: 'PROYECTOS',
    languages: 'IDIOMAS',
    softSkills: 'HABILIDADES BLANDAS',
  },
};

/**
 * Encabezados que imprime HOY la plantilla de dos columnas (heredados del CV
 * original). No son estándar: un ATS busca "Experience"/"Education"/"Skills" y
 * acá encuentra "About me" y "Work experience in time". El peor es
 * `WORK EXPERIENCE`, que encabeza los PROYECTOS: colisiona con la experiencia
 * laboral de `WORK EXPERIENCE IN TIME`.
 */
export const LEGACY_HEADINGS = {
  summary: 'ABOUT ME',
  experience: 'WORK EXPERIENCE IN TIME',
  skills: 'TECHNICAL SKILLS',
  education: 'ACADEMIC BACKGROUND',
  projects: 'WORK EXPERIENCE',
  languages: 'LANGUAGES',
  softSkills: 'SOFT SKILLS',
} as const;

/** Sección que un ATS espera y que el encabezado heredado NO declara. */
export const LEGACY_MISSING: Record<string, string> = {
  summary: 'summary',
  experience: 'experience',
  skills: 'skills',
  education: 'education',
  projects: 'projects',
};

const ES_MARKERS = [' y ', ' de ', ' con ', ' para ', ' que ', ' en ', ' la ', ' el ', ' los ', ' las '];
const EN_MARKERS = [' and ', ' of ', ' with ', ' for ', ' the ', ' in ', ' to ', ' is ', ' are '];

/**
 * Idioma del contenido por marcadores de función. Empata a español (el idioma
 * por defecto del harness).
 */
export function detectLanguage(...texts: (string | null | undefined)[]): AtsLanguage {
  const haystack = ` ${texts
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')} `;
  const count = (markers: string[]) =>
    markers.reduce((total, marker) => total + haystack.split(marker).length - 1, 0);
  return count(EN_MARKERS) > count(ES_MARKERS) ? 'en' : 'es';
}
