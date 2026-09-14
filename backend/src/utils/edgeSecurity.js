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
  const helmetMiddleware = helmet({
    contentSecurityPolicy: production ? {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        upgradeInsecureRequests: []
      }
    } : false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    frameguard: { action: 'deny' },
    // TLS terminates at the frontend edge in the supported deployment, which
    // owns HSTS for both document and proxied API responses.
    hsts: false,
    referrerPolicy: { policy: 'no-referrer' },
    permittedCrossDomainPolicies: { permittedPolicies: 'none' }
  });

  // Helmet 8 does not yet provide Permissions-Policy middleware. Set the
  // restrictive policy explicitly so proxied API responses match the edge.
  return (req, res, next) => helmetMiddleware(req, res, (error) => {
    if (error) return next(error);
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    return next();
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
