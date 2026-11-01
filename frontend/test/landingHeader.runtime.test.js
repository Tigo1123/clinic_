import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { transformWithOxc } from 'vite';
import { JSDOM } from 'jsdom';
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { landingCopy } from '../src/features/public/landingCopy.js';

const source = await readFile(new URL('../src/features/public/components/LandingHeader.jsx', import.meta.url), 'utf8');
const compiled = source
  .replace("import { Link } from 'react-router-dom';", 'const Link = ({ to, ...props }) => <a href={to} {...props} />;')
  .replace(/import ThemeToggle from [^;]+;/, 'const ThemeToggle = ({ className }) => <button className={className}>Theme</button>;')
  .replace(/import ShifaLogo from [^;]+;/, 'const ShifaLogo = ({ className }) => <img className={className} alt="Shifa" />;')
  .replace(/import PwaInstallButton from [^;]+;/, 'const PwaInstallButton = () => <button>Install</button>;');
const file = new URL(`.landing-header-${process.pid}.mjs`, import.meta.url);
await writeFile(file, (await transformWithOxc(compiled, 'LandingHeader.jsx', { jsx: { runtime: 'automatic' } })).code);
const LandingHeader = (await import(file.href)).default;
await unlink(file);

test('mobile navigation isolates background, traps focus, restores focus, and cleans up on desktop', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: callback => callback() });
  const media = new dom.window.EventTarget(); media.matches = false;
  dom.window.matchMedia = () => media;
  const root = createRoot(document.querySelector('#root'));
  const click = async element => act(async () => element.click());
  const key = async (key, shiftKey = false) => act(async () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })));
  let languageChanges = 0;
  try {
    await act(async () => root.render(h('div', { className: 'public-site' },
      h('a', { className: 'public-skip-link', href: '#main-content' }, 'Skip'),
      h(LandingHeader, { copy: landingCopy.en, brand: 'Shifa', language: 'en', onLanguageChange: () => languageChanges++ }),
      h('main', { id: 'main-content' }, h('section', { id: 'features', tabIndex: -1 }, 'Features')),
      h('footer', null, 'Footer'))));
    assert.equal(document.querySelector('.public-brand').getAttribute('href'), '#home');
    document.body.style.overflow = 'auto';
    const toggle = document.querySelector('.public-menu-toggle');
    const menu = document.querySelector('.public-mobile-menu');
    const close = menu.querySelector('button');
    const first = menu.querySelector('a,button');
    const last = [...menu.querySelectorAll('a,button')].at(-1);
    await click(toggle);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(menu.hidden, false);
    assert.equal(document.querySelector('main').inert, true);
    assert.equal(document.querySelector('footer').inert, true);
    assert.equal(document.querySelector('.public-header__inner').inert, true);
    assert.equal(document.body.style.overflow, 'hidden');
    first.focus(); await key('Tab', true); assert.equal(document.activeElement, last);
    last.focus(); await key('Tab'); assert.equal(document.activeElement, first);
    await click(close);
    assert.equal(menu.hidden, true);
    assert.equal(document.activeElement, toggle);
    assert.equal(document.body.style.overflow, 'auto');
    assert.ok(!document.querySelector('main').inert);
    await click(toggle); await key('Escape');
    assert.equal(menu.hidden, true); assert.equal(document.activeElement, toggle);
    await click(toggle); await click(menu.querySelector('a[href="#features"]'));
    assert.equal(document.activeElement.id, 'features'); assert.equal(menu.hidden, true);
    await click(toggle); await click(menu.querySelector('.public-mobile-menu__language'));
    assert.equal(languageChanges, 1); assert.equal(menu.hidden, true);
    await click(toggle);
    await act(async () => { media.matches = true; media.dispatchEvent(new dom.window.Event('change')); });
    assert.equal(menu.hidden, true); assert.equal(document.body.style.overflow, 'auto');
    assert.ok(!document.querySelector('.public-header__inner').inert);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    delete globalThis.requestAnimationFrame;
  }
});
