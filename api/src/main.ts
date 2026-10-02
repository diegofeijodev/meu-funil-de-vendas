import { BadRequestException, Logger, ValidationError, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import { AppModule } from './app.module';
import { validateEnv } from './common/config/env.validation';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

const logger = new Logger('Bootstrap');

function flattenErrors(errors: ValidationError[], path = ''): string {
  return errors
    .flatMap((e) => {
      const campo = path ? `${path}.${e.property}` : e.property;
      const proprias = Object.values(e.constraints ?? {}).map((m) => `${campo}: ${m}`);
      const filhas = e.children?.length ? [flattenErrors(e.children, campo)] : [];
      return [...proprias, ...filhas];
    })
    .filter(Boolean)
    .join(' | ');
}

async function bootstrap() {
  // `trustProxy` é opção de construção do Fastify (antes de existir ConfigService).
  const env = validateEnv(process.env);

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: { timestamp: () => `,"time":"${new Date().toISOString()}"` },
      bodyLimit: 8 * 1024 * 1024,
      // Atrás de nginx, `true`: sem isso `req.ip` é o do proxy e o throttle vira um balde global.
      trustProxy: env.TRUST_PROXY,
    }),
  );

  await app.register(helmet as never, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: [`'self'`],
        styleSrc: [`'self'`, `'unsafe-inline'`],
        imgSrc: [`'self'`, 'data:', 'validator.swagger.io'],
        scriptSrc: [`'self'`, `https:`, `'unsafe-inline'`],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  // Upload de mídia (imagem/vídeo/PDF) do navegador: o teto de 100 MB é o do vídeo;
  // o controller aplica o teto por tipo (imagem 20 MB, PDF 10 MB).
  await app.register(multipart as never, { limits: { fileSize: 100 * 1024 * 1024, files: 1 } });

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => new BadRequestException({ code: 'VALIDATION_ERROR', message: flattenErrors(errors) }),
    }),
  );

  const allowedOrigins = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  if (env.NODE_ENV !== 'production' || env.SWAGGER_ENABLED === 'true') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Meu Funil — API')
      .setDescription('Contrato canônico em docs/api-contract.md.')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
      .build();
    SwaggerModule.setup('docs', app as never, SwaggerModule.createDocument(app as never, swaggerConfig), {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  await app.listen(env.PORT, '0.0.0.0');
  logger.log(`Meu Funil API: http://localhost:${env.PORT}`);
}

void bootstrap();
