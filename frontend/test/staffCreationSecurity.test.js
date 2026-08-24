import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getStaffPasswordChecks,
  isStaffPasswordValid,
  STAFF_PASSWORD_MAX_LENGTH
} from '../src/utils/staffPasswordPolicy.js';
import { buildStaffCreationPayload } from '../src/utils/staffCreationPayload.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adminSource = readFileSync(path.join(root, 'src/features/admin/AdminDashboard.jsx'), 'utf8');

test('staff password guidance enforces the centralized backend policy shape', () => {
  assert.equal(isStaffPasswordValid('ValidStaff1'), true);
  for (const password of ['Short1A', 'alllowercase1', 'ALLUPPERCASE1', 'NoNumberHere']) {
    assert.equal(isStaffPasswordValid(password), false);
  }
  assert.equal(getStaffPasswordChecks('A'.repeat(STAFF_PASSWORD_MAX_LENGTH + 1)).maximumLength, false);
});

test('staff form retains password on API failure and clears it only after success', () => {
  const handler = adminSource.slice(
    adminSource.indexOf('const handleCreateUser'),
    adminSource.indexOf('const handleToggleUserStatus')
  );
  const successBlock = handler.slice(handler.indexOf('if (res.ok)'), handler.indexOf('} else {'));
  const failureBlock = handler.slice(handler.indexOf('} else {'));
  assert.match(successBlock, /setNewPassword\(''\)/);
  assert.doesNotMatch(failureBlock, /setNewPassword/);
  assert.match(failureBlock, /data\.error\.details/);
  assert.doesNotMatch(handler, /console\.(log|error)\([^\n]*newPassword/);
});

test('non-doctor staff payloads omit every doctor-only field', () => {
  for (const role of ['RECEPTIONIST', 'PHARMACIST', 'LAB_TECH', 'ADMIN']) {
    const payload = buildStaffCreationPayload({
      username: `${role.toLowerCase()}@cms.com`,
      password: 'ValidStaff1',
      role,
      fullNameAr: '',
      fullNameEn: '',
      specialtyAr: 'طب عام',
      specialtyEn: 'General Medicine',
      consultationFee: '20000'
    });
    assert.deepEqual(Object.keys(payload).sort(), ['password', 'role', 'username']);
  }
});

test('doctor staff payload includes its profile fields', () => {
  const payload = buildStaffCreationPayload({
    username: 'doctor@cms.com',
    password: 'ValidDoctor1',
    role: 'DOCTOR',
    fullNameAr: 'د. اختبار',
    fullNameEn: 'Dr. Test',
    specialtyAr: 'طب عام',
    specialtyEn: 'General Medicine',
    consultationFee: '20000'
  });
  assert.deepEqual(payload, {
    username: 'doctor@cms.com',
    password: 'ValidDoctor1',
    role: 'DOCTOR',
    fullNameAr: 'د. اختبار',
    fullNameEn: 'Dr. Test',
    specialtyAr: 'طب عام',
    specialtyEn: 'General Medicine',
    consultationFee: '20000'
  });
});
