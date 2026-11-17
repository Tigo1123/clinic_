import test from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }
  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }
  setItem(key, value) {
    this.values.set(key, String(value));
  }
  removeItem(key) {
    this.values.delete(key);
  }
}

globalThis.sessionStorage = new MemoryStorage();
globalThis.localStorage = new MemoryStorage();

const { apiErrorMessage, fetchWithAuth, STAFF_ERROR_MESSAGES } = await import('../src/services/staff/staffApi.js');

test('apiErrorMessage returns localized message for mapped codes in Arabic and English', () => {
  const payload = { error: { code: 'INVOICE_ALREADY_PAID', message: 'Invoice is paid.' } };
  const fallbackAr = 'فشل الدفع';
  const fallbackEn = 'Payment failed';

  const resultAr = apiErrorMessage(payload, fallbackAr, 'ar');
  const resultEn = apiErrorMessage(payload, fallbackEn, 'en');

  assert.equal(resultAr, STAFF_ERROR_MESSAGES.INVOICE_ALREADY_PAID.ar);
  assert.equal(resultEn, STAFF_ERROR_MESSAGES.INVOICE_ALREADY_PAID.en);
});

test('apiErrorMessage handles payload.code as alternative to payload.error.code', () => {
  const payload = { code: 'CATALOG_CHANGED', message: 'Catalog changed.' };
  assert.equal(apiErrorMessage(payload, 'بديل', 'ar'), STAFF_ERROR_MESSAGES.CATALOG_CHANGED.ar);
  assert.equal(apiErrorMessage(payload, 'Fallback', 'en'), STAFF_ERROR_MESSAGES.CATALOG_CHANGED.en);
});

test('apiErrorMessage in Arabic returns caller fallback for unmapped code', () => {
  const payload = {
    error: {
      code: 'UNMAPPED_CUSTOM_ERROR',
      message: 'Some internal server detail in English'
    }
  };
  const fallbackAr = 'تعذر إتمام العملية.';

  const result = apiErrorMessage(payload, fallbackAr, 'ar');
  assert.equal(result, fallbackAr);
});

test('apiErrorMessage in English returns backend message for unmapped code', () => {
  const payload = {
    error: {
      code: 'UNMAPPED_CUSTOM_ERROR',
      message: 'Some internal server detail in English'
    }
  };
  const fallbackEn = 'Operation failed.';

  const result = apiErrorMessage(payload, fallbackEn, 'en');
  assert.equal(result, 'Some internal server detail in English');
});

test('apiErrorMessage in English returns fallback when unmapped code has no message', () => {
  const payload = { error: { code: 'UNMAPPED_NO_MESSAGE' } };
  const fallbackEn = 'Operation failed.';

  const result = apiErrorMessage(payload, fallbackEn, 'en');
  assert.equal(result, fallbackEn);
});

test('apiErrorMessage handles { error: "string" } shape: returns error string in English and fallback in Arabic', () => {
  const payload = { error: 'Direct string error from server' };
  const fallbackAr = 'حدث خطأ في النظام.';
  const fallbackEn = 'A system error occurred.';

  const resultAr = apiErrorMessage(payload, fallbackAr, 'ar');
  const resultEn = apiErrorMessage(payload, fallbackEn, 'en');

  assert.equal(resultAr, fallbackAr);
  assert.equal(resultEn, 'Direct string error from server');
});

test('apiErrorMessage for VALIDATION_ERROR appends field names in English only', () => {
  const payload = {
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed.',
      details: [
        { field: 'phone', message: 'Invalid phone' },
        { field: 'dateOfBirth', message: 'Invalid DOB' }
      ]
    }
  };

  const resultEn = apiErrorMessage(payload, 'Validation failed', 'en');
  assert.equal(
    resultEn,
    `${STAFF_ERROR_MESSAGES.VALIDATION_ERROR.en} (fields: phone, dateOfBirth)`
  );

  const resultAr = apiErrorMessage(payload, 'فشل التحقق', 'ar');
  assert.equal(resultAr, STAFF_ERROR_MESSAGES.VALIDATION_ERROR.ar);
});

test('apiErrorMessage handles VALIDATION_ERROR when details is empty or absent', () => {
  const payload = {
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed.'
    }
  };

  const resultEn = apiErrorMessage(payload, 'Validation failed', 'en');
  assert.equal(resultEn, STAFF_ERROR_MESSAGES.VALIDATION_ERROR.en);
});

