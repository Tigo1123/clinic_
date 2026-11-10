import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('theme initialization uses a same-origin external script compatible with CSP', () => {
  const html = read('../index.html');
  const initializer = read('../public/theme-init.js');
  const nginx = read('../nginx.conf');
  assert.match(html, /<script src="\/theme-init\.js"><\/script>/);
  assert.doesNotMatch(html, /<script>(.|\n)*?<\/script>/);
  assert.match(initializer, /alshifa_theme/);
  assert.match(initializer, /data-theme/);
  assert.match(nginx, /script-src 'self'/);
});
