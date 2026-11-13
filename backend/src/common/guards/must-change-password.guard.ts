import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';

const ALLOWED_PATHS = ['/api/auth/change-password', '/api/auth/logout'];

@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request & { user?: { mustChangePassword?: boolean } }>();
    if (!req.user || !req.user.mustChangePassword) {
      return true;
    }

    // Same exact-path comparison as src/middleware/auth.js.
    const path = (req.originalUrl || req.url).split('?')[0];
    if (ALLOWED_PATHS.includes(path)) {
      return true;
    }

    throw new ForbiddenException({
      error: {
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'You must change your password before accessing clinic services.',
      },
    });
  }
}
