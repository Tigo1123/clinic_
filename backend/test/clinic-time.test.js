import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cancellationCutoffReached,
  clinicAppointmentToInstant,
  clinicDateSequence,
  clinicDayBounds,
  getClinicDateString
} from '../src/utils/clinicTime.js';

process.env.CLINIC_TIME_ZONE = 'Africa/Khartoum';

test('clinic date follows clinic-local midnight, not UTC or server timezone', () => {
  assert.equal(getClinicDateString('2026-08-14T20:30:00Z'), '2026-08-14');
  assert.equal(getClinicDateString('2026-08-14T22:30:00Z'), '2026-08-15');
  const originalServerZone = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  assert.equal(getClinicDateString('2026-08-14T22:30:00Z'), '2026-08-15');
  process.env.TZ = originalServerZone;
});

test('clinic calendar sequences cross month and year boundaries safely', () => {
  assert.deepEqual(clinicDateSequence(3, '2026-03-01T10:00:00Z'), ['2026-02-27', '2026-02-28', '2026-03-01']);
  assert.deepEqual(clinicDateSequence(3, '2027-01-01T10:00:00Z'), ['2026-12-30', '2026-12-31', '2027-01-01']);
});

test('clinic day boundaries are UTC instants for the configured local day', () => {
  const bounds = clinicDayBounds('2026-08-15');
  assert.equal(bounds.start.toISOString(), '2026-08-14T22:00:00.000Z');
  assert.equal(bounds.end.toISOString(), '2026-08-15T22:00:00.000Z');
});

test('cancellation cutoff allows just before and blocks exactly at or after cutoff', () => {
  const appointment = clinicAppointmentToInstant('2026-08-15', '10:00');
  assert.equal(cancellationCutoffReached('2026-08-15', '10:00', 2, new Date(appointment.getTime() - 2 * 3600000 - 1)), false);
  assert.equal(cancellationCutoffReached('2026-08-15', '10:00', 2, new Date(appointment.getTime() - 2 * 3600000)), true);
  assert.equal(cancellationCutoffReached('2026-08-15', '10:00', 2, new Date(appointment.getTime() - 2 * 3600000 + 1)), true);
});
