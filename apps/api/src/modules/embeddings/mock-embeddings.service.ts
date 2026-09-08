import { Injectable } from '@nestjs/common';
import { EMBEDDING_DIM, EmbeddingProvider } from './embedding-provider.port';

/**
 * Embeddings determinísticos (sin red): hashea tokens y bigramas a un vector
 * unitario de EMBEDDING_DIM. El coseno resultante refleja solape léxico —
 * suficiente para el E2E y para probar el flujo vectorial sin API key.
 */
@Injectable()
export class MockEmbeddingService implements EmbeddingProvider {
  readonly name = 'mock' as const;

  async embed(inputs: string[]): Promise<number[][]> {
    return inputs.map((text) => this.vectorize(text));
  }

  private vectorize(text: string): number[] {
    const vec = new Array<number>(EMBEDDING_DIM).fill(0);
    const tokens = text.toLowerCase().split(/[^a-z0-9áéíóúñü]+/).filter(Boolean);
    const addToken = (token: string) => {
      let h1 = 0xcbf29ce484222325n;
      let h2 = 0x9e3779b97f4a7c15n;
      for (const ch of token) {
        const code = BigInt(ch.codePointAt(0) ?? 0);
        h1 ^= code;
        h1 = (h1 * 0x100000001b3n) & 0xffffffffffffffffn;
        h2 = (h2 * 0x100000001b3n + code + 0x9e3779b9n) & 0xffffffffffffffffn;
      }
      const i1 = Number(h1 % BigInt(EMBEDDING_DIM));
      const i2 = Number(h2 % BigInt(EMBEDDING_DIM));
      vec[i1] += 1;
      vec[i2] += 0.5;
    };
    for (const token of tokens) addToken(token);
    // Bigramas para capturar un poco de contexto local.
    for (let i = 0; i + 1 < tokens.length; i++) {
      addToken(`${tokens[i]}_${tokens[i + 1]}`);
    }
    return normalize(vec);
  }
}

function normalize(vec: number[]): number[] {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}
