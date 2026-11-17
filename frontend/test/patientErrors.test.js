import test from 'node:test';
import assert from 'node:assert/strict';
import { patientErrorMessage } from '../src/services/patientErrors.js';
import i18n from '../src/i18n.js';

test('mapped code returns localized message in Arabic and English', () => {
  const error = { code: 'APPOINTMENT_SLOT_UNAVAILABLE', status: 409 };
  assert.equal(
    patientErrorMessage(error, 'Fallback message', 'ar'),
    'تم حجز هذا الموعد للتو. يرجى اختيار موعد آخر.'
  );
  assert.equal(
    patientErrorMessage(error, 'Fallback message', 'en'),
    'This appointment slot is no longer available. Please select another slot.'
  );

  const verificationError = { code: 'VERIFICATION_CODE_INCORRECT', status: 422 };
  assert.equal(
    patientErrorMessage(verificationError, 'Fallback', 'ar'),
    'رمز التحقق غير صحيح. تحقق من الرمز وحاول مرة أخرى.'
  );
  assert.equal(
    patientErrorMessage(verificationError, 'Fallback', 'en'),
    'Verification code is incorrect. Check the code and try again.'
  );
});

test('unmapped code returns fallback in Arabic and error.message or fallback in English', () => {
  const errorWithMessage = { code: 'UNMAPPED_CODE_123', status: 400, message: 'Custom server message.' };
  assert.equal(
    patientErrorMessage(errorWithMessage, 'بديل مخصص', 'ar'),
    'بديل مخصص'
  );
  assert.equal(
    patientErrorMessage(errorWithMessage, 'Custom fallback', 'en'),
    'Custom server message.'
  );

  const errorWithoutMessage = { code: 'ANOTHER_UNMAPPED', status: 500 };
  assert.equal(
    patientErrorMessage(errorWithoutMessage, 'بديل مخصص', 'ar'),
    'بديل مخصص'
  );
  assert.equal(
    patientErrorMessage(errorWithoutMessage, 'Custom fallback', 'en'),
    'Custom fallback'
  );
});

test('VALIDATION_ERROR returns generic localized text, and appends fields in English only', () => {
  const validationError = {
    code: 'VALIDATION_ERROR',
    status: 422,
    details: [{ field: 'email', message: 'Required' }, { field: 'phone', message: 'Invalid' }]
  };

  assert.equal(
    patientErrorMessage(validationError, 'فشل التحقق', 'ar'),
    'البيانات المدخلة غير صحيحة.'
  );
  assert.equal(
    patientErrorMessage(validationError, 'Validation failed', 'en'),
    'Request validation failed. (fields: email, phone)'
  );

  // Validation error without details array
  const simpleValidation = { code: 'VALIDATION_ERROR', status: 422 };
  assert.equal(
    patientErrorMessage(simpleValidation, 'Validation failed', 'en'),
    'Request validation failed.'
  );
});

test('REQUEST_TIMEOUT returns localized connection message', () => {
  const timeoutError = { code: 'REQUEST_TIMEOUT', status: 0 };
  assert.equal(
    patientErrorMessage(timeoutError, 'Fallback', 'ar'),
    'تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت وحاول مرة أخرى.'
  );
  assert.equal(
    patientErrorMessage(timeoutError, 'Fallback', 'en'),
    'Unable to connect to the server. Please check your internet connection and try again.'
  );
});

test('TypeError and non-ApiClientError without numeric status return localized connection message', () => {
  const typeError = new TypeError('Failed to fetch');
  assert.equal(
    patientErrorMessage(typeError, 'Fallback', 'ar'),
    'تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت وحاول مرة أخرى.'
  );
  assert.equal(
    patientErrorMessage(typeError, 'Fallback', 'en'),
    'Unable to connect to the server. Please check your internet connection and try again.'
  );

  const genericErrorWithoutStatus = new Error('Network offline');
  assert.equal(
    patientErrorMessage(genericErrorWithoutStatus, 'Fallback', 'ar'),
    'تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت وحاول مرة أخرى.'
  );
  assert.equal(
    patientErrorMessage(genericErrorWithoutStatus, 'Fallback', 'en'),
    'Unable to connect to the server. Please check your internet connection and try again.'
  );
});

test('patientErrorMessage defaults language to i18n instance language', async () => {
  await i18n.changeLanguage('ar');
  const error = { code: 'APPOINTMENT_SLOT_UNAVAILABLE', status: 409 };
  assert.equal(
    patientErrorMessage(error, 'Fallback'),
    'تم حجز هذا الموعد للتو. يرجى اختيار موعد آخر.'
  );

  await i18n.changeLanguage('en');
  assert.equal(
    patientErrorMessage(error, 'Fallback'),
    'This appointment slot is no longer available. Please select another slot.'
  );
});
