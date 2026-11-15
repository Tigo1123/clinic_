import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.document = dom.window.document;
const { lockPageScroll } = await import('../src/utils/scrollLock.js');
const root = () => document.documentElement.style.overflow;

test('lock sets overflow hidden on the root element', () => {
  document.documentElement.style.overflow = 'scroll';
  const unlock = lockPageScroll();
  assert.equal(root(), 'hidden');
  unlock();
  assert.equal(root(), 'scroll');
  document.documentElement.style.overflow = '';
});

test('nested lock plus one unlock keeps hidden; last unlock restores original', () => {
  document.documentElement.style.overflow = 'auto';
  const a = lockPageScroll();
  const b = lockPageScroll();
  b();
  assert.equal(root(), 'hidden');
  a();
  assert.equal(root(), 'auto');
  document.documentElement.style.overflow = '';
});

test('double unlock does not double-decrement', () => {
  const a = lockPageScroll();
  const b = lockPageScroll();
  a();
  a();
  assert.equal(root(), 'hidden');
  b();
  assert.equal(root(), '');
});
