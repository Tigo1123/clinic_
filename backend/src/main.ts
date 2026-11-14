import 'reflect-metadata';
import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { securityHeadersMiddleware, corsMiddleware } from './utils/edgeSecurity.js';
import { AppConfigService } from './modules/config/config.service.js';
import { logger } from './utils/logger.js';

dotenv.config();

/**
 * Builds the Nest app with the same HTTP edge as the Express server (src/server.js):
 * no X-Powered-By, one-hop proxy trust only when TRUST_PROXY=true, security headers,
 * CORS, and the /api prefix. Tests call this so they boot exactly what production runs.
 */
export async function createApp(options: { logger?: false } = {}) {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, options);
  const configService = app.get(AppConfigService);

  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
  app.use(securityHeadersMiddleware(configService.isProduction));
  app.use(corsMiddleware(configService.allowedOrigins));
  app.setGlobalPrefix('api');
  return app;
}

/**
 * app.close() runs the lifecycle hooks in the same order as shutdown() in src/server.js:
 * socket revocation stops (onModuleDestroy), HTTP and Socket.IO close, then Prisma
 * disconnects (onApplicationShutdown). Handled here rather than with
 * enableShutdownHooks() so the process logs the shutdown and exits 0 like Express.
 */
export function handleShutdownSignals(app: { close(): Promise<void> }, exit = (code: number) => process.exit(code)) {
  let shuttingDown = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info('server.shutdown_started', { signal });
      app.close()
        .then(() => {
          logger.info('server.shutdown_complete', { signal });
          exit(0);
        })
        .catch((error) => {
          logger.error('server.shutdown_failed', { signal, error });
          exit(1);
        });
    });
  }
}

export async function bootstrap() {
  const app = await createApp();
  const port = Number(process.env.PORT || 5000);
  await app.listen(port);
  handleShutdownSignals(app);
  logger.info('server.started', { port, environment: process.env.NODE_ENV || 'development', server: 'nest' });
  return app;
}

if (process.env.NODE_ENV !== 'test') {
  bootstrap().catch((error) => {
    logger.error('server.start_failed', { error });
    process.exit(1);
  });
}
