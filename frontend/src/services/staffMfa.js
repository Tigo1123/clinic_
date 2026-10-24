import { staffApiRequest } from './apiClient.js';

export function startMfaEnrollment(currentPassword, request = staffApiRequest) {
  return request('/api/auth/mfa/enroll', {
    method: 'POST',
    body: JSON.stringify({ currentPassword })
  });
}

export function confirmMfaEnrollment(code, request = staffApiRequest) {
  return request('/api/auth/mfa/enroll/confirm', {
    method: 'POST',
    body: JSON.stringify({ code })
  });
}

function managementProof(currentPassword, proofType, proof) {
  return {
    currentPassword,
    ...(proofType === 'recovery'
      ? { recoveryCode: proof }
      : { totpCode: proof })
  };
}

export function regenerateMfaRecoveryCodes(currentPassword, proofType, proof, request = staffApiRequest) {
  return request('/api/auth/mfa/recovery/regenerate', {
    method: 'POST',
    body: JSON.stringify(managementProof(currentPassword, proofType, proof))
  });
}

export function disableMfa(currentPassword, proofType, proof, request = staffApiRequest) {
  return request('/api/auth/mfa', {
    method: 'DELETE',
    body: JSON.stringify(managementProof(currentPassword, proofType, proof))
  });
}

// Preserve combined credential errors; policy, format and availability are not
// credential failures. Never display raw verification/server details here.
export function mfaManagementErrorKey(error) {
  if (!error?.status || error.status >= 500) return 'mfaServiceUnavailable';
  if (error.status === 429) return 'mfaRateLimited';
  if (error.code === 'MFA_REQUIRED_POLICY') return 'mfaRequiredPolicy';
  if (error.status === 422) return 'mfaRequestInvalid';
  if (['SESSION_REVOKED', 'INVALID_TOKEN', 'MFA_CREDENTIALS_CHANGED'].includes(error.code)) return 'sessionNoLongerValid';
  if (error.status === 409) return 'mfaStateChanged';
  return 'mfaReauthFailed';
}
