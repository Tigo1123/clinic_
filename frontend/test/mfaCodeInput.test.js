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
let componentRefs;
let observedValues;
let forceParentRender;

beforeEach(() => {
  componentRefs = new Map();
  observedValues = new Map();
  document.getElementById('root').replaceChildren();
  root = createRoot(document.getElementById('root'));
});

afterEach(async () => {
  await act(async () => root.unmount());
});

function Harness({ ids = ['mfa-code'], strict = false }) {
  const [, setRenderCount] = useState(0);
  forceParentRender = () => setRenderCount((count) => count + 1);
  const fields = ids.map((id) => createElement(MfaField, { id, key: id }));
  return strict ? createElement(StrictMode, null, fields) : fields;
}

function MfaField({ id }) {
  const inputRef = useRef(null);
  componentRefs.set(id, inputRef);
  return createElement(MfaCodeInput, {
    ref: inputRef,
    id,
    'aria-label': id,
    onValueChange: (value) => observedValues.set(id, value),
  });
}

async function renderHarness(ids, strict = false) {
  await act(async () => root.render(createElement(Harness, { ids, strict })));
}

function setNativeValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
}

function fireInput(input, value, inputType = 'insertText', isComposing = false) {
  setNativeValue(input, value);
  input.dispatchEvent(new window.InputEvent('input', {
    bubbles: true,
    data: null,
    inputType,
    isComposing,
  }));
}

function fireCompositionStart(input) {
  input.dispatchEvent(new window.CompositionEvent('compositionstart', { bubbles: true }));
}

function fireCompositionEnd(input, value) {
  setNativeValue(input, value);
  input.dispatchEvent(new window.CompositionEvent('compositionend', { bubbles: true }));
}

function firePaste(input, clipboardText) {
  const event = new window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type) => type === 'text' ? clipboardText : '' },
  });
  input.dispatchEvent(event);
  return event;
}

function assertFinal(id, expected) {
  const input = document.getElementById(id);
  assert.equal(input.value, expected, 'DOM input value');
  assert.equal(observedValues.get(id), expected, 'parent-observed value');
  assert.equal(componentRefs.get(id).current.getValue(), expected, 'submitted ref value');
}

test('A: partial composition values commit only the final six digits', async () => {
  await renderHarness();
  const input = document.getElementById('mfa-code');
  await act(async () => {
    fireCompositionStart(input);
    fireInput(input, '1111', 'insertCompositionText', true);
    fireInput(input, '11111', 'insertCompositionText', true);
    fireCompositionEnd(input, '111111');
  });
  assertFinal('mfa-code', '111111');
});

test('B and C: trailing full input and direct replacement retain six digits', async () => {
  await renderHarness();
  const input = document.getElementById('mfa-code');
  await act(async () => {
    fireCompositionStart(input);
    fireInput(input, '11111', 'insertCompositionText', true);
    fireCompositionEnd(input, '111111');
    fireInput(input, '111111');
  });
  assertFinal('mfa-code', '111111');
  await act(async () => fireInput(input, '222222', 'insertReplacementText'));
  assertFinal('mfa-code', '222222');
});

test('D: a stale partial event after composition end cannot truncate the committed code', async () => {
  await renderHarness();
  const input = document.getElementById('mfa-code');
  await act(async () => {
    fireCompositionStart(input);
    fireInput(input, '11111', 'insertCompositionText', true);
    fireCompositionEnd(input, '111111');
    fireInput(input, '11111', 'insertText');
  });
  assertFinal('mfa-code', '111111');
});

test('E and F: selection replacement and rapid individual input preserve the final value', async () => {
  await renderHarness();
  const input = document.getElementById('mfa-code');
  await act(async () => {
    setNativeValue(input, '00');
    input.setSelectionRange(0, 2);
    fireInput(input, '111111', 'insertReplacementText');
  });
  assertFinal('mfa-code', '111111');
  await act(async () => {
    for (let length = 1; length <= 6; length += 1) fireInput(input, '2'.repeat(length));
  });
  assertFinal('mfa-code', '222222');
});

test('G, H, and I: explicit paste normalizes plain, spaced, and hyphenated codes', async () => {
  await renderHarness();
  const input = document.getElementById('mfa-code');
  for (const clipboardText of ['424735', '424 735', '424-735']) {
    let event;
    await act(async () => { event = firePaste(input, clipboardText); });
    assert.equal(event.defaultPrevented, true);
    assertFinal('mfa-code', '424735');
  }
});

test('J: intentional browser deletion remains allowed after a completed code', async () => {
  await renderHarness();
  const input = document.getElementById('mfa-code');
  await act(async () => fireInput(input, '111111'));
  await act(async () => fireInput(input, '11111', 'deleteContentBackward'));
  assertFinal('mfa-code', '11111');
});

test('intentional deletion immediately after composition end is allowed', async () => {
  await renderHarness();
  const input = document.getElementById('mfa-code');
  await act(async () => {
    fireCompositionStart(input);
    fireCompositionEnd(input, '111111');
    fireInput(input, '11111', 'deleteContentBackward');
  });
  assertFinal('mfa-code', '11111');
});

test('K: a parent rerender during composition cannot overwrite the live DOM value', async () => {
  await renderHarness();
  const input = document.getElementById('mfa-code');
  await act(async () => {
    fireCompositionStart(input);
    fireInput(input, '11111', 'insertCompositionText', true);
    forceParentRender();
  });
  assert.equal(input.value.length, 5);
  await act(async () => fireCompositionEnd(input, '111111'));
  assertFinal('mfa-code', '111111');
});

test('L: StrictMode remount behavior retains a functional ref-backed input', async () => {
  await renderHarness(['mfa-code'], true);
  const input = document.getElementById('mfa-code');
  await act(async () => fireInput(input, '111111'));
  assertFinal('mfa-code', '111111');
  await act(async () => componentRefs.get('mfa-code').current.clear());
  assertFinal('mfa-code', '');
});

test('M: login, enrollment, and management fields share identical behavior', async () => {
  const ids = ['staff-mfa-code', 'mfa-enrollment-code', 'mfa-proof'];
  await renderHarness(ids);
  await act(async () => {
    for (const id of ids) firePaste(document.getElementById(id), '424-735');
  });
  for (const id of ids) assertFinal(id, '424735');
});

test('input attributes do not truncate before normalization', async () => {
  await renderHarness();
  const input = document.getElementById('mfa-code');
  assert.equal(input.type, 'text');
  assert.equal(input.inputMode, 'numeric');
  assert.equal(input.autocomplete, 'one-time-code');
  assert.equal(input.hasAttribute('value'), false);
  assert.equal(input.hasAttribute('maxlength'), false);
  assert.equal(input.hasAttribute('pattern'), false);
});
