import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { markSensitiveResponse } from '../../utils/edgeSecurity.js';
import { logger } from '../../utils/logger.js';
import {
  AccessTokenError,
  verifyActiveAccessToken,
} from '../../services/accessTokens.js';
import {
  PRE_AUTH_MIDDLEWARE_KEY,
  runExpressMiddleware,
} from './express-middleware.guard.js';

/**
 * Mirrors src/middleware/auth.js (createAuthenticate): the same token verification,
 * the same req.user shape and the same error envelopes. Role checks live in RolesGuard.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return true;
    }

    const ctx = context.switchToHttp();
    const req = ctx.getRequest();
    const res = ctx.getResponse();

    // Pre-auth middleware (e.g. login/MFA limiters) runs before token checks,
    // as in Express `router.post(path, limiter, authenticate, ...)`.
    const preAuth = this.reflector.getAllAndOverride<any[] | undefined>(PRE_AUTH_MIDDLEWARE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (preAuth && preAuth.length > 0) {
      if (!(await runExpressMiddleware(preAuth, req, res))) {
        return false;
      }
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    // Every route that requires a bearer token is sensitive, including denials.
    markSensitiveResponse(res);

    const authHeader = req.headers?.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Access denied. No token provided.',
        },
      });
    }

    const token = authHeader.split(' ')[1];

    try {
      req.user = await verifyActiveAccessToken(token);
    } catch (error: any) {
      if (error instanceof AccessTokenError) {
        if (error.code === 'SESSION_REVOKED') {
          throw new UnauthorizedException({
            error: { code: error.code, message: error.message },
          });
        }
        throw new UnauthorizedException({
          error: {
            code: 'INVALID_TOKEN',
            message: 'Invalid or expired token.',
          },
        });
      }

      // Not a token problem: a dependency failed. Do not claim the token is invalid.
      logger.error('auth.verification_unavailable', {
        error: { name: error?.name, message: error?.message },
      });
      res.set('Retry-After', '5');
      throw new ServiceUnavailableException({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'The service is temporarily unavailable. Please try again.',
        },
      });
    }

    return true;
  }
}
