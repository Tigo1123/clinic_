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
