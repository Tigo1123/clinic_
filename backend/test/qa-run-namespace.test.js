import test from 'node:test';
import assert from 'node:assert/strict';
import { createQaRunNamespace, qaPatientIdentifiers } from '../scripts/qaRunNamespace.mjs';
import { createCollisionFreeQaRunNamespace, syntheticQaPhone } from '../scripts/qaPatientPlan.mjs';

test('QA run namespaces are unique-date prefixed and patient identifiers retain the run marker', () => {
  const namespace = createQaRunNamespace(new Date('2026-11-01T12:00:00.000Z'), 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  assert.equal(namespace, 'qa-20261101-a1b2c3d4');
  const first = qaPatientIdentifiers(namespace, 1);
  const hundredth = qaPatientIdentifiers(namespace, 100);
  assert.equal(first.marker, 'qa-20261101-a1b2c3d4-patient-001');
  assert.equal(first.email, 'qa-20261101-a1b2c3d4+patient-001@example.invalid');
  assert.equal(hundredth.marker, 'qa-20261101-a1b2c3d4-patient-100');
  assert.throws(() => qaPatientIdentifiers('production-run', 1));
  assert.throws(() => qaPatientIdentifiers(namespace, 101));
});

test('new 100-patient namespace skips the reviewed smoke patient phone and keeps all batch phones unique', () => {
  const smokeNamespace = 'qa-20261107-395a4fb6';
  const candidateNamespace = 'qa-20261107-a1b2c3d4';
  const candidates = [smokeNamespace, candidateNamespace];
  const runNamespace = createCollisionFreeQaRunNamespace({
    now: new Date('2026-11-07T12:00:00.000Z'),
    createNamespace: () => candidates.shift(),
    reservedPatients: [{ runNamespace: smokeNamespace, index: 1 }]
  });
  assert.equal(runNamespace, candidateNamespace);
  const phones = Array.from({ length: 100 }, (_, index) => syntheticQaPhone(runNamespace, index + 1));
  assert.equal(new Set(phones).size, 100);
  assert.equal(phones.includes(syntheticQaPhone(smokeNamespace, 1)), false);
});
