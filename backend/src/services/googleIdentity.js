import { OAuth2Client } from 'google-auth-library';
import { configuredGoogleClientId } from '../config.js';
import { ApiError } from '../utils/apiError.js';
import { normalizeEmail } from '../utils/identity.js';

export const GOOGLE_PROVIDER = 'GOOGLE';
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

const errors = {
  unavailable: () => new ApiError(503, 'GOOGLE_AUTH_UNAVAILABLE', 'Google authentication is not currently available.'),
  required: () => new ApiError(400, 'GOOGLE_CREDENTIAL_REQUIRED', 'Google authentication could not be verified.'),
  invalid: () => new ApiError(401, 'GOOGLE_CREDENTIAL_INVALID', 'Google authentication could not be verified.'),
  audience: () => new ApiError(401, 'GOOGLE_AUDIENCE_INVALID', 'Google authentication could not be verified.'),
  expired: () => new ApiError(401, 'GOOGLE_CREDENTIAL_EXPIRED', 'Google authentication could not be verified.'),
  issuer: () => new ApiError(401, 'GOOGLE_ISSUER_INVALID', 'Google authentication could not be verified.'),
  subject: () => new ApiError(401, 'GOOGLE_SUBJECT_INVALID', 'Google authentication could not be verified.'),
  email: () => new ApiError(401, 'GOOGLE_EMAIL_INVALID', 'Google authentication could not be verified.'),
  unverifiedEmail: () => new ApiError(403, 'GOOGLE_EMAIL_UNVERIFIED', 'Google authentication could not be verified.'),
  nonce: () => new ApiError(401, 'GOOGLE_NONCE_MISMATCH', 'Google authentication could not be verified.'),
  temporary: () => new ApiError(503, 'GOOGLE_VERIFICATION_UNAVAILABLE', 'Google authentication is temporarily unavailable.')
};

function classifyVerificationFailure(error) {
  const message = String(error?.message || '').toLowerCase();
  if (/audience|aud claim/.test(message)) return errors.audience();
  if (/expired|expiration|too late/.test(message)) return errors.expired();
  if (/issuer|iss claim/.test(message)) return errors.issuer();
  if (/jwk|certificate|discovery|fetch|network|timeout|econn|enotfound/.test(message)) return errors.temporary();
  return errors.invalid();
}

/**
 * Verify a Google Identity Services ID-token credential and return only the
 * provider-neutral identity claims needed by later account flows.
 *
 * `client`/`clientFactory` are intentionally injectable so tests never need
 * a live Google account or network access. Nonce issuance belongs to the
 * later pre-auth transaction flow; when supplied here, it is fail-closed.
 */
export async function verifyGoogleCredential(credential, { expectedNonce, client, clientFactory } = {}) {
  if (typeof credential !== 'string' || !credential.trim()) throw errors.required();

  const audience = configuredGoogleClientId();
  if (!audience) throw errors.unavailable();

  let payload;
  try {
    const verifier = client || (clientFactory ? clientFactory(audience) : new OAuth2Client(audience));
    const ticket = await verifier.verifyIdToken({ idToken: credential, audience });
    payload = ticket?.getPayload?.();
  } catch (error) {
    throw classifyVerificationFailure(error);
  }

  if (!payload || typeof payload !== 'object') throw errors.invalid();
  if (payload.aud !== audience && !(Array.isArray(payload.aud) && payload.aud.includes(audience))) throw errors.audience();
  if (!GOOGLE_ISSUERS.has(payload.iss)) throw errors.issuer();
  if (!Number.isFinite(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) throw errors.expired();
  if (expectedNonce !== undefined && (typeof payload.nonce !== 'string' || payload.nonce !== expectedNonce)) throw errors.nonce();
  if (typeof payload.sub !== 'string' || !payload.sub.trim()) throw errors.subject();
  if (typeof payload.email !== 'string' || !EMAIL_PATTERN.test(normalizeEmail(payload.email) || '')) throw errors.email();
  if (payload.email_verified !== true) throw errors.unverifiedEmail();

  return {
    provider: GOOGLE_PROVIDER,
    providerSubject: payload.sub,
    email: normalizeEmail(payload.email)
  };
}
