/**
 * Puerto del proveedor de embeddings (estilo atiende: la IA genera los
 * vectores). embed() recibe textos y devuelve vectores de dimensión fija
 * EMBEDDING_DIM (1536 = text-embedding-3-small). En modo 'mock' devuelve
 * vectores determinísticos para poder correr el E2E sin API key.
 */
export const EMBEDDING_DIM = 1536;

export interface EmbeddingProvider {
  readonly name: 'openai' | 'mock';
  embed(inputs: string[]): Promise<number[][]>;
}
