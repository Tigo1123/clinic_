import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';

// No external resources are enabled: GIS is deliberately simulated.
const dom = new JSDOM('<div id="root"></div>');
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 318 });
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
let source = await readFile(new URL('../src/features/patient-auth/GoogleIdentityButton.jsx', import.meta.url), 'utf8');
source = source.replace("import { useTranslation } from 'react-i18next';", "const useTranslation = () => ({ t: key => key, i18n: { language: globalThis.testLanguage || 'en' } });")
  .replace("import { useTheme } from '../../app/theme/ThemeContext';", "const useTheme = () => ({ theme: globalThis.testTheme || 'light' });")
  .replace('import.meta.env?.VITE_GOOGLE_CLIENT_ID', 'globalThis.testGoogleClientId');
const compiled = await transformWithOxc(source, 'GoogleIdentityButton.jsx', { jsx: { runtime: 'automatic' } });
let root;
let moduleNumber = 0;
async function component() {
  const file = new URL(`.google-button-${process.pid}-${moduleNumber++}.mjs`, import.meta.url);
  await writeFile(file, compiled.code);
  try { return (await import(file.href)).GoogleIdentityButton; } finally { await unlink(file); }
}
async function mount(Button, callback = () => {}) {
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(createElement(Button, { onCredential: callback })));
}
async function unmount() {
  if (root) await act(async () => root.unmount());
  root = undefined;
}
afterEach(async () => {
  await unmount();
  document.head.replaceChildren();
  delete window.google;
  delete globalThis.testGoogleClientId;
  delete globalThis.testTheme;
  delete globalThis.testLanguage;
});
test('language switches reload the locale-specific SDK and replace the previous button', async () => {
  globalThis.testGoogleClientId = 'public-example.apps.googleusercontent.com';
  const Button = await component();
  const rendered = [];
  let initializations = 0;
  await mount(Button);
  window.google = { accounts: { id: { initialize() { initializations++; }, renderButton(container, options) { rendered.push(options.locale); container.appendChild(document.createElement('button')); } } } };
  await act(async () => document.querySelector('script').dispatchEvent(new window.Event('load')));
  globalThis.testLanguage = 'ar';
  await act(async () => root.render(createElement(Button, { onCredential() {} })));
  const script = document.querySelector('script');
  assert.equal(script.src, 'https://accounts.google.com/gsi/client?hl=ar');
  assert.equal(document.querySelector('[aria-busy]').getAttribute('aria-busy'), 'true');
  await act(async () => script.dispatchEvent(new window.Event('load')));
  assert.deepEqual(rendered, ['en', 'ar']);
  assert.equal(initializations, 1, 'locale refresh preserves the initialized credential dispatcher');
  assert.equal(document.querySelectorAll('script').length, 1);
  assert.equal(document.querySelector('[aria-busy]>div').children.length, 1);
});
test('blank configuration never inserts GIS and reports unavailable', async () => {
  for (const value of [undefined, '', '   ']) {
    globalThis.testGoogleClientId = value;
    await mount(await component());
    assert.equal(document.querySelector('script'), null);
    assert.equal(document.querySelector('[role="status"]').textContent, 'googleSignInUnavailable');
    await unmount();
  }
});
test('configured button loads GIS once, trims ID and forwards only a credential', async () => {
  globalThis.testGoogleClientId = '  public-example.apps.googleusercontent.com  ';
  globalThis.testTheme = 'light';
  const Button = await component();
  let settings; const renderOptions = []; const credentials = [];
  await mount(Button, credential => credentials.push(credential));
  const script = document.querySelector('script');
  assert.equal(script.src, 'https://accounts.google.com/gsi/client?hl=en');
  assert.equal(script.async, true);
  window.google = { accounts: { id: {
    initialize: options => { settings = options; },
    renderButton: (container, options) => { renderOptions.push(options); container.appendChild(document.createElement('button')); },
  } } };
  await act(async () => script.dispatchEvent(new window.Event('load')));
  assert.equal(settings.client_id, 'public-example.apps.googleusercontent.com');
  assert.equal(document.querySelector('[aria-busy]').getAttribute('aria-busy'), 'false');
  assert.equal(renderOptions[0].theme, 'outline');
  assert.equal(renderOptions[0].width, 318);
  assert.equal(renderOptions[0].locale, 'en');
  globalThis.testTheme = 'dark';
  await act(async () => root.render(createElement(Button, { onCredential: credential => credentials.push(credential) })));
  assert.equal(document.querySelector('[aria-busy]>div').children.length, 1, 'theme changes replace rather than duplicate the GIS button');
  assert.equal(renderOptions.at(-1).theme, 'outline_dark');
  settings.callback({ credential: 'simulated-token' });
  settings.callback({ credential: '' });
  assert.deepEqual(credentials, ['simulated-token']);
  await unmount();
  settings.callback({ credential: 'after-unmount' });
  assert.equal(credentials.length, 1);
  globalThis.testTheme = 'dark';
  await mount(Button);
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  assert.equal(document.querySelectorAll('script').length, 1);
  assert.equal(renderOptions.at(-1).theme, 'outline_dark');
  assert.equal(renderOptions.at(-1).width, 318);
});
for (const event of ['error', 'load']) {
  test(`GIS ${event} without initialization falls back and permits retry on remount`, async () => {
    globalThis.testGoogleClientId = 'public-example.apps.googleusercontent.com';
    const Button = await component();
    await mount(Button);
    const failed = document.querySelector('script');
    await act(async () => failed.dispatchEvent(new window.Event(event)));
    assert.equal(document.querySelector('[role="status"]').textContent, 'googleSignInUnavailable');
    assert.equal(document.querySelector('script'), null);
    await unmount();
    await mount(Button);
    const retry = document.querySelector('script');
    assert.ok(retry);
    assert.notEqual(retry, failed);
    window.google = { accounts: { id: { initialize() {}, renderButton() {} } } };
    await act(async () => retry.dispatchEvent(new window.Event('load')));
    assert.equal(document.querySelector('[aria-busy]').getAttribute('aria-busy'), 'false');
  });
}
