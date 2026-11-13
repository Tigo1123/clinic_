import { applyDecorators, SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const ROLES_VARIANT_KEY = 'rolesVariant';

/**
 * 'check'  = src/middleware/auth.js checkRoles(): 401 "Unauthenticated request.",
 *            403 "Unauthorized role. Access denied."
 * 'policy' = src/middleware/policies.js allowRoles(): 401 "Authentication is required.",
 *            403 "You do not have permission to perform this action."
 */
export type RolesVariant = 'check' | 'policy';

const rolesWithVariant =
  (variant: RolesVariant) =>
  (...roles: (string | string[])[]) =>
    applyDecorators(
      SetMetadata(ROLES_KEY, roles.flat()),
      SetMetadata(ROLES_VARIANT_KEY, variant),
    );

/** Express checkRoles(...). */
export const Roles = rolesWithVariant('check');

/** Express allowRoles(...). */
export const PolicyRoles = rolesWithVariant('policy');
