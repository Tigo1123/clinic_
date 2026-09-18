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

const { publicApiRequest, ApiClientError } = await import('../src/services/apiClient.js');

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
