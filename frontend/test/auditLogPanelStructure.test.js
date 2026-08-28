import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const component = fs.readFileSync(new URL('../src/features/admin/AuditLogPanel.jsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/features/admin/auditLog.css', import.meta.url), 'utf8');

test('audit panel retains explicit loading, empty, error, desktop, and responsive layouts', () => {
  for (const contract of ['auditLoading', 'auditEmpty', 'auditLoadError', 'audit-table-wrap', 'audit-cards']) {
    assert.match(component, new RegExp(contract));
  }
  assert.match(styles, /@media\(max-width:760px\)/);
  assert.match(styles, /\.audit-table-wrap\{display:none\}/);
  assert.match(styles, /\.audit-cards\{display:grid/);
});

test('primary audit identity is actor presentation, while UUIDs remain in technical details', () => {
  assert.match(component, /<Actor actor=\{log\.actor\}/);
  assert.match(component, /shortTechnicalId\(target\.id\)/);
  assert.match(component, /auditTechnicalDetails/);
  assert.match(component, /auditRecordId/);
  assert.doesNotMatch(component, /<td>\{log\.userId/);
});
