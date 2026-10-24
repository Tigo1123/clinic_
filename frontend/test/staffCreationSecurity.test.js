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
const adminSource = readFileSync(path.join(root, 'src/features/admin/StaffAccountsPanel.jsx'), 'utf8');
const appSource = readFileSync(path.join(root, 'src/App.jsx'), 'utf8');

test('staff password guidance enforces the centralized backend policy shape', () => {
  assert.equal(isStaffPasswordValid('ValidStaff1'), true);
  for (const password of ['Short1A', 'alllowercase1', 'ALLUPPERCASE1', 'NoNumberHere']) {
    assert.equal(isStaffPasswordValid(password), false);
  }
  assert.equal(getStaffPasswordChecks('A'.repeat(STAFF_PASSWORD_MAX_LENGTH + 1)).maximumLength, false);
});

test('staff form clears sensitive fields on success and maps API errors without raw details', () => {
 const handler=adminSource.slice(adminSource.indexOf('const create ='),adminSource.indexOf('const performAction'));
 assert.match(handler,/setDraft\(emptyDraft\(\)\)/);
 assert.match(handler,/staffErrorMessage/);
 assert.doesNotMatch(handler,/console\.|data\.error\.details/);
});

test('non-doctor staff payloads omit every doctor-only field', () => {
  for (const role of ['RECEPTIONIST', 'PHARMACIST', 'LAB_TECH', 'ADMIN']) {
    const payload = buildStaffCreationPayload({
      username: `${role.toLowerCase()}@cms.com`,
      password: 'ValidStaff1',
      role,
      fullNameAr: '',
      fullNameEn: '',
      specialtyId: '00000000-0000-4000-8000-000000000001',
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
    specialtyId: '00000000-0000-4000-8000-000000000001',
    consultationFee: '20000'
  });
  assert.deepEqual(payload, {
    username: 'doctor@cms.com',
    password: 'ValidDoctor1',
    role: 'DOCTOR',
    fullNameAr: 'د. اختبار',
    fullNameEn: 'Dr. Test',
    specialtyId: '00000000-0000-4000-8000-000000000001',
    consultationFee: '20000'
  });
});

test('reset keeps target IDs, confirmation, administrator password and MFA payloads',()=>{
 assert.match(adminSource,/encodeURIComponent\(target.id\)/);
 assert.match(adminSource,/reset.newPassword !== reset.confirmPassword/);
 assert.match(adminSource,/currentAdminPassword: reset.currentAdminPassword/);
 assert.match(adminSource,/user\?\.mfaEnabled \? \{ mfaCode: reset.mfaCode \}/);
 assert.match(appSource,/<AdminDashboard user=\{user\}/);
});
test('password inputs use safe autocomplete, masked defaults and independent visibility controls',()=>{
 assert.match(adminSource,/autoComplete="new-password"/);
 assert.match(adminSource,/autoComplete="current-password"/);
 assert.match(adminSource,/autoComplete="one-time-code"/);
 assert.match(adminSource,/<PasswordField/);
});
test('reset credentials clear on close, success and each administrator verification attempt',()=>{
 assert.match(adminSource,/setReset\(emptyReset\(\)\)/);
 assert.match(adminSource,/currentAdminPassword: '', mfaCode: ''/);
 assert.doesNotMatch(adminSource,/(localStorage|sessionStorage)|console\.(log|error)/);
});
