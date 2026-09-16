import { useCallback, useRef, useState } from 'react';
import { publicApiRequest } from '../../services/apiClient.js';
import { clearGoogleOnboardingToken, setGoogleOnboardingToken } from './googleOnboardingStorage.js';

function responseError(code = 'GOOGLE_SIGN_IN_UNEXPECTED_RESPONSE') {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function useGooglePatientAuth({ onAuthenticated, onOnboarding, onError } = {}) {
  const [loading, setLoading] = useState(false);
  const [errorCode, setErrorCode] = useState('');
  const activeRequest = useRef(false);

  const handleCredential = useCallback(async (credential) => {
    if (activeRequest.current || typeof credential !== 'string' || !credential) return;
    activeRequest.current = true;
    setLoading(true);
    setErrorCode('');
    clearGoogleOnboardingToken();
    try {
      const data = await publicApiRequest('/api/patient-auth/google/verify', {
        method: 'POST',
        body: JSON.stringify({ credential })
      });
      if (data?.status === 'AUTHENTICATED') {
        if (typeof data.token !== 'string' || !data.token || !data.user || data.user.role !== 'PATIENT') throw responseError();
        clearGoogleOnboardingToken();
        onAuthenticated?.(data);
      } else if (data?.status === 'ONBOARDING_REQUIRED') {
        if (typeof data.onboardingToken !== 'string' || !data.onboardingToken) throw responseError();
        setGoogleOnboardingToken(data.onboardingToken);
        onOnboarding?.(data);
      } else {
        throw responseError();
      }
    } catch (requestError) {
      const code = requestError?.code || 'GOOGLE_SIGN_IN_NETWORK_ERROR';
      setErrorCode(code);
      onError?.(code);
    } finally {
      activeRequest.current = false;
      setLoading(false);
    }
  }, [onAuthenticated, onError, onOnboarding]);

  return { handleCredential, loading, errorCode };
}
