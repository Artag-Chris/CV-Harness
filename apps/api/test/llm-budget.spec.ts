import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  estimateCostUsd,
  nextUtcMidnightIso,
  utcDay,
} from '../src/modules/llm/llm-pricing';
import { BudgetedLlmService } from '../src/modules/llm/budgeted-llm.service';
import type { LlmProvider } from '../src/modules/llm/llm-provider.port';
import type { LlmUsageService } from '../src/modules/llm/llm-usage.service';
import type { JsonLogger } from '../src/common/json-logger.service';
import { parseEnv } from '../src/config/env';

describe('llm-pricing', () => {
  it('calcula día UTC y próximo reinicio a las 00:00 UTC', () => {
    const d = new Date('2026-11-20T15:42:10.000Z');
    expect(utcDay(d)).toBe('2026-11-20');
    expect(nextUtcMidnightIso(d)).toBe('2026-11-21T00:00:00.000Z');
  });

  it('estima costo para deepseek-chat y permite override de precios', () => {
    // 100k in ($0.27/1M) + 10k out ($1.10/1M) = 0.027 + 0.011 = 0.038
    expect(estimateCostUsd('deepseek-chat', 100_000, 10_000)).toBe(0.038);
    expect(estimateCostUsd('modelo-desconocido', 100_000, 10_000)).toBe(0);
    expect(estimateCostUsd('modelo-desconocido', 1_000_000, 1_000_000, 0.5, 1.5)).toBe(2);
  });
});

describe('env — variables de control de costos', () => {
  it('parsea defaults y valores explícitos de tope diario', () => {
    const def = parseEnv({});
    expect(def.LLM_DAILY_TOKEN_LIMIT).toBe(0);
    expect(def.LLM_DAILY_USD_LIMIT).toBe(0);
    expect(def.LLM_MAX_OUTPUT_TOKENS).toBe(4096);
    expect(def.LLM_PRICE_INPUT_PER_1M).toBeUndefined();

    const custom = parseEnv({
      LLM_DAILY_TOKEN_LIMIT: '150000',
      LLM_DAILY_USD_LIMIT: '0.75',
      LLM_MAX_OUTPUT_TOKENS: '2048',
      LLM_PRICE_INPUT_PER_1M: '0.2',
      LLM_PRICE_OUTPUT_PER_1M: '0.8',
    });
    expect(custom.LLM_DAILY_TOKEN_LIMIT).toBe(150_000);
    expect(custom.LLM_DAILY_USD_LIMIT).toBe(0.75);
    expect(custom.LLM_MAX_OUTPUT_TOKENS).toBe(2048);
    expect(custom.LLM_PRICE_INPUT_PER_1M).toBe(0.2);
    expect(custom.LLM_PRICE_OUTPUT_PER_1M).toBe(0.8);
  });
});

describe('BudgetedLlmService', () => {
  const logger = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as JsonLogger;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cuando el tope diario se alcanzó, NO llama a la API y devuelve null (respaldo determinístico)', async () => {
    const inner: LlmProvider = {
      name: 'deepseek',
      json: vi.fn(),
      jsonWithUsage: vi.fn(),
    };
    const usage = {
      checkDailyBudget: vi.fn().mockResolvedValue({
        allowed: false,
        reason: 'token_limit',
        day: '2026-11-20',
        todayTokens: 205_000,
        todayCostUsd: 0.08,
        tokenLimit: 200_000,
        usdLimit: 0,
        resetAt: '2026-11-21T00:00:00.000Z',
      }),
      record: vi.fn(),
    } as unknown as LlmUsageService;

    const svc = new BudgetedLlmService(inner, usage, logger);
    const res = await svc.json('sys', 'usr', { stage: 'normalize' });

    expect(res).toBeNull();
    expect(inner.jsonWithUsage).not.toHaveBeenCalled();
    expect(inner.json).not.toHaveBeenCalled();
    expect(usage.record).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('cuando está dentro del tope, llama a la API y registra tokens de entrada/salida y etapa', async () => {
    const inner: LlmProvider = {
      name: 'deepseek',
      json: vi.fn(),
      jsonWithUsage: vi.fn().mockResolvedValue({
        data: { score: 85 },
        model: 'deepseek-chat',
        usage: { tokensIn: 1200, tokensOut: 300, totalTokens: 1500 },
      }),
    };
    const usage = {
      checkDailyBudget: vi.fn().mockResolvedValue({
        allowed: true,
        reason: null,
        day: '2026-11-20',
        todayTokens: 10_000,
        todayCostUsd: 0.01,
        tokenLimit: 200_000,
        usdLimit: 0,
        resetAt: '2026-11-21T00:00:00.000Z',
      }),
      record: vi.fn().mockResolvedValue(undefined),
    } as unknown as LlmUsageService;

    const svc = new BudgetedLlmService(inner, usage, logger);
    const res = await svc.json('sys', 'usr', { stage: 'match' });

    expect(res).toEqual({ score: 85 });
    expect(inner.jsonWithUsage).toHaveBeenCalledWith('sys', 'usr', { stage: 'match' });
    expect(usage.record).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'match',
        provider: 'deepseek',
        model: 'deepseek-chat',
        tokensIn: 1200,
        tokensOut: 300,
        totalTokens: 1500,
      }),
    );
  });

  it('con proveedor mock no consulta ni registra presupuesto', async () => {
    const inner: LlmProvider = {
      name: 'mock',
      json: vi.fn().mockResolvedValue(null),
    };
    const usage = {
      checkDailyBudget: vi.fn(),
      record: vi.fn(),
    } as unknown as LlmUsageService;

    const svc = new BudgetedLlmService(inner, usage, logger);
    const res = await svc.json('sys', 'usr', { stage: 'normalize' });

    expect(res).toBeNull();
    expect(usage.checkDailyBudget).not.toHaveBeenCalled();
    expect(usage.record).not.toHaveBeenCalled();
  });
});

