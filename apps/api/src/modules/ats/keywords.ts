import { TECH_DICTIONARY } from '../../common/tech-dictionary';
import { compactToken, normalizeForAts, significantTokens, tokenize } from './normalize';
import { synonymVariants, tokenMatches } from './synonyms';
import type { AtsKeyword, KeywordImportance } from './types';

export interface KeywordTarget {
  keyword: string;
  importance: KeywordImportance;
}

export interface KeywordSources {
  title?: string | null;
  descriptionRaw?: string | null;
  enrichment?: {
    keyRequirements?: string[];
    niceToHave?: string[];
    skills?: string[];
  } | null;
  strategyKeywords?: string[] | null;
}

/** Clave de deduplicación: normalizada y sin separadores internos. */
const keyOf = (term: string): string => compactToken(normalizeForAts(term));

/**
 * Keywords objetivo de la vacante, en modo ESTRICTO: además de lo que extrajo
 * la IA, escanea el texto crudo con el diccionario técnico. Sin esto el score
 * saldría inflado (la IA solo devuelve hasta 10 requisitos y 15 skills).
 */
export function extractTargetKeywords(sources: KeywordSources): KeywordTarget[] {
  const targets = new Map<string, KeywordTarget>();

  const add = (term: string, importance: KeywordImportance) => {
    const clean = String(term ?? '').trim();
    if (!clean) return;
    // Sin tokens con carga semántica no hay nada medible (ej. "Requisitos").
    if (significantTokens(clean).length === 0) return;
    const key = keyOf(clean);
    if (!key) return;
    const existing = targets.get(key);
    // Gana la importancia más alta si ya estaba.
    if (existing && existing.importance === 'high') return;
    targets.set(key, { keyword: clean, importance });
  };

  const enr = sources.enrichment ?? {};
  add(sources.title ?? '', 'high');
  for (const skill of enr.skills ?? []) add(skill, 'high');
  for (const req of enr.keyRequirements ?? []) add(req, 'high');
  for (const nice of enr.niceToHave ?? []) add(nice, 'medium');
  for (const kw of sources.strategyKeywords ?? []) add(kw, 'medium');

  // Descubrimiento en el texto crudo: lo que un ATS real vería.
  const raw = normalizeForAts(sources.descriptionRaw ?? '');
  if (raw) {
    for (const term of TECH_DICTIONARY) {
      const normalizedTerm = normalizeForAts(term);
      if (!normalizedTerm) continue;
      // Coincidencia por palabra completa: `go` no debe matchear "algorithms".
      const pattern = new RegExp(`(^|[^a-z0-9+#])${escapeRegExp(normalizedTerm)}([^a-z0-9+#]|$)`);
      if (pattern.test(raw)) add(term, 'medium');
    }
  }

  return [...targets.values()];
}

/** Cobertura de cada keyword dentro del texto de la HV (lo que imprime el PDF). */
export function checkCoverage(targets: KeywordTarget[], haystackText: string): AtsKeyword[] {
  const hayNorm = normalizeForAts(haystackText);
  const hayTokens = buildHaystackTokens(haystackText);

  return targets.map(({ keyword, importance }) => {
    const needles = significantTokens(keyword);

    // 1) Coincidencia por frase completa (con alias): cubre "full stack" ≡
    //    "fullstack" y "continuous integration" ≡ "ci/cd".
    if (phraseMatch(keyword, hayNorm)) {
      return { keyword, importance, state: 'covered', matchedTokens: needles, missingTokens: [] };
    }

    // 2) Cobertura token a token, con sinónimos y palabras compuestas.
    const matchedTokens: string[] = [];
    const missingTokens: string[] = [];

    for (const needle of needles) {
      const hit = hayTokens.some((hay) => tokenMatches(needle, hay));
      if (hit) matchedTokens.push(needle);
      else missingTokens.push(needle);
    }

    const state =
      missingTokens.length === 0
        ? 'covered'
        : matchedTokens.length === 0
          ? 'missing'
          : 'partial';

    return { keyword, importance, state, matchedTokens, missingTokens };
  });
}

/**
 * Tokens del texto de la HV, más las **parejas adyacentes compactadas**. Sin
 * esto, `fullstack` nunca encontraría "Full Stack": dos palabras que juntas
 * forman el término.
 */
function buildHaystackTokens(text: string): string[] {
  const tokens = tokenize(text);
  const extra: string[] = [];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    extra.push(compactToken(tokens[i]) + compactToken(tokens[i + 1]));
  }
  return [...tokens, ...extra];
}

/** ¿Aparece la frase (o alguno de sus alias) como palabra completa? */
function phraseMatch(keyword: string, hayNorm: string): boolean {
  for (const variant of synonymVariants(normalizeForAts(keyword))) {
    const normalized = normalizeForAts(variant);
    if (!normalized) continue;
    const escaped = escapeRegExp(normalized);
    if (new RegExp(`(^|[^a-z0-9+#])${escaped}([^a-z0-9+#]|$)`).test(hayNorm)) return true;
  }
  return false;
}

/** Factor de crédito por estado: cubierta entera, media, o nada. */
export function stateFactor(state: AtsKeyword['state']): number {
  return state === 'covered' ? 1 : state === 'partial' ? 0.5 : 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
