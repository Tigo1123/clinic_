import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
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

function block(name) {
  const found = compose.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9-]*:\\n|^networks:|^volumes:)`, 'm'));
  assert.ok(found, `${name} service missing`);
  return found[1];
}

test('long-running and one-shot restart policies remain distinct', () => {
  for (const service of ['postgres', 'backend', 'frontend']) assert.match(block(service), /^    restart: unless-stopped$/m);
  for (const service of ['database-bootstrap', 'backup']) {
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
  assert.match(verify, /PortBindings/);
  assert.match(verify, /\/api\/health\/ready/);
  assert.match(verify, /\/healthz/);
  assert.match(verify, /\/var\/lib\/postgresql\/data/);
  assert.match(verify, /\/app\/uploads/);
  assert.doesNotMatch(verify, /\b(?:migrate|reset|seed|dropdb|rm|prune)\b|down\s+-v|docker\s+(?:stop|restart|kill)/i);
});

test('documentation forbids destructive volume recovery and records physical reboot limitation', () => {
  assert.match(readme, /Physical power-loss\/host-reboot acceptance remains unproven\./);
  assert.match(readme, /never.*down -v/i);
  assert.match(readme, /systemctl is-enabled docker/);
  assert.match(readme, /verify-recovery\.sh/);
  assert.match(readme, /socket.*revocation.*reconnect/is);
});
