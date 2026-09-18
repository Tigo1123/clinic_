import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relativePath) => readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

const compose = read('compose.lan.yml');
const nginx = read('deploy/lan/nginx.conf');
const lanEnvironment = read('deploy/lan/env.example');
const apiClient = read('frontend/src/services/apiClient.js');
const staffApi = read('frontend/src/services/staffApi.js');
const staffSocket = read('frontend/src/services/staffSocket.js');
const frontendEnvironment = read('frontend/.env.example');
const backendServer = read('backend/src/server.js');
const uploadRoutes = read('backend/src/routes/upload.js');
const patientRoutes = read('backend/src/routes/patient.js');

function serviceBlock(name) {
  const match = compose.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9-]*:\\n|^networks:|^volumes:)`, 'm'));
  assert.ok(match, `${name} service must exist`);
  return match[1];
}

test('LAN browser API configuration defaults to relative same-origin paths', () => {
  assert.match(apiClient, /VITE_API_BASE_URL\s*\|\|\s*['"]['"]/);
  assert.match(staffApi, /VITE_STAFF_API_URL\s*\|\|\s*import\.meta\.env\.VITE_API_BASE_URL\s*\|\|\s*['"]['"]/);
  for (const variable of ['VITE_API_BASE_URL', 'VITE_STAFF_API_URL', 'VITE_STAFF_SOCKET_URL']) {
    assert.match(lanEnvironment, new RegExp(`^${variable}=$`, 'm'));
  }
  assert.doesNotMatch(`${apiClient}\n${staffApi}\n${lanEnvironment}`, /https?:\/\/(?:backend|localhost|127\.0\.0\.1)(?::5000)?/i);
});

test('production Socket.IO falls back to the browser origin and standard path', () => {
  assert.match(staffSocket, /VITE_STAFF_SOCKET_URL/);
  assert.match(staffSocket, /environment\.DEV\s*\?\s*['"]http:\/\/localhost:5000['"]\s*:\s*globalThis\.window\?\.location\?\.origin/);
  assert.doesNotMatch(lanEnvironment, /^VITE_STAFF_SOCKET_URL=.+$/m);
  assert.match(nginx, /location \/socket\.io\/ \{/);
  assert.match(nginx, /proxy_http_version 1\.1;/);
  assert.match(nginx, /proxy_set_header Upgrade \$http_upgrade;/);
  assert.match(nginx, /proxy_set_header Connection ['"]upgrade['"];/);
});

test('Nginx preserves API paths, forwarded headers, and same-origin readiness', () => {
  assert.match(nginx, /set \$backend_upstream backend:5000;/);
  assert.match(nginx, /location \/api\/ \{[\s\S]*?proxy_pass http:\/\/\$backend_upstream;/);
  for (const header of ['Host', 'X-Real-IP', 'X-Forwarded-For', 'X-Forwarded-Host', 'X-Forwarded-Proto']) {
    assert.match(nginx, new RegExp(`proxy_set_header ${header} `));
  }
  assert.match(backendServer, /app\.get\(\['\/api\/health', '\/api\/health\/ready'\]/);
  assert.match(serviceBlock('backend'), /^      TRUST_PROXY: ['"]true['"]$/m);
});

test('LAN CORS is one explicit non-wildcard test-bench origin', () => {
  const origin = lanEnvironment.match(/^CORS_ALLOWED_ORIGINS=(.+)$/m)?.[1];
  assert.equal(origin, 'https://clinic-server.example.internal');
  assert.notEqual(origin, '*');
  assert.doesNotMatch(origin, /,/);
  assert.match(backendServer, /corsMiddleware\(allowedOrigins\)/);
  assert.match(backendServer, /cors:\s*\{[\s\S]*?origin: allowedOrigins/);
});

test('upload and patient attachment responses remain relative to the LAN origin', () => {
  assert.match(uploadRoutes, /filePath: `\/api\/upload\/\$\{filename\}`/);
  assert.doesNotMatch(uploadRoutes, /filePath:\s*[`'"]https?:\/\//);
  assert.match(patientRoutes, /`\/api\/upload\/\$\{[^}]+\.split\('\/'\)\.pop\(\)\}`/);
});

test('LAN browser and deployment configuration has no Render endpoint or published private port', () => {
  const browserAndLanConfiguration = [
    apiClient, staffApi, staffSocket, frontendEnvironment,
    compose, nginx, lanEnvironment, read('deploy/lan/README.md')
  ].join('\n');
  assert.doesNotMatch(browserAndLanConfiguration, /(?:^|[./-])render\.com\b|onrender\.com\b/i);
  assert.doesNotMatch(serviceBlock('backend'), /^    ports:/m);
  assert.doesNotMatch(serviceBlock('postgres'), /^    ports:/m);
  assert.match(serviceBlock('frontend'), /^    ports:\n      - ['"]\$\{LAN_BIND_IP:\?LAN_BIND_IP is required\}:443:443['"]/m);
  assert.doesNotMatch(serviceBlock('frontend'), /8080:8080/);
  assert.doesNotMatch(serviceBlock('backend'), /^      - lan-edge$/m);
  assert.match(serviceBlock('frontend'), /^      - lan-edge$/m);
});
