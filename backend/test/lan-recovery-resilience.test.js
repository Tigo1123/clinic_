import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const compose = read('compose.lan.yml');
const server = read('backend/src/server.js');
const revocation = read('backend/src/services/socketRevocation.js');
const verify = read('deploy/lan/verify-recovery.sh');
const readme = read('deploy/lan/README.md');
const nginx = read('deploy/lan/nginx.conf');
const backendDockerfile = read('backend/Dockerfile');

function runRecoveryVerifier(portScenario, portBindingsRepresentation = '{}', recoveryOrigin = 'https://clinic-server.example.internal') {
  const fakeBin = mkdtempSync(path.join(os.tmpdir(), 'lan-recovery-test-'));
  const fakeDocker = path.join(fakeBin, 'docker');
  const fakeCurl = path.join(fakeBin, 'curl');
  writeFileSync(fakeDocker, `#!/bin/sh
if [ "$1" = compose ]; then
  service=""
  for argument in "$@"; do
    case "$argument" in postgres|backend|frontend) service="$argument";; esac
  done
  [ -n "$service" ] && printf '%s-id\\n' "$service"
elif [ "$1" = inspect ]; then
  case "$3" in
    *State.Status*) printf 'running\\n';;
    *State.Health*) printf 'healthy\\n';;
    *HostConfig.PortBindings*) printf '%s\\n' "\${FAKE_PORT_BINDINGS}";;
    *Mounts*) printf 'persistent-volume\\n';;
  esac
elif [ "$1" = port ]; then
  container="$2"
  case "\${FAKE_PORT_SCENARIO}:$container" in
    backend-mapped:backend-id) printf '5000/tcp -> 0.0.0.0:5000\\n';;
    postgres-mapped:postgres-id) printf '5432/tcp -> 0.0.0.0:5432\\n';;
    missing-https:frontend-id) :;;
    public-http:frontend-id) printf '443/tcp -> 127.0.0.1:443\\n8080/tcp -> 0.0.0.0:8080\\n';;
    *:frontend-id) printf '443/tcp -> 127.0.0.1:443\\n';;
  esac
fi
`);
  writeFileSync(fakeCurl, '#!/bin/sh\nexit 0\n');
  chmodSync(fakeDocker, 0o755);
  chmodSync(fakeCurl, 0o755);
  try {
    return spawnSync('sh', [path.join(root, 'deploy/lan/verify-recovery.sh')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        RECOVERY_ORIGIN: recoveryOrigin,
        COMPOSE_ENV_FILE: '/not-read-by-fake-docker',
        FAKE_PORT_SCENARIO: portScenario,
        FAKE_PORT_BINDINGS: portBindingsRepresentation,
      },
    });
  } finally {
    rmSync(fakeBin, { recursive: true, force: true });
  }
}

function block(name) {
  const found = compose.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9-]*:\\n|^networks:|^volumes:)`, 'm'));
  assert.ok(found, `${name} service missing`);
  return found[1];
}

test('long-running and one-shot restart policies remain distinct', () => {
  for (const service of ['postgres', 'backend', 'frontend']) assert.match(block(service), /^    restart: unless-stopped$/m);
  for (const service of ['database-bootstrap', 'first-admin', 'backup']) {
    assert.match(block(service), /^    profiles:/m);
    assert.match(block(service), /^    restart: "no"$/m);
  }
});

test('health, dependencies, private ports, persistence, and bounded logs are retained', () => {
  for (const service of ['postgres', 'backend', 'frontend']) {
    assert.match(block(service), /^    healthcheck:$/m);
    assert.match(block(service), /^    logging:/m);
  }
  assert.match(block('backend'), /depends_on:[\s\S]*postgres:[\s\S]*condition: service_healthy/);
  assert.match(block('frontend'), /depends_on:[\s\S]*backend:[\s\S]*condition: service_healthy/);
  assert.doesNotMatch(block('postgres'), /^    ports:/m);
  assert.doesNotMatch(block('backend'), /^    ports:/m);
  assert.match(compose, /lan-postgres-data:\/var\/lib\/postgresql\/data/);
  assert.match(compose, /lan-uploads-data:\/app\/uploads/);
  assert.match(compose, /max-size: "10m"/);
  assert.match(compose, /max-file: "5"/);
});

test('readiness fails closed for database or revocation authority loss', () => {
  assert.match(server, /await prisma\.\$queryRaw`SELECT 1`/);
  assert.match(server, /!socketRevocation\.isReady\(\)/);
  assert.match(server, /socketRevocation: 'disconnected'/);
  assert.match(server, /status\(503\)/);
  assert.match(server, /socketRevocation: 'connected'/);
});

test('same-origin proxy re-resolves a recreated backend through Docker DNS', () => {
  assert.match(nginx, /resolver 127\.0\.0\.11 valid=5s ipv6=off;/);
  assert.match(nginx, /set \$backend_upstream backend:5000;/);
  assert.equal((nginx.match(/proxy_pass http:\/\/\$backend_upstream;/g) || []).length, 2);
});

test('revocation listener reconnects with bounded backoff and fails closed', () => {
  assert.match(revocation, /client\.on\('error', unhealthy\)/);
  assert.match(revocation, /client\.on\('end'/);
  assert.match(revocation, /#scheduleReconnect\(\)/);
  assert.match(revocation, /Math\.min\(1000 \* \(2 \*\* this\.reconnectAttempt\), 10000\)/);
  assert.match(revocation, /if \(!this\.isReady\(\)\) this\.#disconnectAll\(\)/);
  assert.match(revocation, /await client\.query\(`LISTEN/);
});

