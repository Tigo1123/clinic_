import jwt from 'jsonwebtoken';
import prisma from '../db.js';

export const ACCESS_TOKEN_ALGORITHM = 'HS256';
export const ACCESS_TOKEN_TYPE = 'access';

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

export function signAccessToken({ id, username, role, doctorId = null }) {
  return jwt.sign(
    { id, username, role, doctorId, typ: ACCESS_TOKEN_TYPE },
    jwtSecret(),
    {
      algorithm: ACCESS_TOKEN_ALGORITHM,
      audience: accessTokenAudience(),
      issuer: accessTokenIssuer(),
      subject: id,
      expiresIn: process.env.JWT_EXPIRES_IN || '8h'
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
    typeof decoded.role !== 'string'
  ) {
    throw new AccessTokenError('INVALID_TOKEN', 'Token is not a valid application access token.');
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
    select: { status: true, role: true }
  });

  if (!activeUser || activeUser.status !== 'ACTIVE' || activeUser.role !== decoded.role) {
    throw new AccessTokenError('SESSION_REVOKED', 'This session is no longer active.');
  }

  return decoded;
}
