import { CanActivate, ExecutionContext, Injectable, SetMetadata, Type, mixin } from '@nestjs/common';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Middleware that must run BEFORE authentication (Express order like
 * `router.post(path, limiter, authenticate, ...)`). The global JwtAuthGuard
 * reads this metadata and runs the handlers via runExpressMiddleware() first,
 * so over-limit requests get the limiter's 429 instead of a 401.
 */
export const PRE_AUTH_MIDDLEWARE_KEY = 'preAuthMiddleware';
export const PreAuthMiddleware = (...handlers: RequestHandler[]) =>
  SetMetadata(PRE_AUTH_MIDDLEWARE_KEY, handlers);

/** Runs Express middleware in order. Returns false if one ended the response. */
export async function runExpressMiddleware(
  handlers: RequestHandler[],
  req: Request,
  res: Response,
): Promise<boolean> {
  for (const handler of handlers) {
    let nextCalled = false;
    let nextError: unknown;
    const next: NextFunction = (err?: unknown) => {
      nextCalled = true;
      nextError = err;
    };
    await handler(req, res, next);
    if (nextError) throw nextError;
    if (!nextCalled) return false;
  }
  return true;
}

/**
 * Runs existing Express middleware (e.g. express-rate-limit limiters from
 * utils/edgeSecurity.js or the route files) as a NestJS guard, so their exact
 * status codes and error envelopes are preserved.
 *
 * Usage (method level, runs after class-level JwtAuthGuard so req.user is set):
 *   @UseGuards(ExpressMiddlewareGuard(loginLimiter))
 *
 * If a middleware ends the response itself (e.g. a 429 handler), the guard
 * returns false; ApiExceptionFilter sees headersSent and leaves it untouched.
 */
export function ExpressMiddlewareGuard(...handlers: RequestHandler[]): Type<CanActivate> {
  @Injectable()
  class ExpressMiddlewareGuardMixin implements CanActivate {
    async canActivate(context: ExecutionContext): Promise<boolean> {
      const http = context.switchToHttp();
      return runExpressMiddleware(handlers, http.getRequest<Request>(), http.getResponse<Response>());
    }
  }

  return mixin(ExpressMiddlewareGuardMixin);
}
