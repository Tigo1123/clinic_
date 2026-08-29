import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (relative) => readFileSync(path.join(root, relative), 'utf8');

test('visit summary hides absent patient instructions and never supplies default clinical advice', () => {
  const modal = source('src/features/clinical/ClinicalModals.jsx');
  const recordsRoute = source('../backend/src/routes/records.js');
  assert.match(modal, /Array\.isArray\(summary\.instructions\) && summary\.instructions\.length > 0/);
  assert.match(recordsRoute, /instructions: \[\]/);
  for (const inventedAdvice of [
    'Take prescribed medications exactly as directed',
    'Drink plenty of water and maintain adequate rest',
    'Return immediately if symptoms worsen',
    'Follow up in 7 days',
    'Take all prescribed medications according to schedule',
    'Ensure adequate hydration and rest'
  ]) {
    assert.equal(modal.includes(inventedAdvice), false);
    assert.equal(recordsRoute.includes(inventedAdvice), false);
  }
});

test('screen, print, WhatsApp, and email retain stored medication instructions only', () => {
  const modal = source('src/features/clinical/ClinicalModals.jsx');
  const recordsRoute = source('../backend/src/routes/records.js');
  assert.match(modal, /rx\.instructionsAr \|\| rx\.instructionsEn/);
  assert.match(modal, /rx\.instructionsEn \|\| rx\.instructionsAr/);
  assert.match(modal, /p\.instructionsAr \|\| p\.instructionsEn/);
  assert.match(modal, /p\.instructionsEn \|\| p\.instructionsAr/);
  assert.match(recordsRoute, /pd\.instructionsEn \|\| pd\.instructionsAr/);
  assert.doesNotMatch(recordsRoute, /\|\| 'As instructed'/);
  assert.match(modal, /summary\.diagnosis/);
  assert.match(modal, /summary\.treatment/);
  assert.match(modal, /summary\.labOrders/);
});

test('prescription rows are rendered once per API item without client-side duplication', () => {
  const modal = source('src/features/clinical/ClinicalModals.jsx');
  const recordsRoute = source('../backend/src/routes/records.js');
  assert.match(modal, /summary\.prescriptions\.map\(\(rx, idx\) =>/);
  assert.match(recordsRoute, /record\.prescriptions \|\| \[\]\)\.flatMap\(p => \(p\.prescribedDrugs \|\| \[\]\)\.map/);
  assert.doesNotMatch(modal, /new Set\(|dedup|uniqueBy/);
});
