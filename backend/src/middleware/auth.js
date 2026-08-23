import { sendError } from '../utils/apiError.js';
import { AccessTokenError, verifyActiveAccessToken } from '../services/accessTokens.js';

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
    req.user = await verifyActiveAccessToken(token);
    next();
  } catch (error) {
    if (error instanceof AccessTokenError && error.code === 'SESSION_REVOKED') {
      return sendError(res, 401, error.code, error.message);
    }
    return sendError(res, 401, 'INVALID_TOKEN', 'Invalid or expired token.');
  }
}

export async function authenticateSocketAccessToken(socket, next) {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) {
      const error = new Error('Authentication required.');
      error.data = { code: 'AUTHENTICATION_REQUIRED' };
      return next(error);
    }
    socket.user = await verifyActiveAccessToken(token);
    return next();
  } catch (error) {
    if (error instanceof AccessTokenError && error.code === 'SESSION_REVOKED') {
      const socketError = new Error('Session is no longer active.');
      socketError.data = { code: 'SESSION_REVOKED' };
      return next(socketError);
    }
    const socketError = new Error('Invalid or expired token.');
    socketError.data = { code: 'INVALID_TOKEN' };
    return next(socketError);
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
