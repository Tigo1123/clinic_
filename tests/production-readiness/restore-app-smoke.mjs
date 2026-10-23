import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const runtimeInput = process.env.STAGING_RUNTIME_URL;
const listenerInput = process.env.STAGING_LISTENER_URL;
if (!runtimeInput || !listenerInput) throw new Error('Staging role URLs are required.');
const target = (input, database) => {
  const url = new URL(input);
  if (url.hostname !== '127.0.0.1' || url.port !== '55439') {
    throw new Error('Refusing app smoke outside guarded loopback PostgreSQL.');
  }
  url.pathname = `/${database}`;
  return url.href;
};

const port = 55127;
const env = {
  ...process.env,
  NODE_ENV: 'test',
  DEPLOYMENT_ENV: 'test',
  DATABASE_URL: target(runtimeInput, 'shifa_restore'),
  DIRECT_URL: target(runtimeInput, 'shifa_restore'),
  SOCKET_REVOCATION_DATABASE_URL: target(listenerInput, 'shifa_restore'),
  RATE_LIMIT_STORE: 'postgres',
  STAFF_MFA_POLICY: 'optional',
  JWT_SECRET: 'pass2-smoke-jwt-secret-minimum-length-only',
  MEDICAL_ENCRYPTION_KEY: 'pass2-smoke-medical-key-minimum-length',
  MFA_ENCRYPTION_KEY: 'pass2-smoke-mfa-key-minimum-length',
  CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
  NOTIFICATIONS_DISABLED: 'true',
  VERIFICATION_PROVIDER: 'development',
  PHONE_VERIFICATION_PROVIDER: 'development',
  PHONE_DEFAULT_COUNTRY: 'RW',
  PORT: String(port),
};
const child = spawn(process.execPath, ['src/server.js'], {
  cwd: new URL('../../backend/', import.meta.url),
  env,
  stdio: ['ignore', 'ignore', 'ignore'],
});
let result;
const started = Date.now();
try {
  for (let i = 0; i < 50; i += 1) {
    if (child.exitCode !== null) throw new Error('Application exited before readiness.');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health/ready`, { signal: AbortSignal.timeout(1000) });
      const body = await response.json();
      if (response.ok && body.status === 'healthy') {
        result = { status: 'healthy', httpStatus: response.status, startupMs: Date.now() - started };
        break;
      }
    } catch {
      // Poll only the local disposable instance while it boots.
    }
    await delay(200);
  }
} finally {
  child.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(3000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
if (!result) throw new Error('Application did not become ready against the restored clone.');
console.log(JSON.stringify(result));
