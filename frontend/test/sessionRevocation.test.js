import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const panel=readFileSync(new URL('../src/features/admin/StaffAccountsPanel.jsx',import.meta.url),'utf8');
const copy=readFileSync(new URL('../src/features/admin/staffMessages.js',import.meta.url),'utf8');
test('session revocation is a distinct confirmed action using the existing endpoint',()=>{
 assert.match(panel,/\/revoke-sessions/);assert.match(panel,/<Dialog /);assert.match(panel,/mutation.current/);
 assert.match(copy,/This ends active sessions only\. It does not deactivate the account, reset the password, or change the role\./);
 assert.match(panel,/row.id === user\?\.id/);
});
