import { Global, Module } from '@nestjs/common';
import { env } from '../../config/env';
import { EMBEDDING_PROVIDER } from '../../config/tokens';
import { MockEmbeddingService } from './mock-embeddings.service';
import { OpenAiEmbeddingService } from './openai-embeddings.service';

/**
 * Proveedor de embeddings global: OpenAI (text-embedding-3-small) o mock
 * determinístico cuando no hay OPENAI_API_KEY (E2E sin red).
 */
@Global()
@Module({
  providers: [
    OpenAiEmbeddingService,
    MockEmbeddingService,
    {
      provide: EMBEDDING_PROVIDER,
      useFactory: (openai: OpenAiEmbeddingService, mock: MockEmbeddingService) =>
        env.embedMode === 'openai' ? openai : mock,
      inject: [OpenAiEmbeddingService, MockEmbeddingService],
    },
  ],
  exports: [EMBEDDING_PROVIDER],
})
export class EmbeddingsModule {}
