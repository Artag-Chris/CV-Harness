import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { env } from './config/env';
import { JsonLogger } from './common/json-logger.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(JsonLogger));
  app.setGlobalPrefix('api');
  app.enableCors();

  await app.listen(env.PORT);
  const logger = app.get(JsonLogger);
  logger.log(
    { msg: 'cv-harness api escuchando', port: env.PORT, llmMode: env.llmMode },
    'Bootstrap',
  );
}

void bootstrap().catch((err) => {
  process.stderr.write(`FATAL: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
