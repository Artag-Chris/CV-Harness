import { Global, Module } from '@nestjs/common';
import { env } from '../../config/env';
import { LLM_PROVIDER } from '../../config/tokens';
import { JsonLogger } from '../../common/json-logger.service';
import { DeepSeekLlmService } from './deepseek.service';
import { GroqLlmService } from './groq.service';
import { MockLlmService } from './mock.service';
import { LlmUsageService } from './llm-usage.service';
import { BudgetedLlmService } from './budgeted-llm.service';

/**
 * Fábrica de proveedores LLM detrás del puerto LlmProvider.
 *
 * El proveedor activo se envuelve en BudgetedLlmService para registrar tokens
 * de entrada/salida y aplicar el tope diario (LLM_DAILY_TOKEN_LIMIT /
 * LLM_DAILY_USD_LIMIT) con reinicio automático cada día UTC.
 */
@Global()
@Module({
  providers: [
    DeepSeekLlmService,
    GroqLlmService,
    MockLlmService,
    LlmUsageService,
    {
      provide: LLM_PROVIDER,
      useFactory: (
        deepseek: DeepSeekLlmService,
        groq: GroqLlmService,
        mock: MockLlmService,
        usage: LlmUsageService,
        logger: JsonLogger,
      ) => {
        const inner =
          env.llmMode === 'deepseek'
            ? deepseek
            : env.llmMode === 'groq'
              ? groq
              : mock;
        return new BudgetedLlmService(inner, usage, logger);
      },
      inject: [
        DeepSeekLlmService,
        GroqLlmService,
        MockLlmService,
        LlmUsageService,
        JsonLogger,
      ],
    },
  ],
  exports: [LLM_PROVIDER, LlmUsageService],
})
export class LlmModule {}
