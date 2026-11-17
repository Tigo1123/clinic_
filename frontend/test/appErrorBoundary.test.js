import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/components/feedback/AppErrorBoundary.jsx', import.meta.url), 'utf8');

test('error boundary follows the saved language and sets direction', () => {
  assert.match(source, /import i18n from '\.\.\/\.\.\/i18n\.js'/);
  assert.match(source, /i18n\?\.language/);
  assert.match(source, /dir=\{isAr \? 'rtl' : 'ltr'\}/);
});

test('error boundary text exists in Arabic and English', () => {
  for (const text of ['تعذر عرض هذه الصفحة', 'We couldn’t display this page', 'إعادة تحميل التطبيق', 'Reload application', 'حاول مرة أخرى', 'Try again']) {
    assert.ok(source.includes(text), `missing: ${text}`);
  }
});

test('error boundary can recover without a full reload', () => {
  assert.match(source, /window\.location\.reload\(\)/);
  assert.match(source, /this\.setState\(\{ failed: false \}\)/);
});