describe('LlmUsageService — tope diario', () => {
  const prevTokens = process.env.LLM_DAILY_TOKEN_LIMIT;
  const prevUsd = process.env.LLM_DAILY_USD_LIMIT;

  afterEach(() => {
    if (prevTokens === undefined) delete process.env.LLM_DAILY_TOKEN_LIMIT;
    else process.env.LLM_DAILY_TOKEN_LIMIT = prevTokens;
    if (prevUsd === undefined) delete process.env.LLM_DAILY_USD_LIMIT;
    else process.env.LLM_DAILY_USD_LIMIT = prevUsd;
    vi.resetModules();
  });

  it('bloquea al superar LLM_DAILY_TOKEN_LIMIT en el día UTC actual y permite al día siguiente', async () => {
    process.env.LLM_DAILY_TOKEN_LIMIT = '50000';
    process.env.LLM_DAILY_USD_LIMIT = '0';
    vi.resetModules();
    const { LlmUsageService: UsageSvc } = await import(
      '../src/modules/llm/llm-usage.service'
    );

    const byDay: Record<string, { totalTokens: number; costUsd: number }> = {
      '2026-11-20': { totalTokens: 50_000, costUsd: 0.02 },
      '2026-11-21': { totalTokens: 0, costUsd: 0 },
    };
    const prisma = {
      aiUsage: {
        aggregate: vi.fn().mockImplementation(({ where }: { where: { day: string } }) => {
          const hit = byDay[where.day] ?? { totalTokens: 0, costUsd: 0 };
          return Promise.resolve({ _sum: hit });
        }),
      },
    };
    const logger = { warn: vi.fn() };
    const svc = new UsageSvc(prisma as never, logger as never);

    const day1 = await svc.checkDailyBudget(new Date('2026-11-20T18:00:00Z'));
    expect(day1.allowed).toBe(false);
    expect(day1.reason).toBe('token_limit');

    const day2 = await svc.checkDailyBudget(new Date('2026-11-21T00:01:00Z'));
    expect(day2.allowed).toBe(true);
    expect(day2.reason).toBeNull();
  });

  it('bloquea al superar LLM_DAILY_USD_LIMIT', async () => {
    process.env.LLM_DAILY_TOKEN_LIMIT = '0';
    process.env.LLM_DAILY_USD_LIMIT = '0.5';
    vi.resetModules();
    const { LlmUsageService: UsageSvc } = await import(
      '../src/modules/llm/llm-usage.service'
    );

    const prisma = {
      aiUsage: {
        aggregate: vi.fn().mockResolvedValue({
          _sum: { totalTokens: 10_000, costUsd: 0.51 },
        }),
      },
    };
    const logger = { warn: vi.fn() };
    const svc = new UsageSvc(prisma as never, logger as never);

    const status = await svc.checkDailyBudget(new Date('2026-11-20T18:00:00Z'));
    expect(status.allowed).toBe(false);
    expect(status.reason).toBe('usd_limit');
  });
});
