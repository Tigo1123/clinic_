import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const component = fs.readFileSync(new URL('../src/features/admin/AnalyticsPanel.jsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/features/admin/analytics.css', import.meta.url), 'utf8');
const translations = fs.readFileSync(new URL('../src/i18n.js', import.meta.url), 'utf8');

test('analytics panel has explicit loading, error, empty, textual chart, and refresh contracts', () => {
  for (const contract of ['analyticsLoading', 'analyticsLoadError', 'analyticsNoData', 'analyticsNoPeriodData', 'analytics-chart-summary', 'onRefresh']) {
    assert.match(component, new RegExp(contract));
  }
  assert.doesNotMatch(component, /changePercent|previousPeriod|sparkline|Export/);
});

test('analytics layout is RTL-aware and responsive without changing sidebar behavior', () => {
  assert.match(component, /dir=\{lang === 'ar' \? 'rtl' : 'ltr'\}/);
  assert.match(styles, /grid-template-columns:repeat\(4/);
  assert.match(styles, /@media\(max-width:1100px\)/);
  assert.match(styles, /@media\(max-width:560px\)/);
  assert.doesNotMatch(styles, /sidebar/);
});

test('Arabic and English analytics translations are maintained', () => {
  assert.match(translations, /analyticsTitle:'لوحة تحليلات وإحصائيات العيادة'/);
  assert.match(translations, /analyticsTitle:'Clinic Reports & Analytics'/);
  assert.match(translations, /analyticsStatusWAITING_LAB:'بانتظار المختبر'/);
  assert.match(translations, /analyticsStatusWAITING_LAB:'Waiting for lab'/);
});
