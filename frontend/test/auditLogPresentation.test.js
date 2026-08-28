import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actorDisplayName, auditDetailSummary, auditEventFallback, auditEventPresentation, formatAuditDateTime, shortTechnicalId
} from '../src/utils/auditLogPresentation.js';

test('audit presentation keeps actor identity separate from structured target identity', () => {
  const actor = { displayNameAr: 'د. سارة التجريبية', displayNameEn: 'Dr Demo Sara', username: 'doctor@example.test' };
  const target = { type: 'APPOINTMENT', id: '11111111-2222-4333-8444-555555555555' };
  assert.equal(actorDisplayName(actor, 'ar'), 'د. سارة التجريبية');
  assert.equal(actorDisplayName(actor, 'en'), 'Dr Demo Sara');
  assert.equal(shortTechnicalId(target.id), '11111111…');
  assert.notEqual(actor.username, target.id);
});

test('structured status details become a readable change without confusing the target', () => {
  const details = JSON.stringify({ previousStatus: 'INACTIVE', status: 'ACTIVE' });
  assert.equal(auditDetailSummary(details, 'ar'), 'غير نشط → نشط');
  assert.equal(auditDetailSummary(details, 'en'), 'Inactive → Active');
});

test('known audit events have translated keys and unknown events remain readable', () => {
  assert.deepEqual(auditEventPresentation('USER_STATUS_CHANGE'), { labelKey: 'auditEventUserStatusChange', tone: 'warning' });
  assert.deepEqual(auditEventPresentation('EMR_BREAK_THE_GLASS_BYPASS:record-id'), { labelKey: 'auditEventEmergencyAccess', tone: 'danger' });
  assert.deepEqual(auditEventPresentation('FUTURE_SAFE_EVENT'), { labelKey: null, tone: 'neutral' });
  assert.equal(auditEventFallback('FUTURE_SAFE_EVENT'), 'FUTURE SAFE EVENT');
});

test('audit timestamps use the configured clinic timezone rather than browser-local time', () => {
  const formatted = formatAuditDateTime('2026-08-27T21:30:00.000Z', 'en');
  assert.match(formatted.date, /27 August 2026/);
  assert.match(formatted.time, /(?:23:30|11:30 pm)/i);
  assert.doesNotMatch(formatted.time, /9:30 pm/i);
});
