import { clearPatientSession, clearStaffSession, readPatientSession, readStaffSession } from './authStorage.js';
import { clearGoogleOnboardingToken } from '../features/patient-auth/googleOnboardingStorage.js';

// Logout revokes every session for this account. Local cleanup is unconditional.
export async function logoutAccount(kind) {
  const staff = kind === 'staff';
  const session = staff ? readStaffSession() : readPatientSession();
  const base = (staff ? import.meta.env?.VITE_STAFF_API_URL : '') || import.meta.env?.VITE_API_BASE_URL || '';
  try {
    if (session?.token) await fetch(`${base.replace(/\/$/, '')}/api/auth/logout`, {
      method: 'POST', headers: { Authorization: `Bearer ${session.token}` },
      signal: AbortSignal.timeout(10000)
    });
  } catch {
    // The server may be unreachable. Do not retain local credentials.
  } finally {
    if (staff) clearStaffSession();
    else { clearPatientSession(); clearGoogleOnboardingToken(); }
  }
}
