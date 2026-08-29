import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required for the isolated PostgreSQL test database.');
const parsedTestUrl = new URL(testDatabaseUrl);
if (!['localhost', '127.0.0.1'].includes(parsedTestUrl.hostname) || !parsedTestUrl.pathname.toLowerCase().includes('test')) {
  throw new Error('Test database refused: TEST_DATABASE_URL must target a localhost database whose name contains "test".');
}
parsedTestUrl.searchParams.set('schema', `test_${process.pid}_${Date.now()}`);

const env = {
  ...process.env,
  NODE_ENV: 'test',
  CLINIC_TIME_ZONE: 'Africa/Khartoum',
  DATABASE_URL: parsedTestUrl.toString(),
  SOCKET_REVOCATION_DATABASE_URL: parsedTestUrl.toString(),
  JWT_SECRET: 'test-jwt-secret-at-least-thirty-two-characters',
  MEDICAL_ENCRYPTION_KEY: 'test-medical-key-separate-at-least-thirty-two',
  MFA_ENCRYPTION_KEY: 'test-mfa-key-separate-at-least-thirty-two-characters',
  CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
  NOTIFICATIONS_DISABLED: 'true'
  ,VERIFICATION_PROVIDER: 'development'
  ,PHONE_DEFAULT_COUNTRY: 'RW'
};

for (const [command, args] of [
  ['npx', ['prisma', 'generate']],
  ['npx', ['prisma', 'migrate', 'deploy']],
  ['node', ['prisma/seed.js']],
  ['node', ['--test', '--test-concurrency=1', 'test/access-token.test.js', 'test/clinic-time.test.js', 'test/integration.test.js', 'test/medicine-management.test.js', 'test/medicine-migration.test.js', 'test/mfa.test.js', 'test/mrn-sequence-provisioning.test.js', 'test/password-policy.test.js', 'test/patient-file-projection.test.js', 'test/patient.test.js', 'test/reference-bootstrap.test.js', 'test/seed-security.test.js', 'test/smtp-config.test.js', 'test/socket-revocation.test.js']]
]) {
  const result = spawnSync(command, args, { cwd: backendDir, env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
