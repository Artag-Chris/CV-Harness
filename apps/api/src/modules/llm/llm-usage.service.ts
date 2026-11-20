import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { JsonLogger } from '../../common/json-logger.service';
import { env } from '../../config/env';
import { estimateCostUsd, nextUtcMidnightIso, utcDay } from './llm-pricing';

export interface DailyBudgetStatus {
  allowed: boolean;
  reason: 'token_limit' | 'usd_limit' | null;
  day: string;
  todayTokens: number;
  todayCostUsd: number;
  tokenLimit: number;
  usdLimit: number;
  resetAt: string;
}

export interface RecordUsageInput {
  stage: string;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  totalTokens?: number;
  latencyMs: number;
}

/**
 * Registra el consumo de tokens/costo por llamada y evalúa el tope diario.
 * El tope se agrupa por día UTC (`YYYY-MM-DD`), así se reinicia automáticamente
 * cada día a las 00:00 UTC sin depender de un cron de borrado.
 */
@Injectable()
export class LlmUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: JsonLogger,
  ) {}

  async checkDailyBudget(now: Date = new Date()): Promise<DailyBudgetStatus> {
    const day = utcDay(now);
    const resetAt = nextUtcMidnightIso(now);
    const tokenLimit = env.LLM_DAILY_TOKEN_LIMIT;
    const usdLimit = env.LLM_DAILY_USD_LIMIT;

    if (tokenLimit <= 0 && usdLimit <= 0) {
      return {
        allowed: true,
        reason: null,
        day,
        todayTokens: 0,
        todayCostUsd: 0,
        tokenLimit,
        usdLimit,
        resetAt,
      };
    }

    const agg = await this.prisma.aiUsage.aggregate({
      where: { day },
      _sum: { totalTokens: true, costUsd: true },
    });

    const todayTokens = agg._sum.totalTokens ?? 0;
    const todayCostUsd =
      Math.round((agg._sum.costUsd ?? 0) * 1_000_000) / 1_000_000;

    if (tokenLimit > 0 && todayTokens >= tokenLimit) {
      return {
        allowed: false,
        reason: 'token_limit',
        day,
        todayTokens,
        todayCostUsd,
        tokenLimit,
        usdLimit,
        resetAt,
      };
    }

    if (usdLimit > 0 && todayCostUsd >= usdLimit) {
      return {
        allowed: false,
        reason: 'usd_limit',
        day,
        todayTokens,
        todayCostUsd,
        tokenLimit,
        usdLimit,
        resetAt,
      };
    }

    return {
      allowed: true,
      reason: null,
      day,
      todayTokens,
      todayCostUsd,
      tokenLimit,
      usdLimit,
      resetAt,
    };
  }

  async record(input: RecordUsageInput, now: Date = new Date()): Promise<void> {
    const tokensIn = Math.max(0, Math.round(input.tokensIn));
    const tokensOut = Math.max(0, Math.round(input.tokensOut));
    const totalTokens = Math.max(
      tokensIn + tokensOut,
      Math.round(input.totalTokens ?? tokensIn + tokensOut),
    );
    const costUsd = estimateCostUsd(
      input.model,
      tokensIn,
      tokensOut,
      env.LLM_PRICE_INPUT_PER_1M,
      env.LLM_PRICE_OUTPUT_PER_1M,
    );

    try {
      await this.prisma.aiUsage.create({
        data: {
          day: utcDay(now),
          stage: input.stage || 'unknown',
          provider: input.provider,
          model: input.model,
          tokensIn,
          tokensOut,
          totalTokens,
          costUsd,
          latencyMs: Math.max(0, Math.round(input.latencyMs)),
        },
      });
    } catch (err) {
      this.logger.warn(
        { msg: 'No se pudo registrar AiUsage', err: String(err) },
        LlmUsageService.name,
      );
    }
  }

  async getSummary(days = 14, now: Date = new Date()) {
    const today = utcDay(now);
    const resetAt = nextUtcMidnightIso(now);
    const safeDays = Math.min(Math.max(1, days), 90);
    const cutoff = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - (safeDays - 1),
      ),
    );
    const cutoffDay = utcDay(cutoff);

    const [todayAgg, totalAgg, byStageRaw, dailyRaw, recent] = await Promise.all([
      this.prisma.aiUsage.aggregate({
        where: { day: today },
        _sum: { tokensIn: true, tokensOut: true, totalTokens: true, costUsd: true },
        _count: { _all: true },
      }),
      this.prisma.aiUsage.aggregate({
        _sum: { tokensIn: true, tokensOut: true, totalTokens: true, costUsd: true },
        _count: { _all: true },
      }),
      this.prisma.aiUsage.groupBy({
        by: ['stage'],
        where: { day: today },
        _sum: { tokensIn: true, tokensOut: true, totalTokens: true, costUsd: true },
        _count: { _all: true },
      }),
      this.prisma.aiUsage.groupBy({
        by: ['day'],
        where: { day: { gte: cutoffDay } },
        _sum: { tokensIn: true, tokensOut: true, totalTokens: true, costUsd: true },
        _count: { _all: true },
        orderBy: { day: 'desc' },
      }),
      this.prisma.aiUsage.findMany({
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
    ]);

    const todayTokens = todayAgg._sum.totalTokens ?? 0;
    const todayCostUsd =
      Math.round((todayAgg._sum.costUsd ?? 0) * 1_000_000) / 1_000_000;
    const tokenLimit = env.LLM_DAILY_TOKEN_LIMIT;
    const usdLimit = env.LLM_DAILY_USD_LIMIT;
    const budgetExceeded =
      (tokenLimit > 0 && todayTokens >= tokenLimit) ||
      (usdLimit > 0 && todayCostUsd >= usdLimit);

    const activeModel =
      env.llmMode === 'deepseek'
        ? env.DEEPSEEK_MODEL
        : env.llmMode === 'groq'
          ? env.GROQ_MODEL
          : 'mock';

    return {
      today: {
        day: today,
        calls: todayAgg._count._all,
        tokensIn: todayAgg._sum.tokensIn ?? 0,
        tokensOut: todayAgg._sum.tokensOut ?? 0,
        totalTokens: todayTokens,
        costUsd: todayCostUsd,
        tokenLimit,
        usdLimit,
        remainingTokens:
          tokenLimit > 0 ? Math.max(0, tokenLimit - todayTokens) : null,
        remainingUsd:
          usdLimit > 0
            ? Math.max(0, Math.round((usdLimit - todayCostUsd) * 1_000_000) / 1_000_000)
            : null,
        budgetExceeded,
        resetAt,
      },
      total: {
        calls: totalAgg._count._all,
        tokensIn: totalAgg._sum.tokensIn ?? 0,
        tokensOut: totalAgg._sum.tokensOut ?? 0,
        totalTokens: totalAgg._sum.totalTokens ?? 0,
        costUsd: Math.round((totalAgg._sum.costUsd ?? 0) * 1_000_000) / 1_000_000,
      },
      byStage: byStageRaw
        .map((row) => ({
          stage: row.stage,
          calls: row._count._all,
          tokensIn: row._sum.tokensIn ?? 0,
          tokensOut: row._sum.tokensOut ?? 0,
          totalTokens: row._sum.totalTokens ?? 0,
          costUsd: Math.round((row._sum.costUsd ?? 0) * 1_000_000) / 1_000_000,
        }))
        .sort((a, b) => b.totalTokens - a.totalTokens),
      daily: dailyRaw.map((row) => ({
        day: row.day,
        calls: row._count._all,
        tokensIn: row._sum.tokensIn ?? 0,
        tokensOut: row._sum.tokensOut ?? 0,
        totalTokens: row._sum.totalTokens ?? 0,
        costUsd: Math.round((row._sum.costUsd ?? 0) * 1_000_000) / 1_000_000,
      })),
      recent,
      config: {
        provider: env.llmMode,
        model: activeModel,
        maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
        dailyTokenLimit: tokenLimit,
        dailyUsdLimit: usdLimit,
      },
    };
  }
}
