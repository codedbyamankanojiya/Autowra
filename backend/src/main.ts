import 'reflect-metadata';
import { Logger, RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { API_PREFIX } from '@autowra/shared-types';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AppConfigService } from './config/configuration';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  // `rawBody` keeps the untouched request bytes available, which gateway webhook signature
  // verification needs; re-serialising the parsed body would change the HMAC input.
  const app = await NestFactory.create(AppModule, { bufferLogs: false, rawBody: true });
  const config = app.get(AppConfigService);

  // Security headers. The API only serves JSON, so the HTML-oriented defaults are fine
  // and crossOriginResourcePolicy is relaxed for the mobile clients.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  /**
   * Request correlation. Every log line and error body carries the same id so a support
   * ticket can be traced back to the exact request that failed.
   */
  app.use((req: Request & { requestId?: string }, res: Response, next: NextFunction) => {
    const incoming = req.headers['x-request-id'];
    const requestId = (Array.isArray(incoming) ? incoming[0] : incoming) ?? randomUUID();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    next();
  });

  app.enableCors({
    // Native apps send no Origin header; the dashboard needs an allow-list in production.
    origin: config.app.isProduction ? (config.app.corsAllowedOrigins.length > 0 ? config.app.corsAllowedOrigins : false) : true,
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });

  app.setGlobalPrefix(API_PREFIX, {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });

  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  if (!config.app.isProduction) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Autowra API')
        .setDescription('On-demand car and bike care marketplace API')
        .setVersion('1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(config.app.port);
  logger.log(`Autowra API listening on http://localhost:${config.app.port}${API_PREFIX}`);
  if (!config.app.isProduction) {
    logger.log(`OpenAPI docs at http://localhost:${config.app.port}/api/docs`);
    if (config.auth.devAuthEnabled) {
      logger.warn(`Development sign-in is ENABLED - use OTP ${config.auth.devOtp} for any phone number.`);
    }
    if (config.payments.provider === 'mock') {
      logger.warn('The MOCK payment provider is active. No real money moves and every payment is flagged simulated.');
    }
  }
}

void bootstrap();
