import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const compose = read('compose.lan.yml');
const provisioner = read('backend/scripts/provision-first-admin.js');
const env = read('deploy/lan/env.example');
const readme = read('deploy/lan/README.md');
const journey = read('deploy/lan/test-disposable-clinical-journey.mjs');

function service(name) {
  const found = compose.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9-]*:\\n|^networks:|^volumes:)`, 'm'));
  assert.ok(found, `${name} service missing`);
  return found[1];
}

test('first administrator is an explicit one-shot with a file-backed password', () => {
  const block = service('first-admin');
  assert.match(block, /profiles: \["first-admin"\]/);
  assert.match(block, /restart: "no"/);
  assert.match(block, /FIRST_ADMIN_PASSWORD_FILE: \/run\/secrets\/first-admin-password/);
  assert.match(block, /first-admin-password:ro,Z/);
  assert.doesNotMatch(service('backend'), /FIRST_ADMIN|first-admin-password/);
  assert.match(env, /FIRST_ADMIN_PASSWORD_SOURCE_FILE=\/secure\/path\/first-admin-password/);
  assert.match(env, /CONFIRM_FIRST_ADMIN_DATABASE=clinic_lan_placeholder/);
});

test('first administrator provisioning is fail-closed, policy preserving, and audited', () => {
  assert.match(provisioner, /passwordSchema\.safeParse/);
  assert.match(provisioner, /pg_advisory_xact_lock/);
  assert.match(provisioner, /user\.count\(\{ where: \{ role: 'ADMIN' \}/);
  assert.match(provisioner, /FIRST_ADMIN_PROVISIONED/);
  assert.match(provisioner, /isolationLevel: 'Serializable'/);
  assert.match(provisioner, /current_database\(\)/);
  assert.match(provisioner, /CONFIRM_FIRST_ADMIN_DATABASE/);
  assert.match(provisioner, /RUNTIME_LOGIN_ROLE/);
  assert.match(provisioner, /admin@example\.invalid/);
  assert.match(provisioner, /lstatSync/);
  assert.match(provisioner, /0o600/);
  assert.match(provisioner, /metadata\.size > 4096/);
  assert.match(provisioner, /must contain one line only/);
  assert.doesNotMatch(provisioner, /Admin@123|default password|passwordHash:\s*['"]/i);
});

test('concurrency and target-identity guards are exercised by the disposable harness', () => {
  const harness = read('deploy/lan/test-disposable-acceptance.sh');
  assert.match(harness, /CONFIRM_FIRST_ADMIN_DATABASE=wrong_database/);
  assert.match(harness, /RUNTIME_LOGIN_ROLE=wrong_runtime/);
  assert.match(harness, /first_pid/);
  assert.match(harness, /second_pid/);
  assert.match(harness, /identity_rows/);
});

test('disposable clinical journey uses application routes and never logs credentials', () => {
  for (const route of ['/api/patients', '/api/appointments/walk-in', '/api/records', '/api/records/lab-orders', '/api/pharmacy/formulary', '/api/billing/invoice']) {
    assert.match(journey, new RegExp(route.replaceAll('/', '\\/')));
  }
  assert.match(journey, /authorization: `Bearer/);
  assert.doesNotMatch(journey, /console\.log\([^)]*token|console\.log\([^)]*password/i);
  assert.match(journey, /127\.0\.0\.1/);
  assert.match(journey, /localhost/);
  assert.match(journey, /PHASE1A7_ACCEPTANCE_CONFIRMATION/);
  assert.match(journey, /PHASE1A7_REFERENCE_MARKER/);
  assert.match(journey, /catalogBeforeStaff.*marker/);
  assert.doesNotMatch(journey, /readFileSync\([^\n]+\)\.trim\(\)/);
  assert.match(journey, /inventoryBefore/);
  assert.match(journey, /inventoryAfter/);
  assert.match(journey, /dispenseMovements/);
  assert.match(journey, /consultationPaymentCount/);
  assert.match(journey, /pharmacyPaymentCount/);
  assert.match(journey, /denied\('PUT',[\s\S]*tokens\.reception/);
  assert.doesNotMatch(journey, /console\.log\([^)]*(?:authorization|Bearer|secret|password|token)/i);
  const harness = read('deploy/lan/test-disposable-acceptance.sh');
  assert.doesNotMatch(harness, /curl[^\n]*password/i);
  assert.match(harness, /journey_output="\$test_root\/clinical-journey\.json"/);
  assert.doesNotMatch(harness, /\/tmp\/phase1a7-clinical-journey\.json/);
  assert.match(harness, /PHASE1A7_ACCEPTANCE_CONFIRMATION/);
  assert.match(harness, /PHASE1A7_REFERENCE_MARKER/);
});

test('disposable clinical runner refuses non-loopback targets and mismatched markers', () => {
  const runner = path.join(root, 'deploy/lan/test-disposable-clinical-journey.mjs');
  const base = { ...process.env, ADMIN_PASSWORD_FILE: '/definitely/missing', PHASE1A7_ACCEPTANCE_CONFIRMATION: 'PHASE1A7-test_123', PHASE1A7_REFERENCE_MARKER: 'Phase1A7 Laboratory Test test_123', LAB_SERVICE_LABEL: 'Phase1A7 Laboratory Test test_123' };
  const remote = spawnSync(process.execPath, [runner], { env: { ...base, ACCEPTANCE_ORIGIN: 'http://clinic-server:8080' }, encoding: 'utf8' });
  assert.notEqual(remote.status, 0);
  assert.match(`${remote.stderr}${remote.stdout}`, /loopback/i);
  const wrongMarker = spawnSync(process.execPath, [runner], { env: { ...base, ACCEPTANCE_ORIGIN: 'http://127.0.0.1:8080', PHASE1A7_REFERENCE_MARKER: 'Phase1A7 Laboratory Test wrong' }, encoding: 'utf8' });
  assert.notEqual(wrongMarker.status, 0);
  assert.match(`${wrongMarker.stderr}${wrongMarker.stdout}`, /marker/i);
});

test('LAN exposure and persistence gates remain unchanged', () => {
  for (const name of ['postgres', 'backend']) assert.doesNotMatch(service(name), /^    ports:/m);
  assert.match(service('frontend'), /^    ports:/m);
  assert.match(compose, /lan-postgres-data:\/var\/lib\/postgresql\/data/);
  assert.match(compose, /lan-uploads-data:\/app\/uploads/);
});

test('documentation does not misclassify unresolved clinical gates', () => {
  assert.match(readme, /CLINICAL TLS ACCEPTANCE = MANUAL ACCEPTANCE PASSED/);
  assert.match(readme, /OFFLINE FRESH-INSTALL ACCEPTANCE = BLOCKED/);
  assert.match(readme, /Physical power-loss\/host-reboot acceptance remains unproven\./);
  assert.match(readme, /actual second device.*not.*tested/is);
  assert.doesNotMatch(readme, /READY FOR CLINICAL USE/i);
});
