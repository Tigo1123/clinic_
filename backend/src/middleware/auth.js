import jwt from 'jsonwebtoken';
import { sendError } from '../utils/apiError.js';
import prisma from '../db.js';

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required.');
  return secret;
}

/**
 * Middleware to verify JWT token.
 */
export async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendError(res, 401, 'AUTHENTICATION_REQUIRED', 'Access denied. No token provided.');
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, jwtSecret());
    const activeUser = await prisma.user.findUnique({ where: { id: decoded.id }, select: { status: true, role: true } });
    if (!activeUser || activeUser.status !== 'ACTIVE' || activeUser.role !== decoded.role) {
      return sendError(res, 401, 'SESSION_REVOKED', 'This session is no longer active.');
    }
    req.user = decoded; // { id, username, role }
    next();
  } catch (error) {
    return sendError(res, 401, 'INVALID_TOKEN', 'Invalid or expired token.');
  }
}

/**
 * Middleware builder to check allowed roles.
 */
export function checkRoles(...allowedRoles) {
  const roles = allowedRoles.flat();
  return (req, res, next) => {
    if (!req.user) {
      return sendError(res, 401, 'AUTHENTICATION_REQUIRED', 'Unauthenticated request.');
    }
    if (!roles.includes(req.user.role)) {
      return sendError(res, 403, 'FORBIDDEN', 'Unauthorized role. Access denied.');
    }
    next();
  };
}
