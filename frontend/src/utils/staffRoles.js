export const STAFF_ROLES = Object.freeze(['ADMIN', 'RECEPTIONIST', 'DOCTOR', 'LAB_TECH', 'PHARMACIST']);

export function isStaffRole(role) {
  return STAFF_ROLES.includes(role);
}

export function filterStaffUsers(users) {
  return Array.isArray(users) ? users.filter((user) => isStaffRole(user?.role)) : [];
}
