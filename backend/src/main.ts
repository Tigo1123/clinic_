import 'reflect-metadata';
import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { securityHeadersMiddleware, corsMiddleware } from './utils/edgeSecurity.js';
import { AppConfigService } from './modules/config/config.service.js';

dotenv.config();

export async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(AppConfigService);

  app.use(securityHeadersMiddleware(configService.isProduction));
  app.use(corsMiddleware(configService.allowedOrigins));

  app.setGlobalPrefix('api');
  const port = Number(process.env.PORT || process.env.NEST_PORT || 5000);
  await app.listen(port);
  console.log(`[NestJS] Application is running on port ${port}`);
  return app;
}

if (process.env.NODE_ENV !== 'test') {
  bootstrap().catch((err) => {
    console.error('NestJS bootstrap error:', err);
    process.exit(1);
  });
}
