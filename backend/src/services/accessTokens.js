import jwt from 'jsonwebtoken';
import prisma from '../db.js';
import { staffMfaRequired } from '../config.js';

export const ACCESS_TOKEN_ALGORITHM = 'HS256';
export const ACCESS_TOKEN_TYPE = 'access';
export const MFA_ENROLLMENT_TOKEN_TYPE = 'mfa-enrollment';
const STAFF_ROLES = new Set(['ADMIN', 'DOCTOR', 'RECEPTIONIST', 'PHARMACIST', 'LAB_TECH']);

export function staffRoleRequiresMfa(role, env = process.env) {
  return STAFF_ROLES.has(role) && staffMfaRequired(env);
}

export function accessTokenIssuer() {
  return process.env.JWT_ISSUER || 'clinic-api';
}

export function accessTokenAudience() {
  return process.env.JWT_AUDIENCE || 'clinic-application';
}

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required.');
  return secret;
}

export class AccessTokenError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AccessTokenError';
    this.code = code;
  }
}

function isValidAuthVersion(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function signAccessToken({ id, username, role, authVersion, doctorId = null }) {
  if (!isValidAuthVersion(authVersion)) {
    throw new AccessTokenError('INVALID_TOKEN_IDENTITY', 'A valid authoritative authentication version is required.');
  }
  return jwt.sign(
    { id, username, role, doctorId, av: authVersion, typ: ACCESS_TOKEN_TYPE },
    jwtSecret(),
    {
      algorithm: ACCESS_TOKEN_ALGORITHM,
      audience: accessTokenAudience(),
      issuer: accessTokenIssuer(),
      subject: id,
      expiresIn: process.env.JWT_EXPIRES_IN || '30m'
    }
  );
}

export function verifyAccessToken(token) {
  const decoded = jwt.verify(token, jwtSecret(), {
    algorithms: [ACCESS_TOKEN_ALGORITHM],
    audience: accessTokenAudience(),
    issuer: accessTokenIssuer()
  });

  if (
    decoded.typ !== ACCESS_TOKEN_TYPE ||
    typeof decoded.sub !== 'string' ||
    decoded.sub !== decoded.id ||
    typeof decoded.role !== 'string' ||
    !isValidAuthVersion(decoded.av)
  ) {
    throw new AccessTokenError('INVALID_TOKEN', 'Token is not a valid application access token.');
  }

  return decoded;
}

// This short-lived credential is intentionally a different token type from an
// application access token. It can only authorize the restricted enrollment
// endpoints and is invalidated by the authVersion increment after enrollment.
export function signMfaEnrollmentToken({ id, role, authVersion }) {
  if (typeof id !== 'string' || !STAFF_ROLES.has(role) || !isValidAuthVersion(authVersion)) {
    throw new AccessTokenError('INVALID_TOKEN_IDENTITY', 'A valid staff enrollment identity is required.');
  }
  return jwt.sign(
    { id, role, av: authVersion, typ: MFA_ENROLLMENT_TOKEN_TYPE, scope: 'staff:mfa:enroll' },
    jwtSecret(),
    { algorithm: ACCESS_TOKEN_ALGORITHM, audience: accessTokenAudience(), issuer: accessTokenIssuer(), subject: id, expiresIn: '10m' }
  );
}

export function verifyMfaEnrollmentToken(token) {
  const decoded = jwt.verify(token, jwtSecret(), {
    algorithms: [ACCESS_TOKEN_ALGORITHM],
    audience: accessTokenAudience(),
    issuer: accessTokenIssuer()
  });
  if (decoded.typ !== MFA_ENROLLMENT_TOKEN_TYPE || decoded.scope !== 'staff:mfa:enroll'
      || typeof decoded.sub !== 'string' || decoded.sub !== decoded.id
      || !STAFF_ROLES.has(decoded.role) || !isValidAuthVersion(decoded.av)) {
    throw new AccessTokenError('INVALID_TOKEN', 'Token is not a valid MFA enrollment credential.');
  }
  return decoded;
}

export async function verifyActiveAccessToken(token) {
  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch (error) {
    if (error instanceof AccessTokenError) throw error;
    throw new AccessTokenError('INVALID_TOKEN', 'Invalid or expired token.');
  }

  const activeUser = await prisma.user.findUnique({
    where: { id: decoded.sub },
    select: {
      status: true, role: true, authVersion: true, mustChangePassword: true,
      mfaEnabled: true, mfaConfiguration: { select: { state: true } }
    }
  });

  if (
    !activeUser ||
    activeUser.status !== 'ACTIVE' ||
    activeUser.role !== decoded.role ||
    activeUser.authVersion !== decoded.av
  ) {
    throw new AccessTokenError('SESSION_REVOKED', 'This session is no longer active.');
  }

  if (staffRoleRequiresMfa(activeUser.role)
      && (!activeUser.mfaEnabled || activeUser.mfaConfiguration?.state !== 'ACTIVE')) {
    throw new AccessTokenError('MFA_ENROLLMENT_REQUIRED', 'Staff MFA enrollment is required.');
  }

  return { ...decoded, mustChangePassword: activeUser.mustChangePassword };
}

export async function verifyActiveMfaEnrollmentToken(token) {
  let decoded;
  try {
    decoded = verifyMfaEnrollmentToken(token);
  } catch (error) {
    if (error instanceof AccessTokenError) throw error;
    throw new AccessTokenError('INVALID_TOKEN', 'Invalid or expired enrollment credential.');
  }
  const current = await prisma.user.findUnique({
    where: { id: decoded.sub },
    select: { id: true, username: true, role: true, status: true, authVersion: true, mfaEnabled: true, mfaConfiguration: { select: { state: true } } }
  });
  if (!current || current.status !== 'ACTIVE' || current.role !== decoded.role || current.authVersion !== decoded.av) {
    throw new AccessTokenError('SESSION_REVOKED', 'This enrollment is no longer active.');
  }
  if (!STAFF_ROLES.has(current.role) || current.mfaEnabled || current.mfaConfiguration?.state === 'ACTIVE') {
    throw new AccessTokenError('INVALID_TOKEN', 'MFA enrollment is not available for this account.');
  }
  return { id: current.id, username: current.username, role: current.role, av: current.authVersion };
}
