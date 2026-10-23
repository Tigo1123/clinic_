import test from 'node:test';
import assert from 'node:assert/strict';
import { staffMfaRequired } from '../src/config.js';
import {
  signAccessToken, signMfaEnrollmentToken, staffRoleRequiresMfa, verifyAccessToken, verifyMfaEnrollmentToken
} from '../src/services/accessTokens.js';
import { parsePagination } from '../src/utils/pagination.js';
import { queuePatientNameSelect, queuePatientSelect } from '../src/utils/queueDtos.js';
import { PrismaRateLimitStore, rateLimitStore } from '../src/services/rateLimitStore.js';

process.env.JWT_SECRET ||= 'test-jwt-secret-at-least-thirty-two-characters';

test('staff MFA is mandatory in production and can be required outside production without forcing local defaults', () => {
  assert.equal(staffMfaRequired({ NODE_ENV: 'production', STAFF_MFA_POLICY: 'optional' }), true);
  assert.equal(staffMfaRequired({ NODE_ENV: 'development', STAFF_MFA_POLICY: 'required' }), true);
  assert.equal(staffMfaRequired({ NODE_ENV: 'test' }), false);
  assert.equal(staffMfaRequired({ NODE_ENV: 'development' }), false);
  for (const role of ['ADMIN', 'DOCTOR', 'RECEPTIONIST', 'PHARMACIST', 'LAB_TECH']) assert.equal(staffRoleRequiresMfa(role, { NODE_ENV: 'production' }), true);
  assert.equal(staffRoleRequiresMfa('PATIENT', { NODE_ENV: 'production' }), false);
});

test('MFA enrollment credentials are distinct, short-purpose credentials rather than access tokens', () => {
  const identity = { id: 'staff-1', username: 'doctor@example.invalid', role: 'DOCTOR', authVersion: 3 };
  const enrollment = signMfaEnrollmentToken(identity);
  assert.equal(verifyMfaEnrollmentToken(enrollment).scope, 'staff:mfa:enroll');
  assert.throws(() => verifyAccessToken(enrollment));
  assert.throws(() => verifyMfaEnrollmentToken(signAccessToken(identity)));
  assert.throws(() => signMfaEnrollmentToken({ ...identity, role: 'PATIENT' }));
});

test('pagination applies deterministic safe defaults and clamps requested sizes', () => {
  assert.deepEqual(parsePagination({}), { page: 1, pageSize: 50, skip: 0, take: 50 });
  assert.deepEqual(parsePagination({ page: '3', pageSize: '500' }), { page: 3, pageSize: 100, skip: 200, take: 100 });
  assert.deepEqual(parsePagination({ page: '-4', pageSize: 'abc' }), { page: 1, pageSize: 50, skip: 0, take: 50 });
});

test('queue patient projections contain only fields currently needed by their screens', () => {
  assert.deepEqual(Object.keys(queuePatientNameSelect), ['fullNameAr', 'fullNameEn']);
  assert.deepEqual(Object.keys(queuePatientSelect), ['id', 'fileNumber', 'fullNameAr', 'fullNameEn', 'phone']);
  for (const select of [queuePatientNameSelect, queuePatientSelect]) {
    for (const sensitiveField of ['dateOfBirth', 'email', 'nationalId', 'address', 'emergencyContact', 'gender']) {
      assert.equal(Object.hasOwn(select, sensitiveField), false);
    }
  }
});

test('production rate limiting uses PostgreSQL and never falls back to memory', () => {
  const before = process.env.RATE_LIMIT_STORE;
  const beforeNodeEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.RATE_LIMIT_STORE;
    assert.ok(rateLimitStore('test', 1000) instanceof PrismaRateLimitStore);
    process.env.RATE_LIMIT_STORE = 'memory';
    assert.throws(() => rateLimitStore('test', 1000), /must be postgres in production/);
    process.env.NODE_ENV = 'test';
    assert.equal(rateLimitStore('test', 1000), undefined);
  } finally {
    if (before === undefined) delete process.env.RATE_LIMIT_STORE; else process.env.RATE_LIMIT_STORE = before;
    if (beforeNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = beforeNodeEnv;
  }
});
