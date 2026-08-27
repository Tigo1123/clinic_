import test from 'node:test';
import assert from 'node:assert/strict';
import { filterStaffUsers, isStaffRole, STAFF_ROLES } from '../src/utils/staffRoles.js';

test('Staff Directory keeps every staff role and excludes PATIENT rows and actions', () => {
  const users = [
    ...STAFF_ROLES.map((role, index) => ({ id: `staff-${index}`, role })),
    { id: 'patient-a', role: 'PATIENT' }
  ];

  const visible = filterStaffUsers(users);
  assert.deepEqual(visible.map((user) => user.role), STAFF_ROLES);
  assert.equal(visible.some((user) => user.id === 'patient-a'), false);
  assert.equal(isStaffRole('PATIENT'), false);
  assert.equal(STAFF_ROLES.every(isStaffRole), true);
});
