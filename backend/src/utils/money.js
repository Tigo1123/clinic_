import { Prisma } from '../generated/prisma/index.js';

// Current billing contract is whole SDG. Keep the contract while doing currency
// conversion in Decimal; never multiply/divide money through binary floats.
const Decimal = Prisma.Decimal.clone({ precision: 65, rounding: Prisma.Decimal.ROUND_HALF_UP });
export const money = value => new Decimal(String(value));
// Existing JSON responses use numbers. Convert only after exact arithmetic.
export const addMoney = (a, b) => money(a).plus(b).toNumber();
export const subtractMoney = (a, b) => money(a).minus(b).toNumber();
export const multiplyMoney = (a, b) => money(a).mul(b).toNumber();
export const usdFromSdg = (amount, rate = '1500') => money(amount).div(money(rate)).toDecimalPlaces(30);
