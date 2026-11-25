import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { newPatientSchema } from '../src/utils/patientName.js';
import { patientDateOfBirthSchema } from '../src/utils/patientOnboarding.js';
import { getClinicDateString } from '../src/utils/clinicTime.js';

const schema = newPatientSchema({ dateOfBirth: patientDateOfBirthSchema });
const patient = {
  firstNameAr: 'عبد الله', fatherNameAr: 'علي', grandfatherNameAr: 'علي', familyNameAr: 'حسن',
  firstNameEn: 'Abd Allah', fatherNameEn: 'Jean-Luc', grandfatherNameEn: 'Ali', familyNameEn: 'O’Neill',
  dateOfBirth: '2000-02-29'
};

test('patient creation accepts compound names and flags every repeated multiword part within its language', () => {
  assert.equal(schema.safeParse(patient).success, true);
  const walkIn = z.object({ patient: schema }).safeParse({
    patient: { ...patient, familyNameEn: ' ABD   ALLAH ', familyNameAr: 'عبد  الله' }
  });
  assert.equal(walkIn.success, false);
  assert.deepEqual(walkIn.error.issues.map(issue => issue.path.join('.')).sort(),
    ['patient.familyNameAr', 'patient.familyNameEn', 'patient.firstNameAr', 'patient.firstNameEn']);
});

test('patient creation rejects the current clinic date and impossible calendar dates', () => {
  for (const dateOfBirth of [getClinicDateString(), '2030-02-30', '0000-01-01']) {
    assert.equal(schema.safeParse({ ...patient, dateOfBirth }).success, false);
  }
});
