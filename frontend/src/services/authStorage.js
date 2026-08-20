export const STAFF_USER_KEY = 'cms_staff_user';
export const STAFF_TOKEN_KEY = 'cms_staff_token';
export const PATIENT_USER_KEY = 'cms_patient_user';
export const PATIENT_TOKEN_KEY = 'cms_patient_token';

const STAFF_ROLES = new Set([
  'ADMIN',
  'RECEPTIONIST',
  'DOCTOR',
  'LAB_TECH',
  'PHARMACIST'
]);

function readSession(storage, userKey, tokenKey, isExpectedUser) {
  const serializedUser = storage.getItem(userKey);
  const token = storage.getItem(tokenKey);

  if (!serializedUser || !token) {
    storage.removeItem(userKey);
    storage.removeItem(tokenKey);
    return null;
  }

  try {
    const user = JSON.parse(serializedUser);
    if (!user || !isExpectedUser(user)) throw new Error('Unexpected user type');
    return { user, token };
  } catch {
    storage.removeItem(userKey);
    storage.removeItem(tokenKey);
    return null;
  }
}

function writeSession(storage, userKey, tokenKey, user, token) {
  storage.setItem(userKey, JSON.stringify(user));
  storage.setItem(tokenKey, token);
}

export function readStaffSession() {
  return readSession(
    sessionStorage,
    STAFF_USER_KEY,
    STAFF_TOKEN_KEY,
    (user) => STAFF_ROLES.has(user.role)
  );
}

export function writeStaffSession(user, token) {
  if (!STAFF_ROLES.has(user?.role) || !token) throw new Error('Invalid staff session');
  writeSession(sessionStorage, STAFF_USER_KEY, STAFF_TOKEN_KEY, user, token);
}

export function clearStaffSession() {
  sessionStorage.removeItem(STAFF_USER_KEY);
  sessionStorage.removeItem(STAFF_TOKEN_KEY);
}

export function readPatientSession() {
  return readSession(
    localStorage,
    PATIENT_USER_KEY,
    PATIENT_TOKEN_KEY,
    (user) => user.role === 'PATIENT'
  );
}

export function writePatientSession(user, token) {
  if (user?.role !== 'PATIENT' || !token) throw new Error('Invalid patient session');
  writeSession(localStorage, PATIENT_USER_KEY, PATIENT_TOKEN_KEY, user, token);
}

export function updateStoredPatient(user) {
  localStorage.setItem(PATIENT_USER_KEY, JSON.stringify(user));
}

export function clearPatientSession() {
  localStorage.removeItem(PATIENT_USER_KEY);
  localStorage.removeItem(PATIENT_TOKEN_KEY);
}
