import * as legacyMoney from '../../utils/money.js';

// Single source of truth is the legacy src/utils/money.js. These are typed
// re-exports so Nest call sites keep the same public signatures.
export const money: (value: any) => any = legacyMoney.money;
export const addMoney: (a: any, b: any) => number = legacyMoney.addMoney;
export const subtractMoney: (a: any, b: any) => number = legacyMoney.subtractMoney;
export const multiplyMoney: (a: any, b: any) => number = legacyMoney.multiplyMoney;
export const usdFromSdg: (amount: any, rate?: any) => any = legacyMoney.usdFromSdg;
