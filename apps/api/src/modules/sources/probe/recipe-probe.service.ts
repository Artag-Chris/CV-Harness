import { Inject, Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { env } from '../../../config/env';
import { LLM_PROVIDER } from '../../../config/tokens';
import { originOf } from '../../../common/url.util';
import { JsonLogger } from '../../../common/json-logger.service';
import type { LlmProvider } from '../../llm/llm-provider.port';
import { SOURCE_TEMPLATES } from '../sources.templates';
import { extractWithRecipe, scoreRecipe, type ProbedItem, type RecipeSelectors } from './extract';
import { fetchPage, isLikelyValidCss } from './fetch';
import { detectRecipe } from './heuristic';

export interface ProbeResult {
  listUrl: string;
  finalUrl: string;
  status: number;
  bytes: number;
  /** Quién propuso la receta elegida. */
  chosenBy: 'plantilla' | 'heuristica' | 'ia';
  templateId?: string;
  selectors: RecipeSelectors;
  limits: Record<string, unknown>;
  preview: ProbedItem[];
  diagnostics: {
    itemCount: number;
    itemsWithUrl: number;
    itemsWithDescription: number;
    warnings: string[];
    alternatives: { by: string; itemCount: number; score: number }[];
  };
}

const AI_SAMPLE_CHARS = 4000;

/**
 * Analiza una URL de listado y propone una receta de scraping lista para
 * guardar. Estrategia en cascada (de lo más barato/seguro a lo más caro):
 *
 *   1. Plantillas conocidas → si el portal ya está soportado, gana esa.
 *   2. Heurística sobre el HTML → detecta la tarjeta de cada vacante y sus campos.
 *   3. IA (si hay proveedor real) → propone/afina selectores usando el DOM real.
 *
 * Toda propuesta se VALIDA ejecutándola contra el HTML descargado: se puntúa y
 * se elige la mejor. Nunca se guarda nada: el usuario confirma en la UI.
 */
@Injectable()
export class RecipeProbeService {
  constructor(
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly logger: JsonLogger,
  ) {}

  async probe(listUrl: string): Promise<ProbeResult> {
    const page = await fetchPage(listUrl);
    const baseUrl = originOf(page.finalUrl) || originOf(listUrl);
    const warnings: string[] = [];
    const alternatives: ProbeResult['diagnostics']['alternatives'] = [];

    interface Candidate {
      by: ProbeResult['chosenBy'];
      templateId?: string;
      selectors: RecipeSelectors;
      limits: Record<string, unknown>;
      score: number;
      itemCount: number;
    }
    const candidates: Candidate[] = [];

    // ── 1. Plantillas del portal ──────────────────────────────────────────────
    for (const tpl of SOURCE_TEMPLATES) {
      // Las plantillas de API no proponen selectores CSS: su camino es la fuente
      // API_JSON, no el probe de HTML.
      if (tpl.kind === 'API_JSON') continue;
      if (!baseUrl || !tpl.baseUrlDefault.includes(new URL(baseUrl).hostname)) continue;
      const selectors = tpl.selectors as unknown as RecipeSelectors;
      const score = scoreRecipe(page.html, selectors, baseUrl);
      const itemCount = extractWithRecipe(page.html, selectors, baseUrl).items.length;
      alternatives.push({ by: `plantilla:${tpl.id}`, itemCount, score });
      if (score > 0) {
        candidates.push({
          by: 'plantilla',
          templateId: tpl.id,
          selectors,
          limits: tpl.limits,
          score,
          itemCount,
        });
      }
    }

    // ── 2. Heurística ────────────────────────────────────────────────────────
    const heur = detectRecipe(page.html, baseUrl);
    if (heur.selectors) {
      const score = scoreRecipe(page.html, heur.selectors, baseUrl);
      alternatives.push({ by: 'heuristica', itemCount: heur.itemCount, score });
      candidates.push({
        by: 'heuristica',
        selectors: heur.selectors,
        limits: defaultLimits(),
        score,
        itemCount: heur.itemCount,
      });
    }

    // ── 3. IA: afinar selectores con el DOM real ─────────────────────────────
    if (env.llmMode !== 'mock') {
      try {
        const aiSelectors = await this.suggestWithAi(page.html, baseUrl, heur);
        if (aiSelectors) {
          const score = scoreRecipe(page.html, aiSelectors, baseUrl);
          const itemCount = extractWithRecipe(page.html, aiSelectors, baseUrl).items.length;
          alternatives.push({ by: 'ia', itemCount, score });
          if (score > 0) {
            candidates.push({
              by: 'ia',
              selectors: aiSelectors,
              limits: defaultLimits(),
              score,
              itemCount,
            });
          }
        }
      } catch (err) {
        warnings.push(`La IA no pudo proponer selectores: ${String(err)}`);
      }
    } else {
      warnings.push(
        'IA en modo mock (sin DEEPSEEK_API_KEY): la propuesta sale de plantillas y heurística.',
      );
    }

    if (candidates.length === 0) {
      return {
        listUrl,
        finalUrl: page.finalUrl,
        status: page.status,
        bytes: page.bytes,
        chosenBy: 'heuristica',
        selectors: {},
        limits: defaultLimits(),
        preview: [],
        diagnostics: {
          itemCount: 0,
          itemsWithUrl: 0,
          itemsWithDescription: 0,
          warnings: [
            ...warnings,
            'No se detectaron vacantes en el HTML. Si el sitio carga por JavaScript, no es scrapeable con este motor (haría falta un navegador headless).',
          ],
          alternatives,
        },
      };
    }

    const best = candidates.sort((a, b) => b.score - a.score)[0];
    const full = extractWithRecipe(page.html, best.selectors, baseUrl);
    const preview = full.items.slice(0, 5);

    const missing = (['company', 'location', 'salary', 'postedAt'] as const).filter(
      (f) => !best.selectors[f],
    );
    if (missing.length > 0) {
      warnings.push(
        `Sin selector para: ${missing.join(', ')}. Podés completarlos a mano (los campos son opcionales).`,
      );
    }
    if (full.items.filter((i) => i.url).length === 0) {
      warnings.push('Ninguna vacante tiene URL propia: revisá el selector «URL de la oferta».');
    }

    this.logger.log(
      {
        msg: 'receta propuesta',
        listUrl,
        chosenBy: best.by,
        templateId: best.templateId,
        itemCount: best.itemCount,
        alternatives: alternatives.length,
      },
      RecipeProbeService.name,
    );

    return {
      listUrl,
      finalUrl: page.finalUrl,
      status: page.status,
      bytes: page.bytes,
      chosenBy: best.by,
      templateId: best.templateId,
      selectors: best.selectors,
      limits: best.limits,
      preview,
      diagnostics: {
        itemCount: full.items.length,
        itemsWithUrl: full.items.filter((i) => i.url).length,
        itemsWithDescription: full.items.filter((i) => i.descriptionChars > 0).length,
        warnings,
        alternatives,
      },
    };
  }

  /** Pide a la IA selectores, usando el HTML real de una tarjeta como muestra. */
  private async suggestWithAi(
    html: string,
    baseUrl: string,
    heur: { selectors: RecipeSelectors | null; candidates: { selector: string; ratio: number; avgText: number; isAnchor: boolean }[] },
  ): Promise<RecipeSelectors | null> {
    const $ = cheerio.load(html);
    let sample = '';
    if (heur.selectors?.item) {
      const node = $(heur.selectors.item).first();
      if (node.length > 0) sample = node.html() ?? '';
    }
    if (!sample) {
      sample = $('body').html() ?? '';
    }
    sample = sample.slice(0, AI_SAMPLE_CHARS);

    const system = [
      'Eres un experto en scraping. Recibes el HTML de UNA tarjeta de vacante de un listado.',
      'Devuelve SOLO un objeto JSON con selectores CSS estándar, relativos a esa tarjeta.',
      'Claves: item, title, company, location, salary, postedAt, applyUrl, description,',
      'detailDescription, nextPage, pageParam.',
      '"item" es el selector de la tarjeta repetida; "title" el del título; "applyUrl" el del',
      'enlace a la oferta. Usa clases CSS reales del HTML. Omite una clave si no la encuentras.',
      'PROHIBIDO: :has-text(), :contains(), XPath, texto entre comillas angulares, >>.',
    ].join(' ');

    const user = [
      `URL base: ${baseUrl}`,
      heur.candidates.length
        ? `Candidatos detectados (selector, presencia, texto medio, esEnlace):\n${heur.candidates
            .map((c) => `- ${c.selector} | ${c.ratio} | ${c.avgText} | ${c.isAnchor}`)
            .join('\n')}`
        : 'Sin candidatos previos.',
      '',
      'HTML de la tarjeta:',
      sample,
    ].join('\n');

    const raw = await this.llm.json(system, user);
    if (!raw) return null;

    const pick = (key: string): string | undefined => {
      const value = raw[key];
      return typeof value === 'string' && isLikelyValidCss(value) ? value.trim() : undefined;
    };

    const selectors: RecipeSelectors = {};
    const item = pick('item') ?? heur.selectors?.item;
    const title = pick('title') ?? heur.selectors?.title;
    if (!item || !title) return null;
    selectors.item = item;
    selectors.title = title;
    for (const field of ['company', 'location', 'salary', 'postedAt', 'applyUrl', 'description', 'nextPage'] as const) {
      const value = pick(field);
      if (value) selectors[field] = value;
    }
    const detail = pick('detailDescription');
    if (detail) {
      selectors.fetchDetail = true;
      selectors.detail = { description: detail };
    }
    // Verifica que los selectores sean consultables por cheerio (y por Rust).
    try {
      $(selectors.item);
      $(selectors.title);
    } catch {
      return null;
    }
    return selectors;
  }
}

/** Límites por defecto de una receta nueva: prudente y con UA de navegador. */
function defaultLimits(): Record<string, unknown> {
  return {
    maxPages: 1,
    delayMs: 1000,
    timeoutMs: 20000,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    respectRobots: true,
  };
}
