import { clearPatientSession, clearStaffSession, readPatientSession, readStaffSession } from './authStorage.js';
import i18n from '../i18n.js';

const API_BASE = import.meta.env?.VITE_API_BASE_URL || '';

const apiErrorKeys = {
  INVALID_CREDENTIALS: 'apiErrorInvalidCredentials',
  AUTHENTICATION_REQUIRED: 'sessionNoLongerValid', INVALID_TOKEN: 'sessionNoLongerValid', SESSION_REVOKED: 'sessionNoLongerValid',
  FORBIDDEN: 'apiErrorAccessDenied', PATIENT_ROLE_REQUIRED: 'apiErrorAccessDenied', PATIENT_ACCESS_FORBIDDEN: 'apiErrorAccessDenied', APPOINTMENT_ACCESS_FORBIDDEN: 'apiErrorAccessDenied',
  MFA_CODE_INVALID: 'mfaCodeInvalid', MFA_RECOVERY_INVALID: 'recoveryCodeInvalid', MFA_CHALLENGE_INVALID: 'mfaChallengeExpired', MFA_CHALLENGE_EXPIRED: 'mfaChallengeExpired',
  EMAIL_ALREADY_REGISTERED: 'apiErrorEmailDuplicate', PHONE_ALREADY_REGISTERED: 'apiErrorPhoneDuplicate',
  ACCOUNT_PENDING_VERIFICATION: 'pendingVerificationMessage',
  VERIFICATION_INVALID: 'apiErrorVerification', VERIFICATION_EXPIRED: 'apiErrorVerification',
  CLINICAL_DATA_UNREADABLE: 'patientDataUnavailable',
  PASSWORD_CHANGE_REQUIRED: 'passwordChangeRequired', PASSWORD_CHANGE_FAILED: 'apiErrorPassword',
  CURRENT_PASSWORD_INVALID: 'apiErrorCurrentPassword', PASSWORD_REUSE_NOT_ALLOWED: 'apiErrorPasswordReuse',
  ACCOUNT_INACTIVE: 'apiErrorAccountInactive', PASSWORD_CHANGE_CONFLICT: 'sessionNoLongerValid',
  SERVICE_UNAVAILABLE: 'apiErrorServiceUnavailable', VERIFICATION_UNAVAILABLE: 'apiErrorServiceUnavailable', GOOGLE_VERIFICATION_UNAVAILABLE: 'apiErrorServiceUnavailable',
  LOGIN_RATE_LIMITED: 'apiErrorRateLimited', ADMIN_RESET_RATE_LIMITED: 'apiErrorRateLimited', MUTATION_RATE_LIMITED: 'apiErrorRateLimited',
  VERIFICATION_RESEND_COOLDOWN: 'apiErrorRateLimited', VERIFICATION_ATTEMPTS_EXCEEDED: 'apiErrorRateLimited',
  NETWORK_ERROR: 'apiErrorNetwork', REQUEST_FAILED: 'apiErrorRequestFailed'
};

export function localizedApiErrorMessage(error = {}, fallback) {
  const language = (i18n.resolvedLanguage || i18n.language || 'ar').split('-')[0];
  const key = apiErrorKeys[error.code];
  if (key && error.code !== 'REQUEST_FAILED') return i18n.t(key, { lng: language });
  if (error.status === 429) return i18n.t('apiErrorRateLimited', { lng: language });
  if (error.status >= 500) return i18n.t('apiErrorServiceUnavailable', { lng: language });
  if (typeof fallback === 'string' && fallback) {
    const fallbackIsArabic = /[\u0600-\u06ff]/u.test(fallback);
    if ((language === 'ar') === fallbackIsArabic) return fallback;
  }
  return i18n.t('apiErrorRequestFailed', { lng: language });
}

export class ApiClientError extends Error {
  constructor(status, code, message, details) {
    super(localizedApiErrorMessage({ status, code }));
    this.status = status;
    this.code = code;
    this.serverMessage = message;
    this.details = details;
  }
}

const SESSION_ENDING_CODES = new Set(['INVALID_TOKEN', 'SESSION_REVOKED', 'AUTHENTICATION_REQUIRED']);

async function endsSession(response) {
  if (response.status !== 401) return false;
  // Read a copy so callers can still read the original body.
  const body = await response.clone?.().json().catch(() => null);
  const code = body?.error?.code ?? body?.code;
  // A 401 without a recognizable code usually comes from an intermediary,
  // so keep the previous behavior and end the session.
  return !code || SESSION_ENDING_CODES.has(code);
}

export async function apiFetch(path, options = {}, auth = null, baseUrl = API_BASE) {
  const session = auth === 'staff'
    ? readStaffSession()
    : auth === 'patient'
      ? readPatientSession()
      : null;
  const token = session?.token;
  const targetUrl = /^https?:\/\//.test(path)
    ? path
    : `${baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  let response;
  try {
    response = await fetch(targetUrl, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers
      }
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiClientError(0, 'NETWORK_ERROR');
  }

  if (auth && await endsSession(response)) {
    if (auth === 'staff') clearStaffSession();
    if (auth === 'patient') clearPatientSession();
    window.location.replace(auth === 'staff' ? '/staff' : '/patient-login');
  }

  return response;
}

async function request(path, options = {}, auth = null, baseUrl = API_BASE) {
  const response = await apiFetch(path, options, auth, baseUrl);

  const payload =
    response.status === 204
      ? null
      : await response.json().catch(() => null);

  if (!response.ok) {
    const error = payload?.error;

    const code =
      payload?.code ||
      (typeof error === 'object' && error ? error.code : undefined) ||
      (typeof payload?.status === 'string' && payload.status ? payload.status : undefined) ||
      (response.status === 401 && /\/api\/auth\/login(?:\?|$)/.test(path) ? 'INVALID_CREDENTIALS' : undefined) ||
      'REQUEST_FAILED';

    const serverMessage = error && typeof error === 'object' ? error.message : error;

    const details =
      error && typeof error === 'object'
        ? error.details
        : payload?.details;

    throw new ApiClientError(
      response.status,
      code,
      serverMessage,
      details
    );
  }

  return payload;
}

export function staffApiRequest(path, options = {}) {
  return request(path, options, 'staff', import.meta.env?.VITE_STAFF_API_URL || API_BASE);
}

export function patientApiRequest(path, options = {}) {
  return request(path, options, 'patient');
}

export function publicApiRequest(path, options = {}) {
  return request(path, options);
}
