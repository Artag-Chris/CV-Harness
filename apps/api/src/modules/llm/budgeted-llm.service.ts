import { JsonLogger } from '../../common/json-logger.service';
import { LlmCallOptions, LlmProvider } from './llm-provider.port';
import { LlmUsageService } from './llm-usage.service';

/**
 * Etapas automáticas de fondo (disparadas por el cron/pipeline).
 * El tope diario frena ESTAS etapas para que un scraping masivo no dispare la
 * factura, sin bloquear acciones manuales a pedido del usuario (generar HV,
 * traducir, refinar, entrevista, crear HV por prompt).
 */
const BACKGROUND_STAGES = new Set(['normalize', 'match']);

/**
 * Decorador del LlmProvider activo que:
 * 1. Verifica el tope diario (tokens y/o USD) antes de llamar a la API en
 *    etapas automáticas de fondo (`normalize`, `match`). Si se alcanzó el tope,
 *    devuelve `null` para caer al respaldo determinístico sin romper el pipeline.
 * 2. Registra los tokens de entrada/salida, costo estimado y latencia en AiUsage
 *    para TODAS las etapas (automáticas y manuales).
 */
export class BudgetedLlmService implements LlmProvider {
  get name(): string {
    return this.inner.name;
  }

  constructor(
    private readonly inner: LlmProvider,
    private readonly usage: LlmUsageService,
    private readonly logger: JsonLogger,
  ) {}

  async json(
    system: string,
    user: string,
    options?: LlmCallOptions,
  ): Promise<Record<string, unknown> | null> {
    if (this.inner.name === 'mock') {
      return this.inner.json(system, user, options);
    }

    const stage = options?.stage ?? 'unknown';
    if (BACKGROUND_STAGES.has(stage)) {
      const budget = await this.usage.checkDailyBudget();
      if (!budget.allowed) {
        this.logger.warn(
          {
            msg: 'Tope diario de IA alcanzado — usando respaldo determinístico',
            stage,
            reason: budget.reason,
            day: budget.day,
            todayTokens: budget.todayTokens,
            tokenLimit: budget.tokenLimit,
            todayCostUsd: budget.todayCostUsd,
            usdLimit: budget.usdLimit,
            resetAt: budget.resetAt,
          },
          BudgetedLlmService.name,
        );
        return null;
      }
    }

    const startedAt = Date.now();
    if (this.inner.jsonWithUsage) {
      const result = await this.inner.jsonWithUsage(system, user, options);
      if (!result) return null;

      await this.usage.record({
        stage,
        provider: this.inner.name,
        model: result.model,
        tokensIn: result.usage.tokensIn,
        tokensOut: result.usage.tokensOut,
        totalTokens: result.usage.totalTokens,
        latencyMs: Date.now() - startedAt,
      });

      return result.data;
    }

    const data = await this.inner.json(system, user, options);
    if (!data) return null;

    await this.usage.record({
      stage,
      provider: this.inner.name,
      model: this.inner.name,
      tokensIn: 0,
      tokensOut: 0,
      totalTokens: 0,
      latencyMs: Date.now() - startedAt,
    });
    return data;
  }
}
