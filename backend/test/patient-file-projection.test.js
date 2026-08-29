import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const routeSource = fs.readFileSync(new URL('../src/routes/patients.js', import.meta.url), 'utf8');

test('patient file endpoint uses bounded role-specific projections', () => {
  assert.match(routeSource, /allowRoles\(ROLES\.ADMIN, ROLES\.RECEPTIONIST, ROLES\.DOCTOR\)/);
  assert.match(routeSource, /\.\.\.\(isDoctor \? \{ medicalRecords:/);
  assert.match(routeSource, /where: recordAccess\?\.where/);
  assert.match(routeSource, /take: 50/);
  assert.match(routeSource, /availableSections: isDoctor/);
});

test('non-clinical roles do not receive clinical patient-file sections', () => {
  assert.match(routeSource, /\['overview', 'appointments', 'billing'\]/);
  assert.match(routeSource, /visits: visits\.length/);
  assert.doesNotMatch(routeSource, /symptoms: safeDecryptField/);
  assert.match(routeSource, /symptoms: isDoctor \? safeDecryptField/);
});

test('blood type follows the existing doctor-only clinical projection', () => {
  assert.match(routeSource, /\.\.\.\(isDoctor \? \{ bloodType: true \} : \{\}\)/);
  assert.match(routeSource, /\.\.\.\(isDoctor \? \{ bloodType: patient\.bloodType \|\| null \} : \{\}\)/);
});

test('patient-file histories are deterministic and exact MRN lookup stays bounded', () => {
  assert.match(routeSource, /fileNumber: exactFileNumber/);
  assert.match(routeSource, /orderBy: \[\{ appointmentDate: 'desc' \}, \{ appointmentTime: 'desc' \}\]/);
  assert.match(routeSource, /orderBy: \{ visitDate: 'desc' \}/);
  assert.match(routeSource, /sort\(\(a, b\) => new Date\(b\.prescriptionDate\) - new Date\(a\.prescriptionDate\)\)\.slice\(0, 50\)/);
});
