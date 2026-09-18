import { ApiError } from '../utils/apiError.js';

const verificationUnavailable = () => new ApiError(503, 'VERIFICATION_UNAVAILABLE', 'Online verification is currently unavailable. Please contact reception to activate your patient account.');

export const PHONE_VERIFICATION_PROVIDERS = Object.freeze({
  DEVELOPMENT: 'development',
  DISABLED: 'disabled'
});

function configuredProvider(env = process.env) {
  if (env.PHONE_VERIFICATION_PROVIDER) return env.PHONE_VERIFICATION_PROVIDER;
  if (env.NODE_ENV === 'production') return PHONE_VERIFICATION_PROVIDERS.DISABLED;
  return env.VERIFICATION_PROVIDER === 'development'
    ? PHONE_VERIFICATION_PROVIDERS.DEVELOPMENT
    : PHONE_VERIFICATION_PROVIDERS.DISABLED;
}

export function phoneVerificationProvider(env = process.env) {
  return configuredProvider(env);
}

export function assertPhoneVerificationAvailable(env = process.env) {
  const provider = configuredProvider(env);
  if (provider !== PHONE_VERIFICATION_PROVIDERS.DEVELOPMENT || env.NODE_ENV === 'production') {
    throw verificationUnavailable();
  }
  return provider;
}

async function developmentDelivery({ code }) {
  return { developmentCode: code };
}

/**
 * Provider-neutral phone delivery boundary. G4B deliberately has no real
 * vendor implementation; G4C can inject one without changing challenge or
 * account logic.
 */
export async function sendPhoneVerificationCode({ destination, code, purpose, language = 'en' }, { env = process.env, delivery = developmentDelivery } = {}) {
  if (typeof destination !== 'string' || !destination || typeof code !== 'string' || !purpose) {
    throw new ApiError(500, 'VERIFICATION_DELIVERY_FAILED', 'Verification could not be delivered.');
  }
  assertPhoneVerificationAvailable(env);
  try {
    return await delivery({ destination, code, purpose, language });
  } catch {
    throw new ApiError(503, 'VERIFICATION_DELIVERY_FAILED', 'Verification could not be delivered.');
  }
}
