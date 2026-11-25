import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PATIENT_BOOKING_PATH, patientDestination } from '../src/app/router/patientBooking.js';

test('only the clinic booking destination survives patient sign-in', () => {
  assert.equal(patientDestination({ afterSignIn: PATIENT_BOOKING_PATH }), '/patient/doctors');
  for (const state of [undefined, null, {}, { afterSignIn: '/staff' }, { afterSignIn: '//other.example' }]) {
    assert.equal(patientDestination(state), '/patient');
  }
});
