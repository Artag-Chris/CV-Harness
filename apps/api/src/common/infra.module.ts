import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '../config/env';
import { REDIS } from '../config/tokens';
import { JsonLogger } from './json-logger.service';
import { PrismaService } from './prisma.service';

/**
 * Infraestructura global: Prisma (Postgres), Redis (streams + locks) y logger.
 * BullMQ maneja sus propias conexiones (ver queue.config.ts).
 */
@Global()
@Module({
  providers: [
    JsonLogger,
    PrismaService,
    {
      provide: REDIS,
      useFactory: () =>
        new Redis(env.REDIS_URL, {
          maxRetriesPerRequest: null,
          enableReadyCheck: true,
        }),
    },
  ],
  exports: [JsonLogger, PrismaService, REDIS],
})
export class InfraModule {}
