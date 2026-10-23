import 'dotenv/config';
import { DEFAULT_CLINIC_TIME_ZONE, isValidClinicTimeZone } from './utils/clinicTime.js';
import { readSmtpConfig } from './utils/smtpConfig.js';
import { getFacilityBranding } from './utils/facilityBranding.js';

const INSECURE_SECRETS = new Set([
  'secret', 'changeme', 'development-secret',
  'replace-with-a-long-random-jwt-signing-secret',
  'replace-with-a-separate-long-random-medical-encryption-key',
  'replace-with-a-dedicated-long-random-mfa-encryption-key'
]);

function csv(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function positiveInteger(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

export function configuredGoogleClientId(env = process.env) {
  const value = String(env.GOOGLE_CLIENT_ID || '').trim();
  return value || null;
}

export function canonicalProductionOrigin(origin) {
  if (origin === '*' || !origin.startsWith('https://')) return null;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) return null;
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
    if (origin === parsed.origin) return parsed.origin;
    if (origin.endsWith(':443') && parsed.origin === origin.slice(0, -4)) return parsed.origin;
    return null;
  } catch {
    return null;
  }
}

export function isCanonicalProductionOrigin(origin) {
  return canonicalProductionOrigin(origin) !== null;
}

export function staffMfaRequired(env = process.env) {
  return env.NODE_ENV === 'production' || env.STAFF_MFA_POLICY === 'required';
}

