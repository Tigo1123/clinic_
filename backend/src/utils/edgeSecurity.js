import cors from 'cors';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { ApiError, sendError } from './apiError.js';

export function markSensitiveResponse(res) {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  return res;
}

export function createCorsOptions(allowedOrigins) {
  return {
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new ApiError(403, 'CORS_ORIGIN_FORBIDDEN', 'Request origin is not allowed.'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  };
}

export function corsMiddleware(allowedOrigins) {
  return cors(createCorsOptions(allowedOrigins));
}

export function securityHeadersMiddleware(production) {
  return helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: production ? { maxAge: 31536000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'no-referrer' }
  });
}

export function createLoginLimiter({ windowMs, limit }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => sendError(res, 429, 'LOGIN_RATE_LIMITED', 'Too many login attempts. Please try again later.')
  });
}

export function createAdminResetLimiter({ windowMs, limit }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `${req.user?.id || 'anonymous'}:${ipKeyGenerator(req.ip)}`,
    handler: (req, res) => sendError(res, 429, 'ADMIN_RESET_RATE_LIMITED', 'Too many staff password reset attempts. Please try again later.')
  });
}
