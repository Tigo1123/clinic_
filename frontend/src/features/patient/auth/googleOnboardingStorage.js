export const GOOGLE_ONBOARDING_TOKEN_KEY = 'cms_google_onboarding_token';

export function getGoogleOnboardingToken() {
  return sessionStorage.getItem(GOOGLE_ONBOARDING_TOKEN_KEY);
}

export function setGoogleOnboardingToken(token) {
  if (typeof token !== 'string' || !token.trim()) throw new Error('Invalid Google onboarding token.');
  sessionStorage.setItem(GOOGLE_ONBOARDING_TOKEN_KEY, token);
}

export function clearGoogleOnboardingToken() {
  sessionStorage.removeItem(GOOGLE_ONBOARDING_TOKEN_KEY);
}
