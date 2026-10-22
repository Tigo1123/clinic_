import test from 'node:test';
import assert from 'node:assert/strict';
import { money, addMoney, subtractMoney, multiplyMoney, usdFromSdg } from '../src/utils/money.js';

test('monetary arithmetic avoids binary floating-point accumulation', () => {
  assert.equal(addMoney('0.1', '0.2'), 0.3);
  assert.equal(subtractMoney('0.3', '0.1'), 0.2);
  assert.equal(multiplyMoney('0.1', 3), 0.3);
  assert.equal(money('17001').mul(3).toString(), '51003');
});
test('USD conversion is rounded to the existing database scale with high precision', () => {
  assert.equal(usdFromSdg('17001').toString(), '11.334');
  assert.equal(usdFromSdg('1').toFixed(30), '0.000666666666666666666666666667');
  assert.equal(usdFromSdg('1000000000').toFixed(30), '666666.666666666666666666666666666667');
});
