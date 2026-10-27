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

const { publicApiRequest, ApiClientError, localizedApiErrorMessage } = await import('../src/services/apiClient.js');
const { apiErrorMessage } = await import('../src/services/staffApi.js');
const i18n = (await import('../src/i18n.js')).default;

function mockResponse(status, body) {
  return Promise.resolve({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body
  });
}

test('HTTP 409 {"status":"ACCOUNT_LINK_REQUIRED"} yields ApiClientError.code === "ACCOUNT_LINK_REQUIRED"', async () => {
  globalThis.fetch = async () => mockResponse(409, { status: 'ACCOUNT_LINK_REQUIRED' });

  await assert.rejects(
    async () => {
      await publicApiRequest('/api/patient-auth/google/verify', { method: 'POST' });
    },
    (err) => {
      assert.ok(err instanceof ApiClientError);
      assert.equal(err.status, 409);
      assert.equal(err.code, 'ACCOUNT_LINK_REQUIRED');
      return true;
    }
  );
});

test('HTTP 409 {"status":"REGISTRATION_PENDING"} yields ApiClientError.code === "REGISTRATION_PENDING"', async () => {
  globalThis.fetch = async () => mockResponse(409, { status: 'REGISTRATION_PENDING' });

  await assert.rejects(
    async () => {
      await publicApiRequest('/api/patient-auth/google/verify', { method: 'POST' });
    },
    (err) => {
      assert.ok(err instanceof ApiClientError);
      assert.equal(err.status, 409);
      assert.equal(err.code, 'REGISTRATION_PENDING');
      return true;
    }
  );
});

test('existing error contracts with {"code":"..."} continue working unchanged', async () => {
  globalThis.fetch = async () => mockResponse(400, { code: 'CUSTOM_CODE', message: 'Bad request.' });

  await assert.rejects(
    async () => {
      await publicApiRequest('/api/auth/test');
    },
    (err) => {
      assert.ok(err instanceof ApiClientError);
      assert.equal(err.status, 400);
      assert.equal(err.code, 'CUSTOM_CODE');
      return true;
    }
  );
});

test('existing error contracts with {"error":{"code":"..."}} continue working unchanged', async () => {
  globalThis.fetch = async () => mockResponse(403, { error: { code: 'FORBIDDEN_ACTION', message: 'Not allowed.' } });

  await assert.rejects(
    async () => {
      await publicApiRequest('/api/auth/test');
    },
    (err) => {
      assert.ok(err instanceof ApiClientError);
      assert.equal(err.status, 403);
      assert.equal(err.code, 'FORBIDDEN_ACTION');
      return true;
    }
  );
});

test('clinical data unreadable response preserves the stable sanitized code and message', async () => {
  globalThis.fetch = async () => mockResponse(500, {
    error: { code: 'CLINICAL_DATA_UNREADABLE', message: 'Clinical information is unavailable.' }
  });

  await assert.rejects(
    async () => publicApiRequest('/api/records/synthetic-id/summary'),
    (err) => {
      assert.ok(err instanceof ApiClientError);
      assert.equal(err.status, 500);
      assert.equal(err.code, 'CLINICAL_DATA_UNREADABLE');
      assert.equal(err.message, 'غير متاح');
      assert.equal(err.serverMessage, 'Clinical information is unavailable.');
      return true;
    }
  );
});

test('stable API error codes render localized, non-raw messages in both languages', async () => {
  await i18n.changeLanguage('ar');
  assert.equal(localizedApiErrorMessage({ code: 'INVALID_CREDENTIALS' }), 'اسم المستخدم أو كلمة المرور غير صحيحة.');
  assert.equal(apiErrorMessage({ error: { code: 'EMAIL_ALREADY_REGISTERED', message: 'English backend detail' } }), 'يوجد حساب بالفعل بهذا البريد الإلكتروني.');
  assert.equal(localizedApiErrorMessage({ code: 'MFA_CODE_INVALID' }), i18n.t('mfaCodeInvalid'));
  assert.equal(localizedApiErrorMessage({ code: 'NETWORK_ERROR' }), 'تعذر الاتصال بالخدمة. تحقق من اتصالك وحاول مرة أخرى.');
  await i18n.changeLanguage('en');
  assert.equal(localizedApiErrorMessage({ code: 'INVALID_CREDENTIALS' }), 'The username or password is incorrect.');
  assert.equal(apiErrorMessage({ error: { code: 'EMAIL_ALREADY_REGISTERED', message: 'تفاصيل داخلية' } }), 'An account already exists for this email address.');
  assert.equal(localizedApiErrorMessage({ code: 'MFA_CODE_INVALID' }), i18n.t('mfaCodeInvalid'));
  assert.equal(localizedApiErrorMessage({ code: 'NETWORK_ERROR' }), 'The service could not be reached. Check your connection and try again.');
  await i18n.changeLanguage('ar');
});

test('staff login 401 without a backend code maps by request action to localized invalid credentials', async () => {
  await i18n.changeLanguage('ar');
  globalThis.fetch = async () => mockResponse(401, { error: 'Invalid username or password.' });
  await assert.rejects(publicApiRequest('/api/auth/login', { method: 'POST', body: '{}' }), error => {
    assert.equal(error.code, 'INVALID_CREDENTIALS');
    assert.equal(error.message, 'اسم المستخدم أو كلمة المرور غير صحيحة.');
    return true;
  });
  await i18n.changeLanguage('en');
  globalThis.fetch = async () => mockResponse(401, { error: 'Invalid username or password.' });
  await assert.rejects(publicApiRequest('/api/auth/login', { method: 'POST', body: '{}' }), error => {
    assert.equal(error.message, 'The username or password is incorrect.');
    return true;
  });
  await i18n.changeLanguage('ar');
});

