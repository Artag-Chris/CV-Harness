import { Injectable } from '@nestjs/common';
import { env } from '../../config/env';
import { JsonLogger } from '../../common/json-logger.service';
import { EMBEDDING_DIM, EmbeddingProvider } from './embedding-provider.port';

const OPENAI_BASE = 'https://api.openai.com/v1';
const TIMEOUT_MS = 60_000;

interface OpenAiEmbeddingResponse {
  data?: { embedding?: number[] }[];
}

@Injectable()
export class OpenAiEmbeddingService implements EmbeddingProvider {
  readonly name = 'openai' as const;

  constructor(private readonly logger: JsonLogger) {}

  async embed(inputs: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    // OpenAI cobra por request; batch de a 32 textos.
    for (let i = 0; i < inputs.length; i += 32) {
      const batch = inputs.slice(i, i + 32);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(`${OPENAI_BASE}/embeddings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          },
          signal: controller.signal,
          body: JSON.stringify({ model: env.EMBEDDING_MODEL, input: batch }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`OpenAI embeddings HTTP ${res.status}: ${body.slice(0, 300)}`);
        }
        const data = (await res.json()) as OpenAiEmbeddingResponse;
        if (!data.data || data.data.length !== batch.length) {
          throw new Error('OpenAI embeddings: respuesta incompleta');
        }
        for (const item of data.data) {
          const vec = item.embedding;
          if (!vec || vec.length !== EMBEDDING_DIM) {
            throw new Error(`OpenAI embeddings: dimensión inesperada (${vec?.length})`);
          }
          vectors.push(vec);
        }
      } finally {
        clearTimeout(timer);
      }
    }
    return vectors;
  }
}