export function validateEnvironment() {
  const production = process.env.NODE_ENV === 'production';
  const staffMfaPolicy = process.env.STAFF_MFA_POLICY || (production ? 'required' : 'optional');
  const errors = [];
  const databaseUrl = process.env.DATABASE_URL;
  const jwtSecret = process.env.JWT_SECRET;
  const encryptionKey = process.env.MEDICAL_ENCRYPTION_KEY;
  const mfaEncryptionKey = process.env.MFA_ENCRYPTION_KEY;
  const socketRevocationDatabaseUrl = process.env.SOCKET_REVOCATION_DATABASE_URL || (!production ? databaseUrl : '');
  const origins = csv(process.env.CORS_ALLOWED_ORIGINS);
  const rateLimitStore = process.env.RATE_LIMIT_STORE || (production ? 'postgres' : 'memory');
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS);
  const runtimeDatabaseRole = String(process.env.RUNTIME_DATABASE_ROLE || '').trim();
  const clinicTimeZone = process.env.CLINIC_TIME_ZONE || (production ? '' : DEFAULT_CLINIC_TIME_ZONE);
  let facilityBranding;
  try { facilityBranding = getFacilityBranding(); }
  catch (error) { errors.push(error.message); }

  if (!databaseUrl || !/^postgres(?:ql)?:\/\//.test(databaseUrl)) errors.push('DATABASE_URL must be a valid PostgreSQL URL.');
  if (!['postgres', 'memory'].includes(rateLimitStore) || (production && rateLimitStore !== 'postgres')) {
    errors.push('RATE_LIMIT_STORE must be postgres in production; memory is allowed only outside production.');
  }
  if (production && (!Number.isInteger(trustProxyHops) || trustProxyHops < 1 || trustProxyHops > 5)) {
    errors.push('TRUST_PROXY_HOPS must explicitly match the production ingress hop count (1 to 5).');
  }
  if (!['required', 'optional'].includes(staffMfaPolicy)) errors.push('STAFF_MFA_POLICY must be required or optional.');
  if (production && staffMfaPolicy !== 'required') errors.push('STAFF_MFA_POLICY must be required in production.');
  if (!jwtSecret) errors.push('JWT_SECRET is required.');
  if (!encryptionKey) errors.push('MEDICAL_ENCRYPTION_KEY is required.');
  if (!clinicTimeZone) errors.push('CLINIC_TIME_ZONE is required in production.');
  else if (!isValidClinicTimeZone(clinicTimeZone)) errors.push('CLINIC_TIME_ZONE must be a valid IANA timezone.');
  if (!socketRevocationDatabaseUrl || !/^postgres(?:ql)?:\/\//.test(socketRevocationDatabaseUrl)) {
    errors.push('SOCKET_REVOCATION_DATABASE_URL must be a direct PostgreSQL URL.');
  }
  if (socketRevocationDatabaseUrl && /(?:pgbouncer=true|pool_mode=transaction)/i.test(socketRevocationDatabaseUrl)) {
    errors.push('SOCKET_REVOCATION_DATABASE_URL must not use transaction pooling.');
  }
  if (!production && process.env.VERIFICATION_PROVIDER === 'development'
      && !['development', 'test'].includes(process.env.NODE_ENV)) {
    errors.push('VERIFICATION_PROVIDER=development requires NODE_ENV=development or test. Set NODE_ENV explicitly, or configure VERIFICATION_PROVIDER=email with SMTP.');
  }

  if (production) {
    try {
      const runtimeUrl = new URL(databaseUrl);
      const runtimePool = Number(runtimeUrl.searchParams.get('connection_limit'));
      if (!/-pooler\./i.test(runtimeUrl.hostname)) errors.push('Production DATABASE_URL must use the Neon pooled hostname.');
      if (!/\.neon\.(?:tech|build)$/i.test(runtimeUrl.hostname)) errors.push('Production DATABASE_URL must target the reviewed Neon PostgreSQL service.');
      if (runtimeUrl.pathname !== '/neondb') errors.push('Production DATABASE_URL must target database neondb.');
      if ((runtimeUrl.searchParams.get('schema') || 'public') !== 'public') errors.push('Production DATABASE_URL must target schema public.');
      if (!['require', 'verify-full'].includes(runtimeUrl.searchParams.get('sslmode'))) errors.push('Production DATABASE_URL must require TLS with sslmode=require or verify-full.');
      if (!Number.isInteger(runtimePool) || runtimePool < 1 || runtimePool > 20) errors.push('Production DATABASE_URL must set connection_limit between 1 and 20.');
      const poolTimeout = Number(runtimeUrl.searchParams.get('pool_timeout'));
      if (!Number.isInteger(poolTimeout) || poolTimeout < 1 || poolTimeout > 60) errors.push('Production DATABASE_URL must set pool_timeout between 1 and 60 seconds.');
    } catch {
      errors.push('Production DATABASE_URL must be a valid Neon pooled PostgreSQL URL.');
    }
    try {
      const listenerUrl = new URL(socketRevocationDatabaseUrl);
      if (/pooler\./i.test(listenerUrl.hostname)) errors.push('SOCKET_REVOCATION_DATABASE_URL must use a direct, non-pooled Neon hostname.');
      if (!/\.neon\.(?:tech|build)$/i.test(listenerUrl.hostname)) errors.push('SOCKET_REVOCATION_DATABASE_URL must target the reviewed Neon PostgreSQL service.');
      if (listenerUrl.pathname !== '/neondb') errors.push('SOCKET_REVOCATION_DATABASE_URL must target database neondb.');
      if ((listenerUrl.searchParams.get('schema') || 'public') !== 'public') errors.push('SOCKET_REVOCATION_DATABASE_URL must target schema public.');
      if (!['require', 'verify-full'].includes(listenerUrl.searchParams.get('sslmode'))) errors.push('SOCKET_REVOCATION_DATABASE_URL must require TLS with sslmode=require or verify-full.');
    } catch {
      errors.push('SOCKET_REVOCATION_DATABASE_URL must be a valid direct PostgreSQL URL.');
    }
    if (!/^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/.test(runtimeDatabaseRole)) errors.push('RUNTIME_DATABASE_ROLE must name the expected least-privilege production login role.');
    if (!jwtSecret || jwtSecret.length < 32 || INSECURE_SECRETS.has(jwtSecret.toLowerCase())) errors.push('JWT_SECRET must be a unique secret of at least 32 characters.');
    if (!encryptionKey || encryptionKey.length < 32 || INSECURE_SECRETS.has(encryptionKey.toLowerCase())) errors.push('MEDICAL_ENCRYPTION_KEY must be a separate secret of at least 32 characters.');
    if (!mfaEncryptionKey || mfaEncryptionKey.length < 32 || INSECURE_SECRETS.has(mfaEncryptionKey.toLowerCase())) errors.push('MFA_ENCRYPTION_KEY must be a separate secret of at least 32 characters.');
    if (jwtSecret && encryptionKey && jwtSecret === encryptionKey) errors.push('JWT_SECRET and MEDICAL_ENCRYPTION_KEY must be different.');
    if (mfaEncryptionKey && [jwtSecret, encryptionKey].includes(mfaEncryptionKey)) errors.push('MFA_ENCRYPTION_KEY must be different from JWT_SECRET and MEDICAL_ENCRYPTION_KEY.');
    if (!origins.length) errors.push('CORS_ALLOWED_ORIGINS must list trusted HTTPS origins.');
    if (origins.some((origin) => !isCanonicalProductionOrigin(origin))) errors.push('Production CORS origins must be canonical explicit HTTPS origins and cannot use wildcards.');
    if (process.env.VERIFICATION_PROVIDER === 'development') errors.push('The development verification provider is forbidden in production.');
    if (process.env.VERIFICATION_PROVIDER === 'email') {
      try {
        readSmtpConfig(process.env, { required: true });
      } catch (error) {
        errors.push(error.message);
      }
      if (process.env.NOTIFICATIONS_DISABLED === 'true') errors.push('NOTIFICATIONS_DISABLED cannot be true when email verification is enabled.');
    }
    if (!['email', 'disabled'].includes(process.env.VERIFICATION_PROVIDER || '')) errors.push('VERIFICATION_PROVIDER must be email or disabled in production.');
  }

  if (errors.length) throw new Error(`Invalid environment configuration:\n- ${[...new Set(errors)].join('\n- ')}`);
  return {
    production,
    staffMfaRequired: staffMfaPolicy === 'required',
    rateLimitStore,
    runtimeDatabaseRole,
    trustProxyHops: production ? trustProxyHops : (Number.isInteger(trustProxyHops) && trustProxyHops >= 0 ? trustProxyHops : 0),
    allowedOrigins: origins.length
      ? (production ? [...new Set(origins.map(canonicalProductionOrigin))] : origins)
      : ['http://localhost:5173'],
    googleClientId: configuredGoogleClientId(),
    clinicTimeZone,
    facilityBranding,
    socketRevocation: {
      databaseUrl: socketRevocationDatabaseUrl,
      reconcileMs: positiveInteger('SOCKET_REVOCATION_RECONCILE_MS', 10000),
      unhealthyGraceMs: positiveInteger('SOCKET_REVOCATION_UNHEALTHY_GRACE_MS', 15000)
    }
  };
}

export const rateLimits = {
  windowMs: positiveInteger('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  login: positiveInteger('RATE_LIMIT_LOGIN_MAX', process.env.NODE_ENV === 'test' ? 100 : 10),
  registration: positiveInteger('RATE_LIMIT_REGISTRATION_MAX', process.env.NODE_ENV === 'test' ? 100 : 10),
  verification: positiveInteger('RATE_LIMIT_VERIFICATION_MAX', process.env.NODE_ENV === 'test' ? 100 : 10),
  claim: positiveInteger('RATE_LIMIT_CLAIM_MAX', process.env.NODE_ENV === 'test' ? 100 : 10),
  adminReset: positiveInteger('RATE_LIMIT_ADMIN_RESET_MAX', process.env.NODE_ENV === 'test' ? 100 : 10)
};
