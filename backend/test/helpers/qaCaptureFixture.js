export const CAPTURE_ID = '123e4567-e89b-42d3-a456-426614174000';
export const CAPTURE_EMAIL = 'qa-20261106-a1b2c3d4+patient-001@example.invalid';
export const CAPTURE_CODE = '987654';
export const QA_CAPTURE_TEST_ENV = {
  NODE_ENV: 'production', APP_ENV: 'staging', DEPLOYMENT_ENV: 'staging',
  QA_LOAD_TEST_ALLOWED: 'true', QA_VERIFICATION_CAPTURE_ENABLED: 'true',
  QA_VERIFICATION_CAPTURE_TOKEN: 'Synthetic-Capture-Auth-Token-Not-A-Real-Secret',
  QA_VERIFICATION_CAPTURE_STORAGE_KEY: 'a1'.repeat(32), VERIFICATION_PROVIDER: 'email',
  QA_NOTIFICATION_MODE: 'sink', NOTIFICATIONS_DISABLED: 'true', SMS_PROVIDER: 'disabled',
  DATABASE_ENVIRONMENT: 'staging', QA_LOAD_TEST_TARGET_ID: 'staging-qa-diagnostic-fixture',
  QA_EXPECTED_DATABASE_NAME: 'neondb', QA_EXPECTED_DATABASE_SCHEMA: 'public',
  QA_EXPECTED_DATABASE_ROLE: 'clinic_runtime', QA_PAYMENT_MODE: 'disabled',
  DATABASE_URL: 'postgresql://synthetic:fixture@ep-muddy-unit-b4hvj7be-pooler.c-6.us-east-2.aws.neon.tech/neondb?schema=public&sslmode=verify-full&connection_limit=5&pool_timeout=10',
  DIRECT_URL: 'postgresql://synthetic:fixture@ep-muddy-unit-b4hvj7be.c-6.us-east-2.aws.neon.tech/neondb?schema=public&sslmode=verify-full'
};

// A database double, never used by application code. Integration tests use real
// disposable PostgreSQL and independently exercise concurrent consumption.
export function qaCaptureFixture(env = QA_CAPTURE_TEST_ENV) {
  const state = { captures: new Map(), queries: [], challengeQueries: [], transactions: 0,
    challenge: { id: CAPTURE_ID, userId: 'synthetic-user', type: 'REGISTRATION_EMAIL',
      targetNormalized: CAPTURE_EMAIL, usedAt: null, expiresAt: new Date(Date.now() + 600000), createdAt: new Date(),
      authVersion: 0, attemptCount: 0, maxAttempts: 5,
      user: { id: 'synthetic-user', email: CAPTURE_EMAIL, username: CAPTURE_EMAIL,
        role: 'PATIENT', status: 'PENDING_VERIFICATION', authVersion: 0 } } };
  let tail = Promise.resolve();
  const copy = value => value == null ? null : structuredClone(value);
  const prismaClient = {
    $queryRaw: async (parts) => {
      const sql = parts.join(''); state.queries.push(sql);
      if (state.identityError) throw state.identityError;
      return sql.includes('current_database') ? [state.identity || {
        database: env.QA_EXPECTED_DATABASE_NAME, schema: env.QA_EXPECTED_DATABASE_SCHEMA, role: env.QA_EXPECTED_DATABASE_ROLE
      }] : [{ id: 'synthetic-locked-row' }];
    },
    verificationChallenge: { findUnique: async query => {
      state.challengeQueries.push(query);
      if (state.challengeError) throw state.challengeError;
      return state.challenge?.id === query.where.id ? copy(state.challenge) : null;
    } },
    qaVerificationCapture: {
      create: async ({ data }) => {
        if (state.writeError) throw state.writeError;
        if (state.captures.has(data.challengeId)) throw new Error('fixture_duplicate');
        state.captures.set(data.challengeId, copy(data)); return copy(data);
      },
      findUnique: async ({ where }) => {
        if (state.readError) throw state.readError;
        return copy(state.captures.get(where.challengeId));
      },
      deleteMany: async ({ where }) => {
        if (state.deleteError) throw state.deleteError;
        let count = 0;
        for (const [id, value] of state.captures) {
          if (where.challengeId && where.challengeId !== id) continue;
          if (where.codeEncrypted && where.codeEncrypted !== value.codeEncrypted) continue;
          if (where.expiresAt?.lte && value.expiresAt > where.expiresAt.lte) continue;
          state.captures.delete(id); count++;
        }
        return { count };
      }
    },
    $transaction: work => {
      const operation = tail.then(() => { state.transactions++; return work(prismaClient); });
      tail = operation.catch(() => {}); return operation;
    }
  };
  return Object.assign(state, { prismaClient });
}
