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

test('visit-history summary action remains enabled for a completed read-only visit', () => {
  const dashboard = source('src/features/doctor/DoctorDashboard.jsx');
  const historyStart = dashboard.indexOf('className="doctor-clinical-section doctor-history-panel"');
  const historyAction = dashboard.indexOf('setActiveSummaryId(targetId)', historyStart);
  const editableFieldset = dashboard.indexOf('className="doctor-consultation-form" disabled={isReadOnlyVisit}', historyStart);
  assert.ok(historyStart >= 0);
  assert.ok(historyAction > historyStart);
  assert.ok(editableFieldset > historyAction, 'read-only fieldset must not disable the history summary action');
  assert.match(dashboard, /const targetId = rec\.id \|\| rec\.recordId \|\| rec\.appointmentId/);
  const historyButton = dashboard.slice(dashboard.lastIndexOf('<button', historyAction), historyAction + 40);
  assert.match(historyButton, /type="button"/);
  assert.match(historyButton, /setActiveSummaryId\(targetId\)/);
  assert.match(dashboard, /activeSummaryId && <PostVisitSummaryModal summaryId=\{activeSummaryId\}/);
});

test('empty instructions do not gate summary content or modal actions', () => {
  const modal = source('src/features/clinical/ClinicalModals.jsx');
  assert.match(modal, /if \(!summary\)/);
  assert.doesNotMatch(modal, /if \(!summary\.instructions|if \(summary\.instructions\.length === 0\)/);
  assert.match(modal, /summary\.diagnosis/);
  assert.match(modal, /summary\.treatment/);
  assert.match(modal, /summary\.labOrders\.map/);
  assert.match(modal, /summary\.prescriptions\.map/);
  assert.match(modal, /onClick=\{onClose\}/);
  assert.match(modal, /onClick=\{\(\) => window\.print\(\)\}/);
  assert.match(modal, /handleEmailSummary/);
  assert.match(modal, /getWhatsAppLink/);
  assert.match(modal, /تعذر تحميل ملخص الزيارة\. حاول مرة أخرى\./);
  assert.match(modal, /Unable to load the visit summary\. Please try again\./);
});

test('patient-file visit summary uses a named nested portal layer and preserves its parent modal', () => {
  const modal = source('src/features/clinical/ClinicalModals.jsx');
  const dashboard = source('src/features/doctor/DoctorDashboard.jsx');
  const styles = source('src/features/clinical/patientFile.css');
  assert.match(modal, /createPortal\(content, document\.body\)/);
  assert.match(modal, /modalLayer === 'nested' \? 'nested' : 'base'/);
  assert.match(styles, /modal-layer--base[^}]*1000/);
  assert.match(styles, /modal-layer--patient-file[^}]*1050/);
  assert.match(styles, /modal-layer--nested[^}]*1100/);
  assert.match(dashboard, /nestedModalOpen=\{Boolean\(activeSummaryId\)\}/);
  assert.match(dashboard, /modalLayer=\{viewingProfilePatientId \? 'nested' : 'base'\}/);
  assert.match(modal, /inert=\{nestedModalOpen \? '' : undefined\}/);
});

test('top summary modal owns escape, backdrop, and focus before returning focus to its launcher', () => {
  const modal = source('src/features/clinical/ClinicalModals.jsx');
  const dashboard = source('src/features/doctor/DoctorDashboard.jsx');
  assert.match(modal, /document\.addEventListener\('keydown', handleKeyDown, true\)/);
  assert.match(modal, /event\.stopImmediatePropagation\(\)/);
  assert.match(modal, /if \(nestedModalOpenRef\.current\) return/);
  assert.match(modal, /event\.target === event\.currentTarget\) onClose\(\)/);
  assert.match(modal, /previousFocus\?\.focus\?\.\(\)/);
  assert.match(modal, /returnFocusTo \|\| document\.activeElement/);
  assert.match(dashboard, /summaryReturnFocusRef\.current = trigger/);
  assert.match(dashboard, /returnFocusTo=\{summaryReturnFocusRef\.current\}/);
});
