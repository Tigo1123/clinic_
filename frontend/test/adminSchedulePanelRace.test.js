import test from 'node:test';
import assert from 'node:assert/strict';
import { createLatestGuard } from '../src/features/admin/latestRequest.js';


test('a slow response for a superseded doctor is ignored', async () => {
  const guard = createLatestGuard();
  const applied = [];
  const load = async (id, delayMs) => {
    const token = guard.start(id);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (guard.isCurrent(token)) applied.push(id);
  };
  await Promise.all([load('doctor-A', 30), load('doctor-B', 5)]);
  assert.deepEqual(applied, ['doctor-B']);
});

test('switching doctors invalidates in-flight responses even before the new request starts', () => {
  const guard = createLatestGuard();
  const first = guard.start('doctor-A');
  const second = guard.start('doctor-B');
  assert.equal(guard.isCurrent(first), false);
  assert.equal(guard.isCurrent(second), true);
  const third = guard.start('doctor-A');
  assert.equal(guard.isCurrent(first), false);
  assert.equal(guard.isCurrent(third), true);
});
