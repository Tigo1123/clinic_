import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import MfaCodeInput from '../src/components/MfaCodeInput.js';

let dom;
let root;
let container;

beforeEach(async () => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.getElementById('root');
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.HTMLElement;
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

function Harness({ ids = ['mfa-code'] }) {
  const [values, setValues] = useState(() => Object.fromEntries(ids.map((id) => [id, ''])));

  return ids.map((id) => React.createElement(MfaCodeInput, {
    key: id,
    id,
    'aria-label': id,
    value: values[id],
    onValueChange: (value) => setValues((current) => ({ ...current, [id]: value })),
  }));
}

async function renderHarness(ids) {
  await act(async () => root.render(React.createElement(Harness, { ids })));
}

function setNativeValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
}

async function dispatchInput(input, value, inputType = 'insertText', isComposing = false) {
  await act(async () => {
    setNativeValue(input, value);
    input.dispatchEvent(new window.InputEvent('input', {
      bubbles: true,
      data: value,
      inputType,
      isComposing,
    }));
  });
}

test('six digits typed sequentially remain six digits', async () => {
  await renderHarness();
  const input = document.getElementById('mfa-code');

  for (const value of ['4', '42', '424', '4247', '42473', '424735']) {
    await dispatchInput(input, value);
  }

  assert.equal(input.value, '424735');
  assert.equal(input.type, 'text');
  assert.equal(input.inputMode, 'numeric');
  assert.equal(input.autocomplete, 'one-time-code');
  assert.equal(input.hasAttribute('maxlength'), false);
  assert.equal(input.hasAttribute('pattern'), false);
});

test('paste, separators, and excess characters normalize after the full value arrives', async () => {
  await renderHarness();
  const input = document.getElementById('mfa-code');

  await dispatchInput(input, '424735', 'insertFromPaste');
  assert.equal(input.value, '424735');

  await dispatchInput(input, '424 735', 'insertFromPaste');
  assert.equal(input.value, '424735');

  await dispatchInput(input, '424-735', 'insertFromPaste');
  assert.equal(input.value, '424735');

  await dispatchInput(input, 'a4b2c4d7e3f5g9', 'insertFromPaste');
  assert.equal(input.value, '424735');
});

test('Android-style composition does not let partial controlled state overwrite the final code', async () => {
  await renderHarness();
  const input = document.getElementById('mfa-code');

  await act(async () => {
    input.dispatchEvent(new window.CompositionEvent('compositionstart', { bubbles: true }));
  });
  await dispatchInput(input, '4247', 'insertCompositionText', true);
  assert.equal(input.value, '4247');

  await act(async () => {
    setNativeValue(input, '424735');
    input.dispatchEvent(new window.CompositionEvent('compositionend', {
      bubbles: true,
      data: '424735',
    }));
  });

  assert.equal(input.value, '424735');

  await dispatchInput(input, '123 456', 'insertReplacementText');
  assert.equal(input.value, '123456');
});

test('login and enrollment fields use identical native-event normalization', async () => {
  await renderHarness(['staff-mfa-code', 'mfa-enrollment-code']);
  const loginInput = document.getElementById('staff-mfa-code');
  const enrollmentInput = document.getElementById('mfa-enrollment-code');

  await dispatchInput(loginInput, '424-735', 'insertFromPaste');
  await dispatchInput(enrollmentInput, '424-735', 'insertReplacementText');

  assert.equal(loginInput.value, '424735');
  assert.equal(enrollmentInput.value, '424735');
});
