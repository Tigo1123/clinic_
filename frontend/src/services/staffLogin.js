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

  const completed = requireCompletedLogin(data);
  finalizeLogin(completed.user, completed.token);
  return { state: 'AUTHENTICATED' };
}

export async function completeStaffMfa(challengeToken, code, finalizeLogin, request = publicApiRequest) {
  const data = requireCompletedLogin(await request('/api/auth/mfa/verify', {
    method: 'POST',
    body: JSON.stringify({ challengeToken, code })
  }));
  finalizeLogin(data.user, data.token);
  return { state: 'AUTHENTICATED' };
}
