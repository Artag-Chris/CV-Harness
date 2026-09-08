import { Global, Module } from '@nestjs/common';
import { env } from '../../config/env';
import { LLM_PROVIDER } from '../../config/tokens';
import { GroqLlmService } from './groq.service';
import { MockLlmService } from './mock.service';

@Global()
@Module({
  providers: [
    GroqLlmService,
    MockLlmService,
    {
      provide: LLM_PROVIDER,
      useFactory: (groq: GroqLlmService, mock: MockLlmService) =>
        env.llmMode === 'groq' ? groq : mock,
      inject: [GroqLlmService, MockLlmService],
    },
  ],
  exports: [LLM_PROVIDER],
})
export class LlmModule {}
