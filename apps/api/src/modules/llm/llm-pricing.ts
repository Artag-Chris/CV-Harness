/**
 * Precios de referencia (USD por 1M de tokens) para estimar el gasto de IA.
 * Se pueden sobreescribir con LLM_PRICE_INPUT_PER_1M / LLM_PRICE_OUTPUT_PER_1M.
 */
const MODEL_PRICES_PER_1M: Record<string, { in: number; out: number }> = {
  // DeepSeek (precios estándar de API, cache miss)
  'deepseek-chat': { in: 0.27, out: 1.1 },
  'deepseek-v4-flash': { in: 0.14, out: 0.28 },
  'deepseek-flash': { in: 0.14, out: 0.28 },
  'deepseek-reasoner': { in: 0.55, out: 2.19 },
  // Groq
  'llama-3.3-70b-versatile': { in: 0.59, out: 0.79 },
  'llama-3.1-8b-instant': { in: 0.05, out: 0.08 },
};

/** Día calendario en UTC (YYYY-MM-DD): clave de partición del tope diario. */
export function utcDay(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Próximo reinicio del tope diario (00:00:00.000Z del día siguiente). */
export function nextUtcMidnightIso(date: Date = new Date()): string {
  const next = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1),
  );
  return next.toISOString();
}

/** Estima el costo en USD redondeado a 6 decimales. */
export function estimateCostUsd(
  model: string,
  tokensIn: number,
  tokensOut: number,
  overrideInPer1M?: number,
  overrideOutPer1M?: number,
): number {
  const normalized = model.trim().toLowerCase();
  const base = MODEL_PRICES_PER_1M[normalized] ?? { in: 0, out: 0 };
  const priceIn = overrideInPer1M ?? base.in;
  const priceOut = overrideOutPer1M ?? base.out;

  const raw = (tokensIn * priceIn + tokensOut * priceOut) / 1_000_000;
  return Math.round(raw * 1_000_000) / 1_000_000;
}
