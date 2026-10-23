import { publicApiRequest } from './apiClient.js';

const TERMINAL_MFA_CODES = new Set(['MFA_CHALLENGE_INVALID']);

function requireCompletedLogin(data) {
  if (!data?.token || !data?.user) throw new Error('Authentication response is incomplete.');
  return data;
}

export function isTerminalMfaError(error) {
  return TERMINAL_MFA_CODES.has(error?.code);
}

export async function startStaffLogin(credentials, finalizeLogin, request = publicApiRequest) {
  const data = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(credentials)
  });

  if (data?.mfaRequired === true) {
    if (typeof data.challengeToken !== 'string' || !data.challengeToken || !data.expiresAt) {
      throw new Error('Authentication response is incomplete.');
    }
    return {
      state: 'MFA_REQUIRED',
      challengeToken: data.challengeToken,
      expiresAt: data.expiresAt
    };
  }

  if (data?.mfaEnrollmentRequired === true) {
    if (typeof data.enrollmentToken !== 'string' || !data.enrollmentToken) {
      throw new Error('Authentication response is incomplete.');
    }
    return { state: 'MFA_ENROLLMENT_REQUIRED', enrollmentToken: data.enrollmentToken };
  }

  const completed = requireCompletedLogin(data);
  finalizeLogin(completed.user, completed.token);
  return { state: 'AUTHENTICATED' };
}

export function startRequiredMfaEnrollment(enrollmentToken, request = publicApiRequest) {
  return request('/api/auth/mfa/enroll/required', {
    method: 'POST', headers: { Authorization: `Bearer ${enrollmentToken}` }
  });
}

export function confirmRequiredMfaEnrollment(enrollmentToken, code, request = publicApiRequest) {
  return request('/api/auth/mfa/enroll/required/confirm', {
    method: 'POST', headers: { Authorization: `Bearer ${enrollmentToken}` },
    body: JSON.stringify({ code })
  });
}

export async function completeStaffMfa(challengeToken, code, finalizeLogin, request = publicApiRequest) {
  const data = requireCompletedLogin(await request('/api/auth/mfa/verify', {
    method: 'POST',
    body: JSON.stringify({ challengeToken, code })
  }));
  finalizeLogin(data.user, data.token);
  return { state: 'AUTHENTICATED' };
}

export async function completeStaffMfaRecovery(challengeToken, recoveryCode, finalizeLogin, request = publicApiRequest) {
  const data = requireCompletedLogin(await request('/api/auth/mfa/recovery/verify', {
    method: 'POST',
    body: JSON.stringify({ challengeToken, recoveryCode })
  }));
  finalizeLogin(data.user, data.token, { mfaMethod: 'RECOVERY_CODE' });
  return { state: 'AUTHENTICATED' };
}
