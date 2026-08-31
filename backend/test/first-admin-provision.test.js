import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { readPassword } from '../scripts/provision-first-admin.js';

function fixture(contents, mode = 0o600) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-first-admin-'));
  const file = path.join(dir, 'password');
  fs.writeFileSync(file, contents, { mode });
  fs.chmodSync(file, mode);
  return { dir, file };
}

test('first-admin password file accepts one valid 0600 line with one trailing newline', () => {
  const target = fixture('ValidPass1\n');
  try { assert.equal(readPassword(target.file), 'ValidPass1'); } finally { fs.rmSync(target.dir, { recursive: true, force: true }); }
  const crlf = fixture('ValidPass1\r\n');
  try { assert.equal(readPassword(crlf.file), 'ValidPass1'); } finally { fs.rmSync(crlf.dir, { recursive: true, force: true }); }
});

test('first-admin password file rejects missing, weak, multiline, and unsafe-permission inputs', () => {
  const missing = path.join(os.tmpdir(), `clinic-first-admin-missing-${Date.now()}`);
  assert.throws(() => readPassword(missing));
  for (const [contents, mode] of [['weak\n', 0o600], ['ValidPass1\nsecond\n', 0o600], ['ValidPass1\n', 0o640]]) {
    const target = fixture(contents, mode);
    try { assert.throws(() => readPassword(target.file)); } finally { fs.rmSync(target.dir, { recursive: true, force: true }); }
  }
});
