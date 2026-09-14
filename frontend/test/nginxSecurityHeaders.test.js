import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const relative of ['nginx.conf', '../deploy/lan/nginx.conf']) {
  test(`frontend document CSP is configured in ${relative}`, () => {
    const config = readFileSync(path.resolve(root, relative), 'utf8');
    assert.match(config, /Content-Security-Policy/);
    assert.match(config, /script-src 'self'/);
    assert.match(config, /frame-ancestors 'none'/);
    assert.match(config, /connect-src 'self'/);
    assert.doesNotMatch(config, /unsafe-eval|script-src[^;]*unsafe-inline/);
    assert.doesNotMatch(config, /(?:default-src|connect-src|script-src|style-src|frame-ancestors)[^;]*\*/);
  });
}

test('LAN TLS edge owns HSTS without applying it to the non-TLS frontend config', () => {
  const lanConfig = readFileSync(path.resolve(root, '../deploy/lan/nginx.conf'), 'utf8');
  const standardConfig = readFileSync(path.resolve(root, 'nginx.conf'), 'utf8');

  assert.match(lanConfig, /Strict-Transport-Security "max-age=31536000" always/);
  assert.doesNotMatch(standardConfig, /Strict-Transport-Security/);
});
