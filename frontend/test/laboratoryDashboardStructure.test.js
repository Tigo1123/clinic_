import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (relative) => readFileSync(path.join(root, relative), 'utf8');

test('laboratory separates the active work queue from bounded released history', () => {
  const dashboard = source('src/features/laboratory/LaboratoryDashboard.jsx');
  const records = source('../backend/src/routes/records.js');
  assert.match(dashboard, /orderView === 'work' \? orders : historyOrders/);
  assert.match(dashboard, /\/api\/records\/lab-orders\/pending/);
  assert.match(dashboard, /\/api\/records\/lab-orders\/history/);
  assert.match(records, /router\.get\('\/lab-orders\/history'[\s\S]*releasedToPatientAt: \{ not: null \}/);
  assert.match(records, /take: 100/);
  assert.match(records, /orderBy: \[\{ releasedToPatientAt: 'desc' \}/);
});

test('work queue and history tabs are accessible, counted, and default to work', () => {
  const dashboard = source('src/features/laboratory/LaboratoryDashboard.jsx');
  assert.match(dashboard, /useState\('work'\)/);
  assert.match(dashboard, /role="tablist"/);
  assert.match(dashboard, /role="tab" aria-selected=\{orderView === 'work'\}/);
  assert.match(dashboard, /role="tab" aria-selected=\{orderView === 'history'\}/);
  assert.match(dashboard, /قائمة العمل/);
  assert.match(dashboard, /Work Queue/);
  assert.match(dashboard, /السجل المختبري/);
  assert.match(dashboard, /Lab History/);
});

test('existing laboratory state transitions and actions remain status guarded', () => {
  const dashboard = source('src/features/laboratory/LaboratoryDashboard.jsx');
  assert.match(dashboard, /selectedOrder\.status !== 'PAID'/);
  assert.match(dashboard, /onClick=\{handleCollectSample\}/);
  assert.match(dashboard, /selectedOrder\.status !== 'SAMPLE_COLLECTED'/);
  assert.match(dashboard, /onClick=\{\(\) => handleSubmitResult\(item\)\}/);
  assert.match(dashboard, /selectedOrder\.status !== 'COMPLETED'/);
  assert.match(dashboard, /onClick=\{handleReleaseResults\}/);
  assert.match(dashboard, /Payment[\s\S]*Sample collection[\s\S]*Result entry[\s\S]*Completion[\s\S]*Release/);
});

test('released clinical history is read only and has no hard delete control', () => {
  const dashboard = source('src/features/laboratory/LaboratoryDashboard.jsx');
  const records = source('../backend/src/routes/records.js');
  assert.match(dashboard, /selectedOrder\.status === 'COMPLETED' && !selectedOrder\.releasedToPatientAt/);
  assert.match(dashboard, /هذا الطلب محفوظ في السجل المختبري للقراءة والتدقيق/);
  assert.doesNotMatch(dashboard, /handleDelete|deleteLabOrder|حذف الطلب/);
  assert.doesNotMatch(records, /router\.delete\('\/lab-orders/);
});

test('custom test review is correctly named and remains a functional separate workflow', () => {
  const dashboard = source('src/features/laboratory/LaboratoryDashboard.jsx');
  const records = source('../backend/src/routes/records.js');
  assert.match(dashboard, /مراجعة الفحوصات المخصصة/);
  assert.match(dashboard, /Custom Test Review/);
  assert.doesNotMatch(dashboard, /طلبات فحوصات مختبرية جديدة|New Lab Test Requests/);
  assert.match(dashboard, /reviewRequests\.map\(\(request\)/);
  assert.match(dashboard, /request\.customTestName/);
  assert.match(dashboard, /handleReview\(request, 'LINK_EXISTING'\)/);
  assert.match(dashboard, /handleReview\(request, 'CREATE_SERVICE'\)/);
  assert.match(dashboard, /handleReview\(request, 'EXTERNAL'\)/);
  assert.match(records, /labReviewStatus: 'PENDING_REVIEW', serviceId: null/);
});

test('empty custom review state is compact and ordinary orders stay in their own panel', () => {
  const dashboard = source('src/features/laboratory/LaboratoryDashboard.jsx');
  const css = source('src/features/laboratory/laboratoryDashboard.css');
  assert.match(dashboard, /laboratory-review-section \$\{reviewRequests\.length === 0 \? 'is-empty'/);
  assert.match(dashboard, /لا توجد فحوصات مخصصة بانتظار المراجعة/);
  assert.match(css, /laboratory-review-section\.is-empty \{ padding-block: \.75rem/);
  assert.match(dashboard, /<aside className="laboratory-orders-panel"/);
  assert.match(dashboard, /<section className=\{`laboratory-review-section/);
});

test('laboratory layout preserves RTL, responsive stacking, and MRN isolation', () => {
  const dashboard = source('src/features/laboratory/LaboratoryDashboard.jsx');
  const css = source('src/features/laboratory/laboratoryDashboard.css');
  assert.match(dashboard, /dir=\{lang === 'ar' \? 'rtl' : 'ltr'\}/);
  assert.match(dashboard, /<bdi dir="ltr">\{ord\.patient\.fileNumber/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*grid-template-columns: 1fr/);
  assert.match(css, /overflow-x: clip/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});
