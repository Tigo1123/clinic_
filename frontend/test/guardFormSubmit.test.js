import assert from 'node:assert/strict';
import test from 'node:test';
import { guardFormSubmit } from '../src/utils/guardFormSubmit.js';

test('a pending form ignores duplicate submissions and can retry after failure', async () => {
  const form = {};
  let prevented = 0;
  const event = { currentTarget: form, preventDefault: () => { prevented += 1; } };
  let reject;
  const first = guardFormSubmit(event, () => new Promise((_, fail) => { reject = fail; }));
  await guardFormSubmit(event, () => assert.fail('duplicate submission ran'));
  reject(new Error('network error'));
  await assert.rejects(first, /network error/);
  assert.equal(await guardFormSubmit(event, () => 'saved'), 'saved');
  assert.equal(prevented, 3);
});
