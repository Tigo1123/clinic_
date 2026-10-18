import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');

test('frontend image declares public Google ID before the Vite build', () => {
  const dockerfile = read('../Dockerfile');
  assert.match(dockerfile, /ARG VITE_GOOGLE_CLIENT_ID=\nENV VITE_GOOGLE_CLIENT_ID=\$\{VITE_GOOGLE_CLIENT_ID\}/);
  assert.ok(dockerfile.indexOf('ENV VITE_GOOGLE_CLIENT_ID') < dockerfile.indexOf('RUN npm run build'));
  assert.doesNotMatch(dockerfile, /GOOGLE_CLIENT_SECRET/);
});
for (const file of ['../../docker-compose.yml', '../../compose.lan.yml']) {
  test(`${file} forwards optional public build ID and runtime verifier ID separately`, () => {
    const compose = read(file);
    const backend = compose.split('\n  backend:')[1].split('\n  frontend:')[0];
    const frontend = compose.split('\n  frontend:')[1];
    assert.match(backend, /environment:[\s\S]*GOOGLE_CLIENT_ID: \$\{GOOGLE_CLIENT_ID:-\}/);
    assert.match(frontend, /build:[\s\S]*args:[\s\S]*VITE_GOOGLE_CLIENT_ID: \$\{VITE_GOOGLE_CLIENT_ID:-\}/);
    assert.doesNotMatch(backend, /VITE_GOOGLE_CLIENT_ID/);
  });
}
for (const file of ['../nginx.conf', '../../deploy/lan/nginx.conf']) {
  test(`${file} allows exactly the documented GIS CSP sources`, () => {
    const config = read(file);
    const policy = config.match(/Content-Security-Policy "([^"]+)"/)[1];
    const directives = Object.fromEntries(policy.split(';').map(s => s.trim().split(/\s+/)).map(([key, ...values]) => [key, values]));
    assert.deepEqual(directives['script-src'], ["'self'", 'https://accounts.google.com/gsi/client']);
    assert.deepEqual(directives['style-src'], ["'self'", "'unsafe-inline'", 'https://accounts.google.com/gsi/style']);
    assert.deepEqual(directives['connect-src'], ["'self'", 'https://accounts.google.com/gsi/']);
    assert.deepEqual(directives['frame-src'], ['https://accounts.google.com/gsi/']);
    assert.deepEqual(directives['default-src'], ["'self'"]);
    assert.doesNotMatch(policy, /\*|unsafe-eval/);
    assert.match(config, /Referrer-Policy "strict-origin-when-cross-origin"/);
  });
}
