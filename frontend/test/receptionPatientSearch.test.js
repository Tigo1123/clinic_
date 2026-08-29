import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLatestSearchScheduler, visiblePatientDirectory } from '../src/features/reception/debouncedSearch.js';

const source = readFileSync(new URL('../src/features/reception/ReceptionDashboard.jsx', import.meta.url), 'utf8');

function fakeTimers() {
  const timers = [];
  return {
    timers,
    setTimer(callback, delay) {
      const timer = { callback, delay, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) {
      if (timer) timer.cancelled = true;
    },
    async runLatest() {
      const timer = timers.findLast((item) => !item.cancelled);
      await timer?.callback();
    }
  };
}

test('raw directory input remains controlled before and after the debounced request', () => {
  assert.match(source, /value=\{patientDirectoryQuery\}/);
  assert.match(source, /setPatientDirectoryQuery\(val\)/);
  assert.doesNotMatch(source, /setPatientDirectoryQuery\(query\)/);
  assert.match(source, /visiblePatientDirectoryResults\.length/);
});

test('patient search waits 350ms and only executes the latest queued keystroke', async () => {
  const clock = fakeTimers();
  const scheduler = createLatestSearchScheduler(clock);
  const requested = [];

  scheduler.schedule(async () => requested.push('SHF-0'));
  scheduler.schedule(async () => requested.push('SHF-00'));
  scheduler.schedule(async () => requested.push('SHF-000001'));

  assert.deepEqual(requested, []);
  assert.equal(clock.timers.at(-1).delay, 350);
  await clock.runLatest();
  assert.deepEqual(requested, ['SHF-000001']);
});

test('latest response wins and an older delayed response is ignored', async () => {
  const clock = fakeTimers();
  const scheduler = createLatestSearchScheduler(clock);
  const applied = [];
  let resolveOld;
  const oldResult = new Promise((resolve) => { resolveOld = resolve; });

  scheduler.schedule(() => oldResult, { onSuccess: (value) => applied.push(value) });
  const oldTimer = clock.timers.at(-1);
  const oldRun = oldTimer.callback();
  scheduler.schedule(async () => 'new', { onSuccess: (value) => applied.push(value) });
  await clock.runLatest();
  resolveOld('old');
  await oldRun;

  assert.deepEqual(applied, ['new']);
});

test('clearing cancels a delayed response and immediately restores the directory collection', async () => {
  const clock = fakeTimers();
  const scheduler = createLatestSearchScheduler(clock);
  const applied = [];
  let resolveSearch;
  const delayed = new Promise((resolve) => { resolveSearch = resolve; });

  scheduler.schedule(() => delayed, { onSuccess: (value) => applied.push(value) });
  const pendingRun = clock.timers.at(-1).callback();
  scheduler.cancel();
  resolveSearch(['stale patient']);
  await pendingRun;

  const directory = [{ id: 'one' }, { id: 'two' }];
  assert.deepEqual(applied, []);
  assert.equal(visiblePatientDirectory('', directory, ['stale patient']), directory);
  assert.equal(visiblePatientDirectory('SHF-000001', directory, [{ id: 'one' }]).length, 1);
  assert.equal(visiblePatientDirectory('patient name', directory, []).length, 0);
});

test('exact MRN and name searches use the existing API and results still open Patient Profile', () => {
  assert.match(source, /\/api\/patients\/search\?q=\$\{encodeURIComponent\(query\)\}/);
  assert.match(source, /SHF-000001/);
  assert.match(source, /setViewingProfilePatientId\(patient\.id\)/);
  assert.match(source, /<PatientProfileModal/);
});
