export const STAFF_PASSWORD_MAX_LENGTH = 200;

export function getStaffPasswordChecks(password = '') {
  return {
    minimumLength: password.length >= 10,
    maximumLength: password.length <= STAFF_PASSWORD_MAX_LENGTH,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /\d/.test(password)
  };
}

export function isStaffPasswordValid(password) {
  return Object.values(getStaffPasswordChecks(password)).every(Boolean);
}
