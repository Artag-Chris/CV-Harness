import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';

/**
 * Extracción con cheerio que ESPEJA la semántica del motor Rust
 * (apps/scraper/src/engine.rs): primer match, texto normalizado, href
 * absolutizado sin fragmento. Sirve para validar una receta candidata antes de
 * guardarla, sin tener que ir y volver por el worker.
 */

export interface RecipeSelectors {
  /** Selector de la tarjeta repetida; sin él no se puede extraer nada. */
  item?: string;
  title?: string;
  company?: string;
  location?: string;
  salary?: string;
  postedAt?: string;
  applyUrl?: string;
  description?: string;
  nextPage?: string;
  fetchDetail?: boolean;
  detail?: { description?: string };
}

export interface ProbedItem {
  title: string;
  url: string;
  company?: string;
  location?: string;
  salary?: string;
  postedAt?: string;
  descriptionChars: number;
}

/** Colapsa espacios como `split_whitespace().join(" ")` en Rust. */
export function normalizeText(raw: string): string {
  return raw.split(/\s+/).filter(Boolean).join(' ').trim();
}

function absoluteUrl(base: string, href: string): string | null {
  try {
    const url = new URL(href, base);
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function textOf($: cheerio.CheerioAPI, el: AnyNode, selector: string): string | undefined {
  const found = $(el as Element).find(selector).first();
  if (found.length === 0) return undefined;
  const text = normalizeText(found.text());
  return text || undefined;
}

function hrefOf($: cheerio.CheerioAPI, el: AnyNode, selector: string): string | undefined {
  const found = $(el as Element).find(selector).first();
  if (found.length === 0) return undefined;
  return found.attr('href') ?? found.attr('data-path') ?? found.attr('data-href') ?? undefined;
}

export interface ExtractResult {
  items: ProbedItem[];
  /** Items donde el título salió no vacío / total. */
  titleRatio: number;
}

/**
 * Aplica una receta al HTML. `item` y `title` son obligatorios; el resto es
 * best-effort (igual que en el motor real).
 */
export function extractWithRecipe(
  html: string,
  selectors: RecipeSelectors,
  baseUrl: string,
): ExtractResult {
  const $ = cheerio.load(html);
  const items: ProbedItem[] = [];
  if (!selectors.item) return { items, titleRatio: 0 };
  let itemEls: cheerio.Cheerio<AnyNode>;
  try {
    itemEls = $(selectors.item);
  } catch {
    return { items, titleRatio: 0 };
  }

  let titles = 0;
  itemEls.each((_, el) => {
    const title = selectors.title ? textOf($, el, selectors.title) : undefined;
    if (title) titles += 1;
    const href = selectors.applyUrl ? hrefOf($, el, selectors.applyUrl) : undefined;
    const description = selectors.description
      ? normalizeText($(el).find(selectors.description).first().text())
      : '';
    items.push({
      title: title ?? '',
      url: href ? (absoluteUrl(baseUrl, href) ?? href) : '',
      company: selectors.company ? textOf($, el, selectors.company) : undefined,
      location: selectors.location ? textOf($, el, selectors.location) : undefined,
      salary: selectors.salary ? textOf($, el, selectors.salary) : undefined,
      postedAt: selectors.postedAt ? textOf($, el, selectors.postedAt) : undefined,
      descriptionChars: description.length,
    });
  });

  const total = itemEls.length;
  return { items, titleRatio: total === 0 ? 0 : titles / total };
}

/** Score de una receta: cuántos items y cuántos campos útiles llenó. */
export function scoreRecipe(html: string, selectors: RecipeSelectors, baseUrl: string): number {
  const { items, titleRatio } = extractWithRecipe(html, selectors, baseUrl);
  if (items.length === 0) return 0;
  const withTitle = items.filter((i) => i.title.length > 0).length;
  if (withTitle === 0) return 0;
  const enrichable = items.filter(
    (i) => i.url || i.company || i.location || i.salary || i.descriptionChars > 0,
  ).length;
  // Items con título mandan; los campos extra suman como desempate.
  return withTitle * 10 + enrichable + Math.round(titleRatio * 5);
}
