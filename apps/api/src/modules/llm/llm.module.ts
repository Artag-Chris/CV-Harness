import { Global, Module } from '@nestjs/common';
import { env } from '../../config/env';
import { LLM_PROVIDER } from '../../config/tokens';
import { DeepSeekLlmService } from './deepseek.service';
import { GroqLlmService } from './groq.service';
import { MockLlmService } from './mock.service';

/**
 * Fábrica de proveedores LLM detrás del puerto LlmProvider.
 *
 * Cómo agregar otro proveedor (patrón adaptador, sin tocar el pipeline):
 *   1. Crear XxxLlmService implements LlmProvider (json(system, user)).
 *   2. Añadirlo como provider aquí.
 *   3. En config/env.ts: vars de API + incluir Xxx en LLM_PROVIDER / llmMode.
 * El resto del sistema (normalizer, matcher, resume…) no cambia.
 */
@Global()
@Module({
  providers: [
    DeepSeekLlmService,
    GroqLlmService,
    MockLlmService,
    {
      provide: LLM_PROVIDER,
      useFactory: (
        deepseek: DeepSeekLlmService,
        groq: GroqLlmService,
        mock: MockLlmService,
      ) => {
        switch (env.llmMode) {
          case 'deepseek':
            return deepseek;
          case 'groq':
            return groq;
          default:
            return mock;
        }
      },
      inject: [DeepSeekLlmService, GroqLlmService, MockLlmService],
    },
  ],
  exports: [LLM_PROVIDER],
})
export class LlmModule {}
