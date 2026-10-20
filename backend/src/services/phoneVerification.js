import { ApiError } from '../utils/apiError.js';

const verificationUnavailable = () => new ApiError(503, 'VERIFICATION_UNAVAILABLE', 'Online verification is currently unavailable. Please contact reception to activate your patient account.');

export const PHONE_VERIFICATION_PROVIDERS = Object.freeze({
  DEVELOPMENT: 'development',
  DISABLED: 'disabled'
});

function configuredProvider(env = process.env) {
  const requested = env.PHONE_VERIFICATION_PROVIDER || (
    ['development', 'test'].includes(env.NODE_ENV) && env.VERIFICATION_PROVIDER === 'development'
      ? PHONE_VERIFICATION_PROVIDERS.DEVELOPMENT
      : PHONE_VERIFICATION_PROVIDERS.DISABLED
  );
  if (requested === PHONE_VERIFICATION_PROVIDERS.DEVELOPMENT && !['development', 'test'].includes(env.NODE_ENV)) {
    return PHONE_VERIFICATION_PROVIDERS.DISABLED;
  }
  return requested;
}

const allowsDevelopmentSimulation = (env) => ['development', 'test'].includes(env.NODE_ENV);

export function phoneVerificationProvider(env = process.env) {
  return configuredProvider(env);
}

export function assertPhoneVerificationAvailable(env = process.env) {
  const provider = configuredProvider(env);
  if (provider !== PHONE_VERIFICATION_PROVIDERS.DEVELOPMENT || !allowsDevelopmentSimulation(env)) {
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
    const result = await delivery({ destination, code, purpose, language });
    if (env.PHONE_VERIFICATION_PROVIDER === PHONE_VERIFICATION_PROVIDERS.DEVELOPMENT && allowsDevelopmentSimulation(env)) {
      return { ...result, developmentCode: code };
    }
    return result;
  } catch {
    throw new ApiError(503, 'VERIFICATION_DELIVERY_FAILED', 'Verification could not be delivered.');
  }
}
