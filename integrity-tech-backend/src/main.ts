import './shared/observability/tracing.bootstrap';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { PrismaService } from './shared/database/prisma.service';
import { ApiExceptionFilter } from './shared/filters/api-exception.filter';
import { isCorsOriginAllowed, isSwaggerEnabled, parseAllowedOrigins, validateProductionSecurityConfig } from './shared/bootstrap/security-config';
import { StructuredLoggerService } from './shared/observability/structured-logger.service';
import { RequestContextService } from './shared/observability/request-context.service';
import { configureApiPrefix, createOpenApiDocument } from './openapi';

async function bootstrap() {
  validateProductionSecurityConfig(process.env);
  // Inicializar NestJS utilizando el adaptador de Express explícito
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const logger = app.get(StructuredLoggerService);
  app.useLogger(logger);
  
  app.enableShutdownHooks();
  app.disable('x-powered-by');
  app.use(helmet({
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginResourcePolicy: { policy: 'same-site' },
  }));
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    next();
  });

  const bodyLimit = process.env.API_BODY_LIMIT || '1mb';
  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ limit: bodyLimit, extended: true }));

  // Servir únicamente assets públicos de la aplicación. Evidencias sensibles usan StorageService privado.
  app.useStaticAssets(join(__dirname, '..', 'public'));

  // Establecer prefijo global de API
  configureApiPrefix(app);
  
  // Habilitar validaciones estructuradas globales (class-validator)
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
  }));
  app.useGlobalFilters(new ApiExceptionFilter(app.get(PrismaService), app.get(RequestContextService), logger));

  const allowedOrigins = parseAllowedOrigins(process.env.CORS_ORIGINS);
  app.enableCors({
    origin(origin, callback) {
      if (isCorsOriginAllowed(origin, allowedOrigins, process.env.NODE_ENV)) return callback(null, true);
      return callback(new Error('Origen CORS no permitido.'), false);
    },
    credentials: true,
  });

  // Configuración de la documentación interactiva Swagger / OpenAPI (restringido a dev/staging)
  const port = process.env.PORT || 3001;
  if (isSwaggerEnabled(process.env)) {
    const document = createOpenApiDocument(app);
    SwaggerModule.setup('api/docs', app, document);
    logger.info({ module: 'Bootstrap', action: 'swagger.enabled', message: `Swagger mounted on /api/docs` });
  }

  await app.listen(port);
  logger.info({ module: 'Bootstrap', action: 'api.started', message: `Integrity-Tech API listening on port ${port}` });
}
bootstrap();
