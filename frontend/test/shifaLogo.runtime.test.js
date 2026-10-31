import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { transformWithOxc } from 'vite';
import { JSDOM } from 'jsdom';
import { act, createElement as h, useState } from 'react';
import { createRoot } from 'react-dom/client';

const source = await readFile(new URL('../src/components/brand/ShifaLogo.jsx', import.meta.url), 'utf8');
const assetsPath = JSON.stringify(new URL('../src/components/brand/shifaLogoAssets.js', import.meta.url).href);
const compiled = source
  .replace("import { useTranslation } from 'react-i18next';", 'const useTranslation = () => ({ i18n: { resolvedLanguage: globalThis.logoLanguage } });')
  .replace("import { useTheme } from '../../app/theme/ThemeContext.jsx';", 'const useTheme = () => ({ theme: globalThis.logoTheme });')
  .replace("import { shifaLogoAlternative, shifaLogoAsset } from './shifaLogoAssets.js';", `import { shifaLogoAlternative, shifaLogoAsset } from ${assetsPath};`)
  .replace("import './shifaLogo.css';", '');
const tempFile = new URL(`.shifa-logo-runtime-${process.pid}.mjs`, import.meta.url);
await writeFile(tempFile, (await transformWithOxc(compiled, 'ShifaLogo.jsx', { jsx: { runtime: 'automatic' } })).code);
const ShifaLogo = (await import(tempFile.href)).default;
await unlink(tempFile);

test('shared component switches language/theme immediately and renders decorative compact alt', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true, logoLanguage: 'en', logoTheme: 'light' });
  function Harness() {
    const [, rerender] = useState(0);
    return h('main', null,
      h(ShifaLogo), h(ShifaLogo, { compact: true }), h(ShifaLogo, { responsive: true }),
      h('button', { id: 'switch', onClick: () => { globalThis.logoLanguage = 'ar'; globalThis.logoTheme = 'dark'; rerender(value => value + 1); } }, 'switch'));
  }
  const root = createRoot(document.querySelector('#root'));
  try {
    await act(async () => root.render(h(Harness)));
    const full = document.querySelector('img:not(.shifa-logo--compact)');
    const compact = document.querySelector('.shifa-logo--compact');
    assert.equal(full.getAttribute('src'), '/brand/shifa-logo-en-light.png');
    assert.equal(full.getAttribute('alt'), 'Shifa Clinic Management System');
    assert.equal(compact.getAttribute('src'), '/brand/shifa-mark-light.png');
    assert.equal(compact.getAttribute('alt'), '');
    const responsive = document.querySelector('.shifa-logo-responsive');
    assert.equal(responsive.getAttribute('role'), 'img');
    assert.equal(responsive.getAttribute('aria-label'), 'Shifa Clinic Management System');
    await act(async () => document.querySelector('#switch').click());
    assert.equal(full.getAttribute('src'), '/brand/shifa-logo-ar-dark.png');
    assert.equal(full.getAttribute('alt'), 'شفاء — نظام إدارة المنشآت الصحية');
    assert.equal(responsive.getAttribute('aria-label'), 'شفاء — نظام إدارة المنشآت الصحية');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    delete globalThis.logoLanguage;
    delete globalThis.logoTheme;
  }
});