test('fetchWithAuth timeout aborts and throws TimeoutError with REQUEST_TIMEOUT code', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_url, options) => {
    return new Promise((_resolve, reject) => {
      if (options?.signal) {
        options.signal.addEventListener('abort', () => {
          const abortError = new Error('The operation was aborted');
          abortError.name = 'AbortError';
          reject(abortError);
        });
      }
    });
  };

  try {
    await assert.rejects(
      async () => {
        await fetchWithAuth('/api/test-timeout', { timeoutMs: 25 });
      },
      (err) => {
        assert.equal(err.name, 'TimeoutError');
        assert.equal(err.code, 'REQUEST_TIMEOUT');
        assert.equal(err.message, 'The server took too long to respond.');
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchWithAuth does not override caller-provided signal', async () => {
  const originalFetch = globalThis.fetch;
  let receivedSignal = null;
  const controller = new AbortController();

  globalThis.fetch = (_url, options) => {
    receivedSignal = options?.signal;
    return Promise.resolve({
      status: 200,
      ok: true,
      json: async () => ({ ok: true })
    });
  };

  try {
    await fetchWithAuth('/api/test-signal', { signal: controller.signal, timeoutMs: 50 });
    assert.equal(receivedSignal, controller.signal);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchWithAuth strips timeoutMs from options passed down to fetch', async () => {
  const originalFetch = globalThis.fetch;
  let passedOptions = null;

  globalThis.fetch = (_url, options) => {
    passedOptions = options;
    return Promise.resolve({
      status: 200,
      ok: true,
      json: async () => ({ success: true })
    });
  };

  try {
    await fetchWithAuth('/api/test-options', { timeoutMs: 5000, method: 'GET' });
    assert.equal(passedOptions.timeoutMs, undefined);
    assert.equal(passedOptions.method, 'GET');
    assert.ok(passedOptions.signal);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchWithAuth succeeds when request completes before timeout', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    return {
      status: 200,
      ok: true,
      json: async () => ({ status: 'ok' })
    };
  };

  try {
    const res = await fetchWithAuth('/api/test-quick', { timeoutMs: 1000 });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data, { status: 'ok' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('every code in STAFF_ERROR_MESSAGES has non-empty ar and en strings', () => {
  const codes = Object.keys(STAFF_ERROR_MESSAGES);
  assert.ok(codes.length >= 50, `Expected at least 50 error codes, found ${codes.length}`);
  for (const code of codes) {
    const entry = STAFF_ERROR_MESSAGES[code];
    assert.ok(entry, `Missing entry for code ${code}`);
    assert.equal(typeof entry.ar, 'string', `Entry ${code}.ar should be string`);
    assert.ok(entry.ar.trim().length > 0, `Entry ${code}.ar should not be empty`);
    assert.equal(typeof entry.en, 'string', `Entry ${code}.en should be string`);
    assert.ok(entry.en.trim().length > 0, `Entry ${code}.en should not be empty`);
  }
});

test('apiErrorMessage spot checks for newly added error codes', () => {
  const duplicate = { error: { code: 'POSSIBLE_PATIENT_DUPLICATE' } };
  assert.equal(apiErrorMessage(duplicate, 'fallback', 'ar'), STAFF_ERROR_MESSAGES.POSSIBLE_PATIENT_DUPLICATE.ar);
  assert.equal(apiErrorMessage(duplicate, 'fallback', 'en'), STAFF_ERROR_MESSAGES.POSSIBLE_PATIENT_DUPLICATE.en);

  const labPayment = { error: { code: 'LAB_PAYMENT_REQUIRED' } };
  assert.equal(apiErrorMessage(labPayment, 'fallback', 'ar'), STAFF_ERROR_MESSAGES.LAB_PAYMENT_REQUIRED.ar);
  assert.equal(apiErrorMessage(labPayment, 'fallback', 'en'), STAFF_ERROR_MESSAGES.LAB_PAYMENT_REQUIRED.en);

  const diagnosis = { code: 'DIAGNOSIS_REQUIRED' };
  assert.equal(apiErrorMessage(diagnosis, 'fallback', 'ar'), STAFF_ERROR_MESSAGES.DIAGNOSIS_REQUIRED.ar);
  assert.equal(apiErrorMessage(diagnosis, 'fallback', 'en'), STAFF_ERROR_MESSAGES.DIAGNOSIS_REQUIRED.en);
});
