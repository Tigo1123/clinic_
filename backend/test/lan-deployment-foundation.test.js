import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relativePath) => readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
const compose = read('compose.lan.yml');
const nginx = read('deploy/lan/nginx.conf');
const exampleEnvironment = read('deploy/lan/env.example');
const readme = read('deploy/lan/README.md');
const lanFiles = `${compose}\n${nginx}\n${exampleEnvironment}\n${readme}`;

function serviceBlock(name) {
  const match = compose.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9-]*:\\n|^networks:|^volumes:)`, 'm'));
  assert.ok(match, `${name} service must exist`);
  return match[1];
}

test('only the frontend publishes a host port', () => {
  assert.doesNotMatch(serviceBlock('postgres'), /^    ports:/m);
  assert.doesNotMatch(serviceBlock('backend'), /^    ports:/m);
  assert.match(serviceBlock('frontend'), /^    ports:\n      - "8080:8080"/m);
  assert.equal((compose.match(/^    ports:/gm) || []).length, 1);
});

test('long-running services retain restart policies, health checks, and persistence', () => {
  for (const service of ['postgres', 'backend', 'frontend']) {
    assert.match(serviceBlock(service), /^    restart: unless-stopped$/m);
    assert.match(serviceBlock(service), /^    healthcheck:$/m);
  }
  assert.match(serviceBlock('postgres'), /lan-postgres-data:\/var\/lib\/postgresql\/data/);
  assert.match(serviceBlock('backend'), /lan-uploads-data:\/app\/uploads/);
  assert.match(compose, /^  lan-postgres-data:$/m);
  assert.match(compose, /^  lan-uploads-data:$/m);
  assert.match(compose, /^  lan-app:\n    internal: true$/m);
  assert.match(compose, /^  lan-data:\n    internal: true$/m);
});

test('same-origin API and Socket.IO proxy routes remain present', () => {
  assert.match(nginx, /location \/api\/ \{/);
  assert.match(nginx, /location \/socket\.io\/ \{/);
  assert.match(nginx, /proxy_pass http:\/\/backend:5000;/);
  assert.match(nginx, /proxy_set_header Upgrade \$http_upgrade;/);
  assert.match(nginx, /try_files \$uri \$uri\/ \/index\.html;/);
});

test('LAN deployment files contain no Render endpoint or committed usable secret', () => {
  assert.doesNotMatch(lanFiles, /(?:^|[./-])render\.com\b|onrender\.com\b/i);
  assert.doesNotMatch(exampleEnvironment, /^(?:POSTGRES_PASSWORD|JWT_SECRET|MEDICAL_ENCRYPTION_KEY|MFA_ENCRYPTION_KEY|SMTP_PASS)=(?!REPLACE_).+$/m);
  assert.match(exampleEnvironment, /^VITE_API_BASE_URL=$/m);
  assert.match(exampleEnvironment, /^VITE_STAFF_API_URL=$/m);
  assert.match(exampleEnvironment, /^VITE_STAFF_SOCKET_URL=$/m);
});
