import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import('react');
const { act, createElement, StrictMode, useRef, useState } = React;
const { createRoot } = await import('react-dom/client');
const { default: MfaCodeInput } = await import('../src/components/MfaCodeInput.js');

let root;
let inputRefs;
let submissions;
let forceParentRender;

beforeEach(() => {
  inputRefs = new Map();
  submissions = [];
  document.getElementById('root').replaceChildren();
  root = createRoot(document.getElementById('root'));
});

afterEach(async () => {
  await act(async () => root.unmount());
});

function FieldForm({ id }) {
  const inputRef = useRef(null);
  const [error, setError] = useState('');
  inputRefs.set(id, inputRef);

  const submit = (event) => {
    event.preventDefault();
    const code = inputRef.current?.getValue() || '';
    if (code.length !== 6) {
      setError('Enter the complete 6-digit authenticator code.');
      inputRef.current?.focus();
      return;
    }
    setError('');
    submissions.push({ id, code });
  };

  return createElement('form', { id: `${id}-form`, onSubmit: submit },
    createElement(MfaCodeInput, { ref: inputRef, id, 'aria-label': id, required: true }),
    createElement('button', { type: 'submit' }, 'Verify'),
    error && createElement('div', { role: 'alert' }, error));
}

function Harness({ ids = ['mfa-code'], strict = false }) {
  const [, setRenderCount] = useState(0);
  forceParentRender = () => setRenderCount((count) => count + 1);
  const forms = ids.map((id) => createElement(FieldForm, { id, key: id }));
  return strict ? createElement(StrictMode, null, forms) : forms;
}

async function renderHarness(ids, strict = false) {
  await act(async () => root.render(createElement(Harness, { ids, strict })));
}

function setNativeValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
}

function fireNativeInput(input, value, inputType = 'insertText', isComposing = false) {
  setNativeValue(input, value);
  input.dispatchEvent(new window.InputEvent('input', { bubbles: true, inputType, isComposing }));
}

async function submit(id = 'mfa-code') {
  await act(async () => {
    document.getElementById(`${id}-form`).dispatchEvent(new window.Event('submit', {
      bubbles: true,
      cancelable: true,
    }));
  });
}

test('submission reads and normalizes the current native DOM value', async () => {
  await renderHarness();
  const input = document.getElementById('mfa-code');

  for (const [raw, expected] of [
    ['123456', '123456'],
    ['123 456', '123456'],
    ['123-456', '123456'],
    ['1234567', '123456'],
  ]) {
    setNativeValue(input, raw);
    await submit();
    assert.equal(submissions.at(-1).code, expected);
    assert.equal(input.value, raw, 'submission must not rewrite the live input');
  }
});

test('three- and five-digit values fail locally without a service call', async () => {
  await renderHarness();
  const input = document.getElementById('mfa-code');

  for (const raw of ['123', '12345']) {
    submissions.length = 0;
    setNativeValue(input, raw);
    await submit();
    assert.equal(submissions.length, 0);
    assert.equal(document.querySelector('[role="alert"]').textContent, 'Enter the complete 6-digit authenticator code.');
    assert.equal(document.activeElement, input);
    assert.equal(input.value, raw);
  }
});

test('arbitrary Android-like intermediate input is never rewritten by the component', async () => {
  await renderHarness();
  const input = document.getElementById('mfa-code');

  for (const raw of ['1', '12', '123', '1234', '12345', '123456']) {
    await act(async () => fireNativeInput(input, raw));
    assert.equal(input.value, raw);
  }
});

test('parent rerenders do not alter partial or complete native values', async () => {
  await renderHarness();
  const input = document.getElementById('mfa-code');

  for (const raw of ['123', '123456']) {
    setNativeValue(input, raw);
    await act(async () => forceParentRender());
    assert.equal(input.value, raw);
  }
});

test('composition events are browser-owned and do not alter the DOM value', async () => {
  await renderHarness();
  const input = document.getElementById('mfa-code');

  await act(async () => {
    input.dispatchEvent(new window.CompositionEvent('compositionstart', { bubbles: true }));
    fireNativeInput(input, '123', 'insertCompositionText', true);
    fireNativeInput(input, '12345', 'insertCompositionText', true);
    setNativeValue(input, '123456');
    input.dispatchEvent(new window.CompositionEvent('compositionend', { bubbles: true }));
  });

  assert.equal(input.value, '123456');
  assert.equal(inputRefs.get('mfa-code').current.getValue(), '123456');
});

test('native paste is not prevented or rewritten', async () => {
  await renderHarness();
  const input = document.getElementById('mfa-code');
  const paste = new window.Event('paste', { bubbles: true, cancelable: true });

  await act(async () => input.dispatchEvent(paste));
  assert.equal(paste.defaultPrevented, false);

  setNativeValue(input, '123 456');
  await submit();
  assert.equal(submissions.at(-1).code, '123456');
  assert.equal(input.value, '123 456');
});

test('login, enrollment, and management inputs submit identically', async () => {
  const ids = ['staff-mfa-code', 'mfa-enrollment-code', 'mfa-proof'];
  await renderHarness(ids);

  for (const id of ids) {
    setNativeValue(document.getElementById(id), '123-456');
    await submit(id);
  }

  assert.deepEqual(submissions, ids.map((id) => ({ id, code: '123456' })));
});

test('StrictMode remount behavior leaves a stable native input', async () => {
  await renderHarness(['mfa-code'], true);
  const input = document.getElementById('mfa-code');
  setNativeValue(input, '123456');
  await act(async () => forceParentRender());
  assert.equal(document.getElementById('mfa-code'), input);
  assert.equal(input.value, '123456');
});

test('the native input has no browser or React truncation attributes', async () => {
  await renderHarness();
  const input = document.getElementById('mfa-code');

  assert.equal(document.querySelectorAll('#mfa-code').length, 1);
  assert.equal(input.type, 'text');
  assert.equal(input.inputMode, 'numeric');
  assert.equal(input.autocomplete, 'one-time-code');
  assert.equal(input.hasAttribute('value'), false);
  assert.equal(input.hasAttribute('maxlength'), false);
  assert.equal(input.hasAttribute('pattern'), false);
});
