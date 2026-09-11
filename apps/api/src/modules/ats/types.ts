import type { AtsLanguage } from './headings';

export type AtsGrade = 'PASS' | 'RISK' | 'FAIL';

export type KeywordState = 'covered' | 'partial' | 'missing';

export type KeywordImportance = 'high' | 'medium';

/** Una keyword objetivo de la vacante y cómo quedó en la HV. */
export interface AtsKeyword {
  keyword: string;
  importance: KeywordImportance;
  state: KeywordState;
  /** Tokens significativos que sí aparecen en la HV. */
  matchedTokens: string[];
  /** Tokens significativos que faltan. */
  missingTokens: string[];
}

export interface AtsBreakdown {
  id: 'keywords' | 'structure' | 'contact' | 'format';
  label: string;
  /** Puntaje del bloque, 0-100. */
  score: number;
  /** Peso del bloque en el total (los pesos suman 1). */
  weight: number;
  detail: string;
}

export interface AtsAnalysis {
  score: number;
  grade: AtsGrade;
  atsMode: boolean;
  language: AtsLanguage;
  breakdown: AtsBreakdown[];
  /** Keywords que no están en la HV (accionables). */
  missingKeywords: string[];
  /** Keywords ya cubiertas. */
  presentKeywords: string[];
  /** Detalle por keyword, con los tokens que faltan. */
  keywords: AtsKeyword[];
  /** Cosas que un ATS puede leer mal. */
  warnings: string[];
  /** Qué hacer para subir el puntaje. */
  suggestions: string[];
  expectedHeadings: string[];
  sectionsFound: string[];
}

export const ATS_GRADE_LABEL: Record<AtsGrade, string> = {
  PASS: 'Pasa el filtro',
  RISK: 'En riesgo',
  FAIL: 'No pasa',
};