test('unmapped backend messages and network exceptions do not leak raw English', async () => {
  await i18n.changeLanguage('ar');
  globalThis.fetch = async () => mockResponse(400, { error: { code: 'UNMAPPED_CODE', message: 'Internal English message' } });
  await assert.rejects(publicApiRequest('/test'), error => {
    assert.equal(error.code, 'UNMAPPED_CODE');
    assert.equal(error.message, 'تعذر إكمال الطلب. حاول مرة أخرى.');
    assert.equal(error.serverMessage, 'Internal English message');
    return true;
  });
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(publicApiRequest('/test'), error => {
    assert.equal(error.code, 'NETWORK_ERROR');
    assert.equal(error.message, 'تعذر الاتصال بالخدمة. تحقق من اتصالك وحاول مرة أخرى.');
    return true;
  });
  await i18n.changeLanguage('ar');
});

test('request cancellation keeps AbortError semantics', async () => {
  globalThis.fetch = async () => { const error = new Error('aborted'); error.name = 'AbortError'; throw error; };
  await assert.rejects(publicApiRequest('/test'), error => error.name === 'AbortError');
});

test('null error bodies preserve HTTP status and localized failures', async () => {
  await i18n.changeLanguage('ar');
  for (const [status, expected] of [[429, 'apiErrorRateLimited'], [503, 'apiErrorServiceUnavailable'], [400, 'apiErrorRequestFailed']]) {
    globalThis.fetch = async () => mockResponse(status, { error: null });
    await assert.rejects(publicApiRequest('/test'), error => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.status, status);
      assert.equal(error.message, i18n.t(expected));
      return true;
    });
  }
});

test('password and inactive-account failures give actionable translated guidance', async () => {
  for (const lang of ['ar', 'en']) {
    await i18n.changeLanguage(lang);
    for (const [code, key] of [['CURRENT_PASSWORD_INVALID', 'apiErrorCurrentPassword'], ['PASSWORD_REUSE_NOT_ALLOWED', 'apiErrorPasswordReuse'], ['ACCOUNT_INACTIVE', 'apiErrorAccountInactive']]) {
      assert.equal(apiErrorMessage({ error: { code, message: 'PRIVATE BACKEND DETAIL' } }), i18n.t(key));
    }
    assert.notEqual(i18n.t('staffRole_LAB_TECH'), 'LAB_TECH');
  }
  await i18n.changeLanguage('ar');
});

test('precedence: payload.code > error.code > payload.status > REQUEST_FAILED', async () => {
  // payload.code wins over error.code and payload.status
  globalThis.fetch = async () => mockResponse(409, { code: 'WINNER', error: { code: 'LOSER_1' }, status: 'LOSER_2' });
  await assert.rejects(
    async () => publicApiRequest('/test'),
    (err) => {
      assert.equal(err.code, 'WINNER');
      return true;
    }
  );

  // error.code wins over payload.status
  globalThis.fetch = async () => mockResponse(409, { error: { code: 'WINNER_ERROR' }, status: 'LOSER_STATUS' });
  await assert.rejects(
    async () => publicApiRequest('/test'),
    (err) => {
      assert.equal(err.code, 'WINNER_ERROR');
      return true;
    }
  );
});

test('arbitrary non-string status values are not treated as error codes', async () => {
  globalThis.fetch = async () => mockResponse(500, { status: 500 });

  await assert.rejects(
    async () => publicApiRequest('/test'),
    (err) => {
      assert.equal(err.code, 'REQUEST_FAILED');
      return true;
    }
  );
});

test('missing code and status fallback to REQUEST_FAILED', async () => {
  globalThis.fetch = async () => mockResponse(500, {});

  await assert.rejects(
    async () => publicApiRequest('/test'),
    (err) => {
      assert.equal(err.code, 'REQUEST_FAILED');
      return true;
    }
  );
});

const { apiFetch } = await import('../src/services/apiClient.js');
const { writeStaffSession, readStaffSession } = await import('../src/services/authStorage.js');

function withClone(status, body) {
  const make = () => ({ status, ok: status >= 200 && status < 300, json: async () => body, clone: make });
  return Promise.resolve(make());
}

async function sessionAfter(status, body) {
  const redirects = [];
  globalThis.window = { location: { replace: (url) => redirects.push(url) } };
  writeStaffSession({ role: 'ADMIN', id: 'u1' }, 'token-abc');
  globalThis.fetch = async () => withClone(status, body);
  await apiFetch('/api/admin/x', {}, 'staff');
  return { session: readStaffSession(), redirects };
}

test('401 with a session-ending code clears the session and redirects', async () => {
  for (const code of ['INVALID_TOKEN', 'SESSION_REVOKED', 'AUTHENTICATION_REQUIRED']) {
    const { session, redirects } = await sessionAfter(401, { error: { code } });
    assert.equal(session, null, code);
    assert.deepEqual(redirects, ['/staff'], code);
  }
});

test('401 for a wrong re-authentication password keeps the session', async () => {
  for (const code of ['CURRENT_PASSWORD_INVALID', 'ADMIN_REAUTHENTICATION_FAILED', 'MFA_REAUTH_FAILED', 'REAUTHENTICATION_FAILED']) {
    const { session, redirects } = await sessionAfter(401, { error: { code } });
    assert.ok(session, code);
    assert.deepEqual(redirects, [], code);
  }
});

test('503 service unavailable keeps the session', async () => {
  const { session, redirects } = await sessionAfter(503, { error: { code: 'SERVICE_UNAVAILABLE' } });
  assert.ok(session);
  assert.deepEqual(redirects, []);
});

test('401 without a recognizable code still ends the session', async () => {
  const { session } = await sessionAfter(401, {});
  assert.equal(session, null);
});
