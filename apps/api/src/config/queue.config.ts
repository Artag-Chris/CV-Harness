import { env } from './env';

/**
 * Colas BullMQ (pipeline interno de Nest) y Streams Redis (frontera Nest↔Rust).
 * Los streams no llevan prefijo para que el worker Rust los lea con nombres
 * estables; las colas llevan QUEUE_PREFIX para aislar entornos que compartan
 * un mismo Redis.
 */
export const QUEUES = {
  CRAWL: 'crawl',
  NORMALIZE: 'normalize',
  MATCH: 'match',
  RESUME: 'resume',
  NOTIFICATION: 'notification',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const STREAMS = {
  REQUESTS: 'scraper:requests', // Nest → Rust (dispatch de scraping)
  RESULTS: 'scraper:results', // Rust → Nest (resultados)
} as const;

export const STREAM_GROUPS = {
  INGEST: 'ingest', // grupo de consumo de Nest sobre scraper:results
} as const;

/**
 * BullMQ prohíbe ':' dentro del nombre de cola; el prefijo de entorno se pasa
 * como opción raíz ("prefix") de Bull para aislar llaves en Redis.
 */
export const queueName = (name: QueueName): string => name;

const parsedRedis = new URL(env.REDIS_URL);

/** Conexión compartida para BullMQ (worker + producer). */
export const bullConnection = {
  prefix: env.QUEUE_PREFIX,
  connection: {
    host: parsedRedis.hostname,
    port: Number(parsedRedis.port || 6379),
    username: parsedRedis.username ? decodeURIComponent(parsedRedis.username) : undefined,
    password: parsedRedis.password ? decodeURIComponent(parsedRedis.password) : undefined,
    maxRetriesPerRequest: null,
  },
};
