import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { extractWithRecipe, normalizeText, type RecipeSelectors } from './extract';

/**
 * Detección heurística de la receta de un listado de vacantes, sin IA.
 *
 * Idea: en un listado, cada vacante es una "tarjeta" que contiene un enlace.
 * Se busca el contenedor que MÁS se repite con un enlace significativo dentro
 * (eso da el selector `item`) y luego se votan los campos por clase (company,
 * location, salary, date…) entre las tarjetas detectadas.
 */

const FIELD_KEYWORDS: Record<string, string[]> = {
  company: ['company', 'empresa', 'employer', 'business', 'organization'],
  location: ['location', 'ubicacion', 'city', 'ciudad', 'place', 'region', 'lugar'],
  salary: ['salary', 'salario', 'sueldo', 'wage', 'pay', 'remuneracion'],
  postedAt: ['date', 'fecha', 'publish', 'published', 'publicado', 'time', 'ago'],
  description: ['description', 'descripcion', 'summary', 'resumen', 'snippet', 'body'],
};

/** Clases válidas para armar un selector CSS simple (evita escapes raros). */
function safeClasses(el: Element, max = 2): string[] {
  const raw = (el.attribs?.class ?? '').split(/\s+/).filter(Boolean);
  return raw
    .filter((c) => /^[A-Za-z_][A-Za-z0-9_-]*$/.test(c))
    .slice(0, max);
}

function selectorKey(el: Element): string | null {
  const tag = (el.tagName ?? '').toLowerCase();
  if (!tag || tag === 'html' || tag === 'body') return null;
  const classes = safeClasses(el);
  return [tag, ...classes].join('.');
}

function isElement(node: unknown): node is Element {
  return (
    typeof node === 'object' &&
    node !== null &&
    (node as { type?: string }).type === 'tag' &&
    typeof (node as Element).tagName === 'string'
  );
}

function classNameOf(el: Element): string {
  return (el.attribs?.class ?? '').toLowerCase();
}

interface FieldCandidate {
  selector: string;
  present: number;
  avgText: number;
  isAnchor: boolean;
  classNames: string;
  /** Primeros textos vistos (para patrones de dinero/fecha). */
  samples: string[];
}

/**
 * Elementos auxiliares que no son contenido: etiquetas ocultas para lectores de
 * pantalla (`span.hide>`COP<`) y similares. Nunca deben elegirse como campo.
 */
function isAuxiliary(classNames: string): boolean {
  return /(^|[\s-])(hide|hidden|sr-only|visually-hidden)([\s-]|$)/.test(classNames);
}

/** Importe real: "$4,5", "$ 4.000.000" o "5 millones"; "COP" solo no vale. */
const MONEY_RE = /\$\s*[\d.,]+|\d[\d.,]*\s*(millones|mil\b|mensual)|millones/i;

export interface FieldSuggestion {
  selector: string;
  /** Fracción de tarjetas donde aparece (0-1). */
  ratio: number;
  avgText: number;
  isAnchor: boolean;
}

export interface HeuristicResult {
  selectors: RecipeSelectors | null;
  /** Nº de tarjetas detectadas. */
  itemCount: number;
  /** Candidatos de campo ordenados por utilidad (contexto para la IA). */
  candidates: FieldSuggestion[];
}

