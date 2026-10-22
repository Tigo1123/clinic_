import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { REFERENCE_BOOTSTRAP_STATES, runReferenceBootstrap } from '../src/services/referenceBootstrap.js';
import { SUDANESE_STATES } from '../../frontend/src/features/reception/clinicData.js';
import { INITIAL_ONBOARDING_FORM, registrationPayload, googleRegistrationPayload } from '../../frontend/src/features/patient-auth/onboarding.js';

const manifest = JSON.parse(fs.readFileSync(new URL('../reference-data/sudan-states.json', import.meta.url), 'utf8'));
const environment = {
  REFERENCE_BOOTSTRAP_ENABLED: 'true',
  REFERENCE_BOOTSTRAP_ENVIRONMENT: 'test',
  REFERENCE_BOOTSTRAP_EXPECTED_DATABASE: 'in_memory_test',
  REFERENCE_BOOTSTRAP_DRY_RUN: 'false'
};

// No network connection or real database writes. Unexpected model access fails.
function database(initial = []) {
  const rows = structuredClone(initial);
  const client = {
    $queryRaw: async () => [{ name: 'in_memory_test' }],
    state: {
      findMany: async () => structuredClone(rows),
      create: async ({ data }) => { rows.push(structuredClone(data)); return data; }
    },
    clinicalService: { findMany: async () => [] },
    async $transaction(callback) {
      const before = structuredClone(rows);
      try { return await callback(client); }
      catch (error) { rows.splice(0, rows.length, ...before); throw error; }
    }
  };
  return { client, rows };
}

test('registration state IDs and bilingual labels match the approved bootstrap and legacy seed', () => {
  assert.deepEqual(SUDANESE_STATES, REFERENCE_BOOTSTRAP_STATES);
  assert.equal(REFERENCE_BOOTSTRAP_STATES.length, 18);
  const seed = fs.readFileSync(new URL('../prisma/seed.js', import.meta.url), 'utf8');
  const seedStates = [...seed.matchAll(/\{ id: (\d+), labelAr: '([^']+)', labelEn: '([^']+)' \}/g)]
    .map(([, id, labelAr, labelEn]) => ({ id: Number(id), labelAr, labelEn }));
  assert.deepEqual(seedStates, REFERENCE_BOOTSTRAP_STATES);
  assert.deepEqual(manifest, { version: 1, services: [] });
  for (const state of SUDANESE_STATES) {
    const form = { ...INITIAL_ONBOARDING_FORM, addressStateId: String(state.id) };
    assert.equal(registrationPayload(form).addressStateId, state.id);
    assert.equal(googleRegistrationPayload(form, 'test-capability').addressStateId, state.id);
  }
});

test('state-only bootstrap restores all registration choices including the default and is repeatable', async () => {
  const { client, rows } = database();
  const first = await runReferenceBootstrap({ prisma: client, manifest, environment });
  assert.equal(first.report.states.missing.length, 0);
  assert.deepEqual(rows, SUDANESE_STATES);
  assert.ok(rows.some(row => row.id === Number(INITIAL_ONBOARDING_FORM.addressStateId)));
  const second = await runReferenceBootstrap({ prisma: client, manifest, environment });
  assert.equal(second.report.states.existing.length, 18);
  assert.deepEqual(rows, SUDANESE_STATES);
});

test('dry run lists the exact proposed rows without inserting anything', async () => {
  const { client, rows } = database();
  const result = await runReferenceBootstrap({ prisma: client, manifest, environment: {
    ...environment, REFERENCE_BOOTSTRAP_DRY_RUN: 'true'
  } });
  assert.deepEqual(result.report.states.missing, SUDANESE_STATES);
  assert.deepEqual(rows, []);
});

test('partial initialization preserves existing IDs, labels, and additional reference rows', async () => {
  const initial = [SUDANESE_STATES[0], { id: 99, labelAr: 'مرجع اختبار', labelEn: 'Test reference' }];
  const { client, rows } = database(initial);
  await runReferenceBootstrap({ prisma: client, manifest, environment });
  assert.deepEqual(rows.slice(0, 2), initial);
  assert.equal(rows.length, 19);
});

test('conflicting labels or a canonical state at another ID abort before any inserts', async () => {
  for (const initial of [
    [{ ...SUDANESE_STATES[0], labelEn: 'Conflicting test label' }],
    [{ ...SUDANESE_STATES[0], id: 99 }],
    [SUDANESE_STATES[0], { ...SUDANESE_STATES[0], id: 99 }]
  ]) {
    const { client, rows } = database(initial);
    await assert.rejects(runReferenceBootstrap({ prisma: client, manifest, environment }), { code: 'REFERENCE_STATE_CONFLICT' });
    assert.deepEqual(rows, initial);
  }
});
