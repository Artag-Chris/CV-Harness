import 'dotenv/config';
import { z } from 'zod';

/**
 * Configuración de entorno validada al boot (fail-fast, patrón de atiende).
 * LLM_PROVIDER=auto usa groq si hay GROQ_API_KEY; si no, cae a 'mock'
 * (determinístico, sin red) para poder correr el pipeline E2E sin llave.
 */
const envSchema = z.object({
  PORT: z.coerce.number().default(3100),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgresql://cvharness:cvharness@localhost:5433/cvharness'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6380'),
  QUEUE_PREFIX: z.string().default('cvharness'),
  GROQ_API_KEY: z.string().default(''),
  GROQ_MODEL: z.string().default('llama-3.3-70b-versatile'),
  // DeepSeek (IA principal del harness; OpenAI-compatible).
  DEEPSEEK_API_KEY: z.string().default(''),
  DEEPSEEK_MODEL: z.string().default('deepseek-chat'),
  // Embeddings estilo atiende (OpenAI text-embedding-3-small → 1536 dims).
  OPENAI_API_KEY: z.string().default(''),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  JWT_SECRET: z.string().default('dev-secret-change-me'),
  JWT_EXPIRES_IN: z.string().default('1d'),
  ADMIN_EMAIL: z.string().email().default('admin@cvharness.local'),
  ADMIN_PASSWORD: z.string().min(6).default('admin1234'),
  CRON_INTERVAL_MINUTES: z.coerce.number().default(15),
  MATCH_MIN_SCORE: z.coerce.number().default(65),
  FIXTURE_BASE_URL: z.string().default('http://localhost:8090'),
  LLM_PROVIDER: z.enum(['auto', 'groq', 'deepseek', 'mock']).default('auto'),
  EMBEDDING_PROVIDER: z.enum(['auto', 'openai', 'mock']).default('auto'),
});

export type RawEnv = z.infer<typeof envSchema>;
export type LlmMode = 'deepseek' | 'groq' | 'mock';
export type EmbedMode = 'openai' | 'mock';
export type Env = RawEnv & { llmMode: LlmMode; embedMode: EmbedMode };

/**
 * REDIS_URL se puede setear directo, o derivarse de REDIS_HOST/REDIS_PORT/
 * REDIS_PASSWORD (mismo patrón que atiende). Así cv-harness reutiliza la
 * misma Redis compartida del server sin duplicar config.
 */
export function resolveRedisUrl(input: NodeJS.ProcessEnv): string {
  if (input.REDIS_URL) return input.REDIS_URL;
  const host = input.REDIS_HOST;
  if (!host) return 'redis://localhost:6380';
  const port = input.REDIS_PORT ?? '6379';
  const pass = input.REDIS_PASSWORD;
  const auth = pass ? `:${encodeURIComponent(pass)}@` : '';
  return `redis://${auth}${host}:${port}`;
}

export function parseEnv(input: NodeJS.ProcessEnv = process.env): Env {
  const resolved = { ...input };
  resolved.REDIS_URL ??= resolveRedisUrl(input);
  const parsed = envSchema.parse(resolved);
  // Orden: explícito > auto (deepseek > groq) > mock (E2E sin llaves).
  const llmMode: LlmMode =
    parsed.LLM_PROVIDER === 'deepseek' ||
    (parsed.LLM_PROVIDER === 'auto' && parsed.DEEPSEEK_API_KEY.length > 0)
      ? 'deepseek'
      : parsed.LLM_PROVIDER === 'groq' ||
          (parsed.LLM_PROVIDER === 'auto' && parsed.GROQ_API_KEY.length > 0)
        ? 'groq'
        : 'mock';
  const embedMode: EmbedMode =
    parsed.EMBEDDING_PROVIDER === 'mock' ||
    (parsed.EMBEDDING_PROVIDER === 'auto' && parsed.OPENAI_API_KEY.length === 0)
      ? 'mock'
      : 'openai';
  return { ...parsed, llmMode, embedMode };
}

/** Instancia global parseada una vez (dotenv/config carga apps/api/.env). */
export const env: Env = parseEnv();
