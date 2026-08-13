import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDb = path.join(backendDir, 'prisma', 'test.db');
fs.rmSync(testDb, { force: true });

const env = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: 'file:./test.db',
  JWT_SECRET: 'test-jwt-secret-at-least-thirty-two-characters',
  MEDICAL_ENCRYPTION_KEY: 'test-medical-key-separate-at-least-thirty-two',
  CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
  NOTIFICATIONS_DISABLED: 'true'
  ,VERIFICATION_PROVIDER: 'development'
  ,PHONE_DEFAULT_COUNTRY: 'RW'
};

for (const [command, args] of [
  ['npx', ['prisma', 'migrate', 'deploy']],
  ['node', ['prisma/seed.js']],
  ['node', ['--test', '--test-concurrency=1', 'test/integration.test.js', 'test/patient.test.js']]
]) {
  const result = spawnSync(command, args, { cwd: backendDir, env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
