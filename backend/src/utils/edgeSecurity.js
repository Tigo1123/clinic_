import cors from 'cors';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { ApiError, sendError } from './apiError.js';
import { rateLimitStore } from '../services/rateLimitStore.js';
import { recordRateLimitEvent } from './observability.js';

const registeredLimiters = new Set();
function registerLimiter(options) {
  if (process.env.NODE_ENV === 'test') {
    const keys = new Set();
    const originalKeyGenerator = options.keyGenerator || ((request) => ipKeyGenerator(request.ip));
    const limiter = rateLimit({
      ...options,
      keyGenerator(request, response) {
        const key = originalKeyGenerator(request, response);
        keys.add(key);
        return key;
      }
    });
    limiter.resetAllForTests = async () => {
      await Promise.all([...keys].map((key) => limiter.resetKey(key)));
      keys.clear();
    };
    registeredLimiters.add(limiter);
    return limiter;
  }
  const limiter = rateLimit(options);
  registeredLimiters.add(limiter);
  return limiter;
}

// Tests share one Express app for many cases, so reset limiter stores between
// cases without changing limits or behavior within an individual scenario.
export async function resetTestRateLimiters() {
  if (process.env.NODE_ENV !== 'test') return;
  await Promise.all([...registeredLimiters].map((limiter) => limiter.resetAllForTests?.()));
}

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
    exposedHeaders: ['X-Page', 'X-Page-Size', 'X-Has-More', 'X-Total-Count'],
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

export function createLoginLimiter({ windowMs, limit, prefix = 'login' }) {
  return registerLimiter({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    passOnStoreError: false,
    store: rateLimitStore(prefix, windowMs),
    handler: (req, res) => {
      recordRateLimitEvent(prefix);
      return sendError(res, 429, 'LOGIN_RATE_LIMITED', 'Too many login attempts. Please try again later.');
    }
  });
}

export function createAdminResetLimiter({ windowMs, limit }) {
  return registerLimiter({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    passOnStoreError: false,
    store: rateLimitStore('admin-password-reset', windowMs),
    keyGenerator: (req) => `${req.user?.id || 'anonymous'}:${ipKeyGenerator(req.ip)}`,
    handler: (req, res) => {
      recordRateLimitEvent('admin-password-reset');
      return sendError(res, 429, 'ADMIN_RESET_RATE_LIMITED', 'Too many staff password reset attempts. Please try again later.');
    }
  });
}

export function createAuthenticatedMutationLimiter({ windowMs = 60_000, limit = 120, prefix = 'authenticated-mutation' } = {}) {
  return registerLimiter({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    passOnStoreError: false,
    store: rateLimitStore(prefix, windowMs),
    keyGenerator: (req) => `${req.user?.id || 'anonymous'}:${ipKeyGenerator(req.ip)}`,
    handler: (req, res) => {
      recordRateLimitEvent(prefix);
      return sendError(res, 429, 'MUTATION_RATE_LIMITED', 'Too many changes were submitted. Please try again later.');
    }
  });
}
