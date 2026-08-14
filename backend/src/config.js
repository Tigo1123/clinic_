import 'dotenv/config';
import { DEFAULT_CLINIC_TIME_ZONE, isValidClinicTimeZone } from './utils/clinicTime.js';

const INSECURE_SECRETS = new Set([
  'secret', 'changeme', 'development-secret',
  'replace-with-a-long-random-jwt-signing-secret',
  'replace-with-a-separate-long-random-medical-encryption-key'
]);

function csv(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function positiveInteger(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

export function validateEnvironment() {
  const production = process.env.NODE_ENV === 'production';
  const errors = [];
  const databaseUrl = process.env.DATABASE_URL;
  const jwtSecret = process.env.JWT_SECRET;
  const encryptionKey = process.env.MEDICAL_ENCRYPTION_KEY;
  const origins = csv(process.env.CORS_ALLOWED_ORIGINS);
  const clinicTimeZone = process.env.CLINIC_TIME_ZONE || (production ? '' : DEFAULT_CLINIC_TIME_ZONE);

  if (!databaseUrl || !/^postgres(?:ql)?:\/\//.test(databaseUrl)) errors.push('DATABASE_URL must be a valid PostgreSQL URL.');
  if (!jwtSecret) errors.push('JWT_SECRET is required.');
  if (!encryptionKey) errors.push('MEDICAL_ENCRYPTION_KEY is required.');
  if (!clinicTimeZone) errors.push('CLINIC_TIME_ZONE is required in production.');
  else if (!isValidClinicTimeZone(clinicTimeZone)) errors.push('CLINIC_TIME_ZONE must be a valid IANA timezone.');

  if (production) {
    if (!jwtSecret || jwtSecret.length < 32 || INSECURE_SECRETS.has(jwtSecret.toLowerCase())) errors.push('JWT_SECRET must be a unique secret of at least 32 characters.');
    if (!encryptionKey || encryptionKey.length < 32 || INSECURE_SECRETS.has(encryptionKey.toLowerCase())) errors.push('MEDICAL_ENCRYPTION_KEY must be a separate secret of at least 32 characters.');
    if (jwtSecret && encryptionKey && jwtSecret === encryptionKey) errors.push('JWT_SECRET and MEDICAL_ENCRYPTION_KEY must be different.');
    if (!origins.length) errors.push('CORS_ALLOWED_ORIGINS must list trusted HTTPS origins.');
    if (origins.some((origin) => origin === '*' || !origin.startsWith('https://'))) errors.push('Production CORS origins must be explicit HTTPS URLs and cannot use wildcards.');
    if (process.env.VERIFICATION_PROVIDER === 'development') errors.push('The development verification provider is forbidden in production.');
    if (process.env.VERIFICATION_PROVIDER === 'email') {
      for (const name of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM']) if (!process.env[name]) errors.push(`${name} is required for email verification.`);
      if (process.env.NOTIFICATIONS_DISABLED === 'true') errors.push('NOTIFICATIONS_DISABLED cannot be true when email verification is enabled.');
    }
    if (!['email', 'disabled'].includes(process.env.VERIFICATION_PROVIDER || '')) errors.push('VERIFICATION_PROVIDER must be email or disabled in production.');
  }

  if (errors.length) throw new Error(`Invalid environment configuration:\n- ${[...new Set(errors)].join('\n- ')}`);
  return { production, allowedOrigins: origins.length ? origins : ['http://localhost:5173'], clinicTimeZone };
}

export const rateLimits = {
  windowMs: positiveInteger('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  login: positiveInteger('RATE_LIMIT_LOGIN_MAX', process.env.NODE_ENV === 'test' ? 100 : 10),
  registration: positiveInteger('RATE_LIMIT_REGISTRATION_MAX', process.env.NODE_ENV === 'test' ? 100 : 10),
  verification: positiveInteger('RATE_LIMIT_VERIFICATION_MAX', process.env.NODE_ENV === 'test' ? 100 : 10),
  claim: positiveInteger('RATE_LIMIT_CLAIM_MAX', process.env.NODE_ENV === 'test' ? 100 : 10)
};
