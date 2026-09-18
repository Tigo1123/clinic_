import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adminSource = readFileSync(path.join(root, 'src/features/admin/AdminDashboard.jsx'), 'utf8');

test('admin session revocation is a distinct, confirmed security action', () => {
  assert.match(adminSource, /users\/\$\{revokeTarget\.id\}\/revoke-sessions/);
  assert.match(adminSource, /Sign out of all devices/);
  assert.match(adminSource, /This ends active sessions only\. It does not deactivate the account, reset the password, or change the role\./);
  assert.match(adminSource, /revokeTarget && <div className="modal-overlay"/);
  assert.match(adminSource, /Sign out all devices/);
  assert.match(adminSource, /u\.id !== user\?\.id && u\.status === 'ACTIVE'/);
});
