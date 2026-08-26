import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(root, 'src/features/reception/ReceptionDashboard.jsx'), 'utf8');

test('receptionist walk-in UI uses the dedicated endpoint and allow-listed payload', () => {
  assert.match(source, /activeTab === 'walkin'/);
  assert.match(source, /إدخال مريض مباشر/);
  assert.match(source, /\/api\/appointments\/walk-in/);
  assert.match(source, /appointmentDate: clinicDateString\(\)/);
  assert.match(source, /appointmentTime: walkInTime/);
  assert.match(source, /body\.patientId = walkInPatient\.id/);
  assert.doesNotMatch(source.slice(source.indexOf("fetchWithAuth('/api/appointments/walk-in'"), source.indexOf("fetchWithAuth('/api/appointments/walk-in'") + 900), /price|status|actor|queuePosition/);
});
