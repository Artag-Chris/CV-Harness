/**
 * Diccionario técnico compartido: lo usan el normalizador de vacantes (para
 * detectar skills sin IA) y el medidor de ATS (para descubrir keywords en el
 * texto crudo de la oferta, sin depender de que la IA las haya marcado).
 */
export const TECH_DICTIONARY = [
  'typescript', 'javascript', 'node', 'nest', 'nestjs', 'express', 'react', 'next', 'nextjs',
  'vue', 'angular', 'rust', 'python', 'go', 'java', 'php', 'c#', '.net', 'c++',
  'postgres', 'postgresql', 'mysql', 'mongodb', 'sqlite', 'redis', 'prisma', 'typeorm',
  'docker', 'kubernetes', 'k8s', 'aws', 'gcp', 'azure', 'nginx', 'terraform',
  'rabbitmq', 'kafka', 'bullmq', 'nats', 'websocket', 'graphql', 'rest', 'grpc',
  'llm', 'openai', 'anthropic', 'claude', 'groq', 'langchain', 'rag', 'pgvector',
  'puppeteer', 'playwright', 'scrapy', 'jwt', 'oauth', 'ci/cd', 'github actions', 'gitlab',
  'vitest', 'jest', 'cypress', 'tailwind', 'flutter', 'react native', 'linux', 'bash',
] as const;