export function detectRecipe(html: string, baseUrl: string): HeuristicResult {
  const $ = cheerio.load(html);

  // ── 1. Votar el contenedor de cada vacante ────────────────────────────────
  type Stats = { nodes: Set<Element>; anchors: Set<Element> };
  const byKey = new Map<string, Stats>();

  $('a[href]').each((_, anchor) => {
    const el = anchor as Element;
    if (normalizeText($(el).text()).length < 3) return;
    let node: unknown = el.parent;
    for (let depth = 0; depth < 5 && isElement(node); depth += 1) {
      const key = selectorKey(node);
      if (key) {
        let stats = byKey.get(key);
        if (!stats) {
          stats = { nodes: new Set(), anchors: new Set() };
          byKey.set(key, stats);
        }
        stats.nodes.add(node);
        stats.anchors.add(el);
      }
      node = node.parent;
    }
  });

  // Elegimos la tarjeta. Tres condiciones, en este orden de importancia:
  //   1. Que se repita (>= 5 veces) con ~un enlace cada una.
  //   2. Que la tarjeta TENGA CONTENIDO: si solo hay enlaces cortos, es una
  //      lista de navegación (p.ej. "Trabajo en Abrego" en el pie de elempleo),
  //      no vacantes. Por eso preferimos candidatos con texto medio alto.
  //   3. Ser el contenedor más rico: si no, gana un <h3> que solo envuelve el
  //      enlace y perderíamos empresa/ciudad/salario (que viven en la tarjeta).
  const MIN_CARD_TEXT = 60;
  const eligible: { key: string; nodes: number; avgText: number; anchorCount: number }[] = [];
  for (const [key, stats] of byKey) {
    const nodes = stats.nodes.size;
    if (nodes < 5) continue;
    const ratio = stats.anchors.size / nodes;
    if (ratio < 0.6) continue;
    const avgText =
      [...stats.nodes].reduce((acc, node) => acc + normalizeText($(node).text()).length, 0) /
      nodes;
    eligible.push({ key, nodes, avgText, anchorCount: stats.anchors.size });
  }

  const rich = eligible.filter((c) => c.avgText >= MIN_CARD_TEXT);
  const pool = rich.length > 0 ? rich : eligible;

  let itemSelector: string | null = null;
  let bestScore = 0;
  for (const candidate of pool) {
    const ratio = candidate.anchorCount / candidate.nodes;
    const score = candidate.nodes * (2 - Math.abs(1 - ratio)) * Math.log10(1 + candidate.avgText);
    if (score > bestScore) {
      bestScore = score;
      itemSelector = candidate.key;
    }
  }

  if (!itemSelector) return { selectors: null, itemCount: 0, candidates: [] };
  const items = $(itemSelector).toArray();
  if (items.length === 0) return { selectors: null, itemCount: 0, candidates: [] };

  // ── 2. Votar los campos dentro de las tarjetas ────────────────────────────
  const fields = new Map<string, FieldCandidate>();
  for (const item of items) {
    const seen = new Set<string>();
    $(item)
      .find('*')
      .each((_, node) => {
        const el = node as Element;
        if (el.tagName === 'script' || el.tagName === 'style') return;
        const key = selectorKey(el);
        if (!key || key === itemSelector || seen.has(key)) return;
        seen.add(key);
        const text = normalizeText($(el).text());
        const entry = fields.get(key) ?? {
          selector: key,
          present: 0,
          avgText: 0,
          isAnchor: el.tagName === 'a',
          classNames: classNameOf(el),
          samples: [],
        };
        entry.present += 1;
        entry.avgText += text.length;
        entry.isAnchor = entry.isAnchor || el.tagName === 'a';
        if (text && entry.samples.length < 5 && !entry.samples.includes(text)) {
          entry.samples.push(text);
        }
        fields.set(key, entry);
      });
  }
  const total = items.length;
  const ranked = [...fields.values()].map((f) => ({
    ...f,
    ratio: f.present / total,
    avgText: f.present === 0 ? 0 : f.avgText / f.present,
  }));

  // Título: el enlace con más texto presente en casi todas las tarjetas.
  const titleCandidate = ranked
    .filter((f) => f.isAnchor && f.ratio >= 0.7 && f.avgText >= 5)
    .sort((a, b) => b.avgText - a.avgText || b.ratio - a.ratio)[0];

  const selectors: RecipeSelectors = {
    item: itemSelector,
    ...(titleCandidate ? { title: titleCandidate.selector } : {}),
  };
  if (titleCandidate) selectors.applyUrl = titleCandidate.selector;

  // Campos por palabra clave en el nombre de las clases.
  // Desempate por el texto MÁS CORTO: preferimos el elemento más específico
  // (p.ej. `span.info-company-name` en vez del `h3` que lo envuelve y además
  // arrastra etiquetas ocultas como "industry").
  for (const [field, keywords] of Object.entries(FIELD_KEYWORDS)) {
    const match = ranked
      .filter((c) => c.selector !== titleCandidate?.selector)
      .filter((c) => !isAuxiliary(c.classNames))
      .filter((c) => c.ratio >= 0.5 && c.avgText >= 3)
      .map((c) => ({ ...c, hit: keywords.find((k) => c.classNames.includes(k)) }))
      .filter((c) => c.hit)
      .sort((a, b) => b.ratio - a.ratio || a.avgText - b.avgText)[0];
    if (match) selectors[field as keyof RecipeSelectors] = match.selector as never;
  }

  // Respaldo por CONTENIDO cuando la clase no delata el campo: hay portales
  // (elempleo) cuyo salario vive en un `div.text-blue-petrol-dark` sin pistas.
  // El tope de longitud evita elegir un contenedor gigante (un panel completo
  // también "contiene" un importe y daría un campo de 1500 caracteres).
  const MAX_FIELD_TEXT = 80;
  const used = new Set(
    [selectors.title, selectors.applyUrl, selectors.company, selectors.location, selectors.postedAt].filter(
      Boolean,
    ),
  );
  const byContent = (re: RegExp, minRatio: number) =>
    ranked
      .filter((c) => !used.has(c.selector) && !isAuxiliary(c.classNames))
      .filter((c) => c.ratio >= minRatio && c.avgText >= 3 && c.avgText <= MAX_FIELD_TEXT)
      // Se prueban varias tarjetas: el primer texto puede ser "Salario
      // confidencial" y en otra venir el importe real.
      .filter((c) => re.test(c.samples.join(' | ')))
      .sort((a, b) => b.ratio - a.ratio || a.avgText - b.avgText)[0];

  if (!selectors.salary) {
    const money = byContent(MONEY_RE, 0.2);
    if (money) selectors.salary = money.selector;
  }
  if (!selectors.postedAt) {
    const when = byContent(
      /^hace\b|\bhace\s+\d|\bpublicad[oa]\b|\d{1,2}\s*(d[ií]as?|horas?|meses|semanas?)/i,
      0.5,
    );
    if (when) selectors.postedAt = when.selector;
  }

  // Solo vale si realmente extrae títulos.
  const { items: preview } = extractWithRecipe(html, selectors, baseUrl);
  if (preview.filter((i) => i.title).length === 0) {
    return { selectors: null, itemCount: 0, candidates: [] };
  }

  const candidates: FieldSuggestion[] = ranked
    .filter((c) => c.ratio >= 0.5 && c.avgText > 0)
    .sort((a, b) => b.ratio - a.ratio || b.avgText - a.avgText)
    .slice(0, 25)
    .map((c) => ({
      selector: c.selector,
      ratio: Math.round(c.ratio * 100) / 100,
      avgText: Math.round(c.avgText),
      isAnchor: c.isAnchor,
    }));

  return { selectors, itemCount: preview.length, candidates };
}
