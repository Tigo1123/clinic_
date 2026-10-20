import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearAppointmentOtpsForTests, finishAppointmentOtp, issueAppointmentOtp, reserveAppointmentOtp } from '../src/services/appointmentOtp.js';

beforeEach(clearAppointmentOtpsForTests);

test('public booking OTP resend is blocked during its cooldown and rotates after cooldown', () => {
  assert.deepEqual(issueAppointmentOtp('+249912345678', '123456', 1000), { issued: true });
  assert.deepEqual(issueAppointmentOtp('+249912345678', '654321', 2000), { issued: false, retryAfterSeconds: 59 });
  const reservation = reserveAppointmentOtp('+249912345678', '123456', 3000);
  assert.equal(reservation.valid, true);
  finishAppointmentOtp('+249912345678', reservation.reservationToken, { consumed: false, now: 3000 });
  assert.deepEqual(issueAppointmentOtp('+249912345678', '654321', 61000), { issued: true });
  assert.equal(reserveAppointmentOtp('+249912345678', '123456', 61000).valid, false);
  assert.equal(reserveAppointmentOtp('+249912345678', '654321', 61000).valid, true);
});

test('public booking OTP expires, counts failed attempts, and locks after five failures', () => {
  issueAppointmentOtp('+249912345678', '123456', 1000);
  for (let attempt = 0; attempt < 4; attempt += 1) assert.equal(reserveAppointmentOtp('+249912345678', '000000', 1001 + attempt).valid, false);
  const reservation = reserveAppointmentOtp('+249912345678', '123456', 1006);
  assert.equal(reservation.valid, true);
  finishAppointmentOtp('+249912345678', reservation.reservationToken, { consumed: false, now: 1006 });
  for (let attempt = 0; attempt < 5; attempt += 1) assert.equal(reserveAppointmentOtp('+249912345678', '000000', 1007 + attempt).valid, false);
  assert.equal(reserveAppointmentOtp('+249912345678', '123456', 1013).valid, false);
  assert.deepEqual(issueAppointmentOtp('+249912345678', '222222', 2000), { issued: false, retryAfterSeconds: 59 });

  issueAppointmentOtp('+249912345679', '123456', 2000);
  assert.equal(reserveAppointmentOtp('+249912345679', '123456', 602001).valid, false);
});

test('a reserved OTP cannot be used concurrently and successful consumption is single-use', () => {
  issueAppointmentOtp('+249912345678', '123456', 1000);
  const reservation = reserveAppointmentOtp('+249912345678', '123456', 1001);
  assert.equal(reservation.valid, true);
  assert.equal(reserveAppointmentOtp('+249912345678', '123456', 1002).valid, false);
  finishAppointmentOtp('+249912345678', reservation.reservationToken, { consumed: true, now: 1003 });
  assert.equal(reserveAppointmentOtp('+249912345678', '123456', 1004).valid, false);
  assert.deepEqual(issueAppointmentOtp('+249912345678', '654321', 2000), { issued: false, retryAfterSeconds: 59 });
  assert.deepEqual(issueAppointmentOtp('+249912345678', '654321', 61000), { issued: true });
});

test('reservation blocks resend until released, even after cooldown', () => {
  issueAppointmentOtp('+249912345678', '123456', 1000);
  const reservation = reserveAppointmentOtp('+249912345678', '123456', 1001);
  assert.equal(typeof reservation.reservationToken, 'string');
  assert.deepEqual(issueAppointmentOtp('+249912345678', '654321', 61000), {
    issued: false,
    reason: 'RESERVATION_IN_PROGRESS',
    retryAfterSeconds: 540
  });
  assert.equal(finishAppointmentOtp('+249912345678', reservation.reservationToken, { consumed: false, now: 61001 }), true);
  assert.deepEqual(issueAppointmentOtp('+249912345678', '654321', 61002), { issued: true });
});

test('expired reserved challenge may be replaced and stale completion cannot alter its replacement', () => {
  issueAppointmentOtp('+249912345678', '123456', 1000);
  const oldReservation = reserveAppointmentOtp('+249912345678', '123456', 1001);
  assert.equal(typeof oldReservation.reservationToken, 'string');
  assert.deepEqual(issueAppointmentOtp('+249912345678', '654321', 601000), { issued: true });
  assert.equal(finishAppointmentOtp('+249912345678', oldReservation.reservationToken, { consumed: true, now: 601001 }), false);
  const replacement = reserveAppointmentOtp('+249912345678', '654321', 601002);
  assert.equal(typeof replacement.reservationToken, 'string');
  assert.notEqual(replacement.reservationToken, oldReservation.reservationToken);
  assert.equal(finishAppointmentOtp('+249912345678', oldReservation.reservationToken, { consumed: false, now: 601003 }), false);
  assert.equal(reserveAppointmentOtp('+249912345678', '654321', 601004).valid, false);
});
