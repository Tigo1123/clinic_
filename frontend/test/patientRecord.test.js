import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPatientDateTime } from '../src/utils/patientRecord.js';

test('released-result dates are formatted outside the lab-results component', () => {
  const formatted = formatPatientDateTime('2031-01-05T13:30:00.000Z', 'en');

  assert.notEqual(formatted, '—');
  assert.match(formatted, /2031/);
});

test('missing and malformed optional dates use a safe fallback', () => {
  assert.equal(formatPatientDateTime(null, 'en'), '—');
  assert.equal(formatPatientDateTime('not-a-date', 'en'), '—');
  assert.equal(formatPatientDateTime(undefined, 'ar', 'غير متاح'), 'غير متاح');
});
