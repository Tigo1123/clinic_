import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, ROLES_VARIANT_KEY, RolesVariant } from '../decorators/roles.decorator.js';

/** Exact Express bodies for each role middleware variant. */
const ROLE_ERRORS: Record<
  RolesVariant,
  { unauthenticated: { code: string; message: string }; forbidden: { code: string; message: string } }
> = {
  // checkRoles() in src/middleware/auth.js
  check: {
    unauthenticated: { code: 'AUTHENTICATION_REQUIRED', message: 'Unauthenticated request.' },
    forbidden: { code: 'FORBIDDEN', message: 'Unauthorized role. Access denied.' },
  },
  // allowRoles() in src/middleware/policies.js
  policy: {
    unauthenticated: { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication is required.' },
    forbidden: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action.' },
  },
};

/**
 * Mirrors checkRoles() (@Roles) and allowRoles() (@PolicyRoles). Runs after the global
 * JwtAuthGuard and MustChangePasswordGuard, the same order as Express (authenticate, then role check).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') {
      return true;
    }

    const handlerAndClass = [context.getHandler(), context.getClass()];
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, handlerAndClass);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const variant =
      this.reflector.getAllAndOverride<RolesVariant>(ROLES_VARIANT_KEY, handlerAndClass) ?? 'check';
    const errors = ROLE_ERRORS[variant];

    const req = context.switchToHttp().getRequest<{ user?: { role?: string } }>();
    if (!req.user) {
      throw new UnauthorizedException({
        error: { code: errors.unauthenticated.code, message: errors.unauthenticated.message },
      });
    }

    if (!requiredRoles.includes(req.user.role as string)) {
      throw new ForbiddenException({
        error: { code: errors.forbidden.code, message: errors.forbidden.message },
      });
    }

    return true;
  }
}
