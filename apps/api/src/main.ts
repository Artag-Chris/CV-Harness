import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { env } from './config/env';
import { JsonLogger } from './common/json-logger.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(JsonLogger));
  app.setGlobalPrefix('api');
  app.enableCors();

  // Contrato OpenAPI: UI en /api/docs y JSON en /api/docs-json.
  const config = new DocumentBuilder()
    .setTitle('CV Harness API')
    .setDescription(
      'Vacantes → match semántico (pgvector) + IA por perfil → hoja de vida. Contrato versionado.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs-json',
  });

  const logger = app.get(JsonLogger);
  if (env.JWT_SECRET === 'dev-secret-change-me') {
    logger.warn(
      {
        msg: 'JWT_SECRET está en el valor por defecto: el dashboard de atiende dará 401 en la pestaña CV.',
        fix: 'Copiá el JWT_SECRET real de atiende en cv-harness/.env y recreá el contenedor api.',
      },
      'Bootstrap',
    );
  }

  await app.listen(env.PORT);
  logger.log(
    {
      msg: 'cv-harness api escuchando',
      port: env.PORT,
      llmMode: env.llmMode,
      docs: `/api/docs`,
    },
    'Bootstrap',
  );
}

void bootstrap().catch((err) => {
  process.stderr.write(`FATAL: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
