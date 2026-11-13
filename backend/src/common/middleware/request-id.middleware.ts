import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../../utils/logger.js';

/**
 * Assigns the request id and writes the http.request log line on response finish,
 * the same as src/server.js. Logging here (not in an interceptor) means requests
 * rejected by guards or pipes are logged too.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request & { id?: string; user?: { id?: string } }, res: Response, next: NextFunction) {
    req.id = (req.get('x-request-id') as string) || crypto.randomUUID();
    res.setHeader('X-Request-ID', req.id);
    const startedAt = Date.now();
    res.on('finish', () =>
      logger.info('http.request', {
        requestId: req.id,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
        userId: req.user?.id,
      }),
    );
    next();
  }
}
