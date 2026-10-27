import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createNotificationFeed } from '../src/services/notificationFeed.js';
import { resolveStaffSocketUrl } from '../src/services/staffSocketUrl.js';
import { subscribeWorkflowRefresh } from '../src/hooks/useWorkflowRefresh.js';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const page = (id, unreadCount = 1) => ({ notifications: [{ id, titleEn: id, isRead: !unreadCount }], unreadCount, nextCursor: null, asOf: '2026-10-27T00:00:00.000Z' });

test('socket origin follows the staff API on split deployments and preserves explicit and same-origin configurations', () => {
  const origin = 'https://clinic-web.example';
  assert.equal(resolveStaffSocketUrl({ VITE_STAFF_API_URL: 'https://clinic-api.example/api' }, origin), 'https://clinic-api.example');
  assert.equal(resolveStaffSocketUrl({ VITE_API_BASE_URL: 'https://clinic-api.example/' }, origin), 'https://clinic-api.example');
  assert.equal(resolveStaffSocketUrl({ VITE_STAFF_SOCKET_URL: 'https://realtime.example', VITE_STAFF_API_URL: 'https://api.example' }, origin), 'https://realtime.example');
  assert.equal(resolveStaffSocketUrl({ VITE_API_BASE_URL: '/api' }, origin), origin);
  assert.equal(resolveStaffSocketUrl({ DEV: true }, origin), 'http://localhost:5000');
});

test('burst events coalesce, stale reads are rejected, and server unread counts never double-increment', async () => {
  const pending = []; let state;
  const feed = createNotificationFeed(() => { const task = deferred(); pending.push(task); return task.promise; }, next => { state = next; });
  const first = feed.refresh(); feed.refresh(); feed.refresh(); await tick();
  assert.equal(pending.length, 1);
  feed.refresh(); pending[0].resolve(page('obsolete', 99)); await tick();
  assert.equal(pending.length, 2); assert.equal(state.notifications.length, 0);
  pending[1].resolve(page('current', 3)); await first;
  assert.equal(state.unreadCount, 3); assert.equal(state.notifications[0].id, 'current');
  const repeated = feed.refresh(); feed.refresh(); await tick(); pending[2].resolve(page('current', 3)); await repeated;
  assert.equal(state.unreadCount, 3); assert.equal(state.notifications.length, 1); feed.dispose();
});

test('read mutations use authoritative refresh, guard double clicks and surface failures', async () => {
  let state; let stored = page('one'); const mutation = deferred(); const calls = [];
  const feed = createNotificationFeed(async (path, options) => {
    calls.push({ path, options });
    if (options.method === 'PATCH') { await mutation.promise; stored = page('one', 0); return { unreadCount: 0 }; }
    return stored;
  }, next => { state = next; });
  await feed.refresh();
  const saving = feed.markRead('one'); await feed.markRead('one');
  assert.equal(calls.filter(c => c.options.method === 'PATCH').length, 1);
  assert.equal(state.unreadCount, 1, 'no optimistic success before server persistence');
  mutation.resolve(); await saving; assert.equal(state.unreadCount, 0); assert.equal(state.notifications[0].isRead, true);
  feed.dispose();
  const failed = createNotificationFeed(async (_path, options) => { if (options.method) throw Error('Offline'); return page('two'); }, next => { state = next; });
  await failed.refresh(); await failed.markRead('two');
  assert.equal(state.error, true); assert.equal(state.unreadCount, 1); assert.equal(state.pending, false); failed.dispose();
});

test('mark all preserves unseen arrivals using the list snapshot cutoff and reload recovers durable unread state', async () => {
  let mutation; let state;
  const request = async (_path, options) => { if (options.method) mutation = JSON.parse(options.body); return page('offline', 7); };
  const feed = createNotificationFeed(request, next => { state = next; });
  await feed.refresh(); await feed.markRead();
  assert.equal(mutation.before, '2026-10-27T00:00:00.000Z'); feed.dispose();
  const reloaded = createNotificationFeed(request, next => { state = next; }); await reloaded.refresh();
  assert.equal(state.unreadCount, 7); reloaded.dispose();
});

test('pagination deduplicates overlapping IDs and cannot restore an old page after a newer event', async () => {
  let state; const more = deferred();
  const feed = createNotificationFeed(async path => path.includes('?') ? more.promise : { ...page('new'), nextCursor: 'cursor' }, next => { state = next; });
  await feed.refresh(); const loading = feed.loadMore(); const refreshing = feed.refresh();
  await refreshing; more.resolve({ ...page('old'), nextCursor: null }); await loading;
  assert.deepEqual(state.notifications.map(n => n.id), ['new']); feed.dispose();
  const overlap = createNotificationFeed(async path => path.includes('?') ? { notifications: [page('new').notifications[0], page('older').notifications[0]], unreadCount: 2, nextCursor: null } : { ...page('new'), nextCursor: 'cursor' }, next => { state = next; });
  await overlap.refresh(); await overlap.loadMore(); assert.equal(state.notifications.length, 2); overlap.dispose();
});

test('disposing a feed aborts reads and prevents state updates after unmount or identity change', async () => {
  const pending = deferred(); let signal; const updates = [];
  const feed = createNotificationFeed((_path, options) => { signal = options.signal; return pending.promise; }, next => updates.push(next));
  const loading = feed.refresh(); await tick(); feed.dispose();
  assert.equal(signal.aborted, true); const count = updates.length;
  pending.resolve(page('old-user')); await loading; assert.equal(updates.length, count);
});

test('workflow reconnect, focus and event bursts refetch serially with role topic filtering and complete cleanup', async () => {
  const socket = new EventEmitter(); const windowTarget = new EventTarget(); const documentTarget = new EventTarget(); documentTarget.visibilityState = 'visible';
  let calls = 0; const running = deferred();
  const unsubscribe = subscribeWorkflowRefresh(socket, ['catalog'], async () => { calls += 1; if (calls === 1) await running.promise; }, { windowTarget, documentTarget });
  socket.emit('workflowUpdated', { topic: 'security' }); await tick(); assert.equal(calls, 0);
  socket.emit('workflowUpdated', { topic: 'catalog' }); socket.emit('workflowUpdated', { topic: 'catalog' }); await tick(); assert.equal(calls, 1);
  socket.emit('connect'); windowTarget.dispatchEvent(new Event('focus')); documentTarget.dispatchEvent(new Event('visibilitychange'));
  await tick(); assert.equal(calls, 1); running.resolve(); await tick(); assert.equal(calls, 2);
  socket.emit('workflowUpdated', { topic: 'reconnected' }); await tick(); assert.equal(calls, 3);
  unsubscribe(); assert.equal(socket.listenerCount('workflowUpdated'), 0); assert.equal(socket.listenerCount('connect'), 0);
  windowTarget.dispatchEvent(new Event('focus')); socket.emit('workflowUpdated', { topic: 'catalog' }); await tick(); assert.equal(calls, 3);
});
