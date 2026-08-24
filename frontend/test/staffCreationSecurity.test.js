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
const appSource = readFileSync(path.join(root, 'src/App.jsx'), 'utf8');

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

test('ADMIN staff reset uses immutable target id and confirms the new password', () => {
  assert.match(adminSource, /users\/\$\{resetTarget\.id\}\/reset-password/);
  assert.match(adminSource, /resetNewPassword !== resetConfirmPassword/);
  assert.match(adminSource, /currentAdminPassword: resetAdminPassword/);
  assert.match(adminSource, /user\?\.mfaEnabled \? \{ mfaCode: resetMfaCode \}/);
  assert.match(adminSource, /u\.id !== user\?\.id/);
  assert.match(appSource, /<AdminDashboard user=\{user\}/);
});

test('staff creation and reset forms use safe password autocomplete values', () => {
  const newPasswordAutocomplete = adminSource.match(/autoComplete="new-password"/g) || [];
  assert.equal(newPasswordAutocomplete.length, 3);
  assert.match(adminSource, /id="staff-reset-admin-password"[^>]*autoComplete="current-password"/);
  assert.match(adminSource, /id="staff-reset-mfa-code"[^>]*autoComplete="one-time-code"/);
});

test('staff reset sensitive state is cleared and never stored or logged', () => {
  const resetSection = adminSource.slice(
    adminSource.indexOf('const closePasswordReset'),
    adminSource.indexOf('const handleToggleUserStatus') > adminSource.indexOf('const closePasswordReset')
      ? adminSource.indexOf('const handleToggleUserStatus')
      : adminSource.indexOf('return (')
  );
  for (const setter of ['setResetNewPassword', 'setResetConfirmPassword', 'setResetAdminPassword', 'setResetMfaCode']) {
    assert.match(adminSource, new RegExp(`${setter}\\(''\\)`));
  }
  assert.doesNotMatch(resetSection, /(localStorage|sessionStorage)/);
  assert.doesNotMatch(resetSection, /console\.(log|error)/);
});