test('graceful shutdown closes revocation, Socket.IO, HTTP, and Prisma resources', () => {
  const order = ['await socketRevocation.stop()', 'io.close()', 'httpServer.close', 'await prisma.$disconnect()'];
  let previous = -1;
  for (const marker of order) { const index = server.indexOf(marker); assert.ok(index > previous, `${marker} missing or out of order`); previous = index; }
  assert.match(server, /\['SIGTERM', 'SIGINT'\]/);
  assert.match(backendDockerfile, /CMD \["node", "src\/server\.js"\]/);
  assert.doesNotMatch(backendDockerfile, /CMD \["npm"/);
});

test('operator recovery verification is non-destructive and same-origin', () => {
  assert.match(verify, /postgres backend frontend/);
  assert.match(verify, /State\.Health/);
  assert.doesNotMatch(verify, /PortBindings/);
  assert.match(verify, /docker port/);
  assert.match(verify, /\/api\/health\/ready/);
  assert.match(verify, /\/healthz/);
  assert.match(verify, /https:\/\//);
  assert.match(verify, /\/var\/lib\/postgresql\/data/);
  assert.match(verify, /\/app\/uploads/);
  assert.doesNotMatch(verify, /\b(?:migrate|reset|seed|dropdb|rm|prune)\b|down\s+-v|docker\s+(?:stop|restart|kill)/i);
});

test('recovery verifier accepts private services with either Docker PortBindings representation', () => {
  for (const representation of ['{}', 'null']) {
    const result = runRecoveryVerifier('private', representation);
    assert.equal(result.status, 0, `${representation}: ${result.stderr}`);
    assert.match(result.stdout, /verification passed/);
  }
});

test('recovery verifier rejects an actual backend host mapping', () => {
  const result = runRecoveryVerifier('backend-mapped');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /backend unexpectedly publishes a host port/);
});

test('recovery verifier rejects an actual PostgreSQL host mapping', () => {
  const result = runRecoveryVerifier('postgres-mapped');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PostgreSQL unexpectedly publishes a host port/);
});

test('recovery verifier requires frontend HTTPS publication', () => {
  const result = runRecoveryVerifier('missing-https');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /frontend does not publish HTTPS port 443/);
});

test('recovery verifier rejects frontend public HTTP publication', () => {
  const result = runRecoveryVerifier('public-http');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /frontend unexpectedly publishes public HTTP port 8080/);
});

test('recovery verifier does not hard-code the real clinic address', () => {
  assert.doesNotMatch(verify, /\b192\.168\.\d{1,3}\.\d{1,3}\b/);
});

test('recovery verifier rejects a non-HTTPS recovery origin', () => {
  const result = runRecoveryVerifier('private', '{}', 'http://clinic-server.example.internal:8080');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /RECOVERY_ORIGIN must be an HTTPS origin/);
});

test('documentation forbids destructive volume recovery and records physical reboot limitation', () => {
  assert.match(readme, /Physical power-loss\/host-reboot acceptance remains unproven\./);
  assert.match(readme, /never.*down -v/i);
  assert.match(readme, /systemctl is-enabled docker/);
  assert.match(readme, /verify-recovery\.sh/);
  assert.match(readme, /socket.*revocation.*reconnect/is);
});
