import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';

test('the actual bell recovers durable state, updates live, handles reads/errors, localizes and cleans up under StrictMode', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true });
  const { act, createElement, StrictMode } = await import('react'); const { createRoot } = await import('react-dom/client');
  globalThis.notificationTestSocket = new EventEmitter();
  let stored = []; let fail = false; let writes = 0;
  globalThis.notificationTestRequest = async (path, options = {}) => {
    if (fail) throw Error('Network failed');
    if (options.method === 'PATCH') { writes++; stored = stored.map(item => ({ ...item, isRead: true })); }
    return { notifications: stored, unreadCount: stored.filter(n => !n.isRead).length, nextCursor: null, asOf: new Date().toISOString() };
  };
  let source = await readFile(new URL('../src/components/NotificationDropdown.jsx', import.meta.url), 'utf8');
  source = source.replace(/import \{ staffApiRequest \}[^;]+;/, 'const staffApiRequest=(...args)=>globalThis.notificationTestRequest(...args);')
    .replace(/import \{ staffSocket \}[^;]+;/, 'const staffSocket=globalThis.notificationTestSocket;')
    .replace(/import \{ Bell, CheckCheck, X \}[^;]+;/, 'const Bell=()=>null,CheckCheck=Bell,X=Bell;')
    .replace("'../services/notificationFeed.js'", JSON.stringify(new URL('../src/services/notificationFeed.js', import.meta.url).href))
    .replace(/import '\.\/notificationDropdown\.css';/, '');
  const compiledPath = new URL(`.notification-component-${process.pid}.mjs`, import.meta.url);
  await writeFile(compiledPath, (await transformWithOxc(source, 'NotificationDropdown.jsx', { jsx: { runtime: 'automatic' } })).code);
  let Component; try { Component = (await import(compiledPath.href)).default; } finally { await unlink(compiledPath); }
  let root = createRoot(document.querySelector('#root'));
  const render = async lang => act(async () => root.render(createElement(StrictMode, null, createElement(Component, { userId: 'isolated-staff', lang }))));
  try {
    await render('en'); assert.equal(notificationTestSocket.listenerCount('notification'), 1);
    await act(async () => document.querySelector('.notification-bell').click());
    assert.match(document.querySelector('.notification-panel').textContent, /No notifications yet/);
    stored = [{ id: 'one', titleEn: 'New appointment', titleAr: 'موعد جديد', messageEn: 'Open reception.', messageAr: 'افتح الاستقبال.', createdAt: '2026-10-27T00:00:00.000Z', isRead: false }];
    await act(async () => { notificationTestSocket.emit('notification', { id: 'one' }); notificationTestSocket.emit('notification', { id: 'one' }); });
    assert.equal(document.querySelector('.notification-badge').textContent, '1');
    assert.equal(document.querySelectorAll('.notification-list li').length, 1);
    assert.match(document.querySelector('.notification-panel').textContent, /New appointment/);
    await act(async () => document.querySelector('.notification-list button').click());
    assert.equal(writes, 1); assert.equal(document.querySelector('.notification-badge'), null);
    stored = [{ ...stored[0], isRead: false }];
    await act(async () => notificationTestSocket.emit('connect'));
    assert.equal(document.querySelector('.notification-badge').textContent, '1');
    await render('ar'); assert.equal(document.querySelector('.notification-root').dir, 'rtl');
    assert.match(document.querySelector('.notification-panel').textContent, /موعد جديد/);
    stored = [
      { id: 'price', type: 'MEDICINE_PRICE_UPDATED', titleEn: 'Medicine price updated', titleAr: 'تم تحديث سعر الدواء', messageEn: 'A medicine price changed.', messageAr: 'تم تغيير سعر دواء.', createdAt: '2026-10-27T00:00:00.000Z', isRead: false },
      { id: 'availability', type: 'MEDICINE_STATUS_UPDATED', titleEn: 'Medicine availability updated', titleAr: 'تم تحديث حالة توفر الدواء', messageEn: 'A medicine availability setting changed.', messageAr: 'تم تغيير حالة توفر دواء.', createdAt: '2026-10-27T00:00:00.000Z', isRead: true }
    ];
    await act(async () => notificationTestSocket.emit('notification', { id: 'price', title: 'English socket compatibility text' }));
    assert.equal(document.querySelectorAll('.notification-list li').length, 2);
    assert.match(document.querySelector('.notification-panel').textContent, /تم تحديث سعر الدواء/);
    assert.match(document.querySelector('.notification-panel').textContent, /تم تحديث حالة توفر الدواء/);
    await render('en');
    assert.match(document.querySelector('.notification-panel').textContent, /Medicine price updated/);
    assert.match(document.querySelector('.notification-panel').textContent, /Medicine availability updated/);
    await render('ar');
    assert.match(document.querySelector('.notification-panel').textContent, /تم تحديث سعر الدواء/);
    assert.equal(document.querySelector('.notification-badge').textContent, '1');
    fail = true; await act(async () => document.querySelector('.notification-read-all').click());
    assert.ok(document.querySelector('[role=alert]')); assert.equal(document.querySelector('.notification-badge').textContent, '1');
    fail = false; await act(async () => document.querySelector('[role=alert] button').click());
    assert.equal(document.querySelector('[role=alert]'), null);
    await act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(document.querySelector('.notification-panel'), null); assert.equal(document.activeElement, document.querySelector('.notification-bell'));
    await act(async () => root.unmount()); assert.equal(notificationTestSocket.listenerCount('notification'), 0); assert.equal(notificationTestSocket.listenerCount('connect'), 0);
    root = createRoot(document.querySelector('#root'));
    await render('en'); assert.equal(document.querySelector('.notification-badge').textContent, '1', 'reload reads durable state');
    stored = [...stored, { id: 'legacy', title: 'English legacy title', message: 'English legacy message', createdAt: '2026-10-26T00:00:00.000Z', isRead: true }];
    await act(async () => notificationTestSocket.emit('notification', { id: 'legacy', title: 'English socket compatibility text' }));
    await render('ar');
    await act(async () => document.querySelector('.notification-bell').click());
    assert.match(document.querySelector('.notification-panel').textContent, /تحديث تشغيلي/);
    assert.doesNotMatch(document.querySelector('.notification-panel').textContent, /English legacy|English socket/);
    assert.equal(document.querySelector('.notification-badge').textContent, '1', 'read legacy row does not alter the unread count');
  } finally { await act(async () => root.unmount()); dom.window.close(); delete globalThis.notificationTestRequest; delete globalThis.notificationTestSocket; }
});
