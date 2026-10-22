import { Prisma } from '../generated/prisma/index.js';

export const PAYMENT_METHOD_CODES = Object.freeze(['CASH', 'CARD', 'BANKAK', 'FAWRY']);

export async function activePaymentMethods(client) {
  const methods = await client.paymentMethod.findMany({ where: { active: true }, orderBy: { code: 'asc' }, select: { code: true, labelAr: true, labelEn: true } });
  return methods.sort((a, b) => PAYMENT_METHOD_CODES.indexOf(a.code) - PAYMENT_METHOD_CODES.indexOf(b.code));
}

export async function requireActivePaymentMethods(tx, codes) {
  const unique = [...new Set(codes)].sort();
  await tx.$queryRaw(Prisma.sql`SELECT "code" FROM "PaymentMethod" WHERE "code" IN (${Prisma.join(unique)}) ORDER BY "code" FOR SHARE`);
  const active = await tx.paymentMethod.count({ where: { code: { in: unique }, active: true } });
  if (active !== unique.length) throw Object.assign(new Error('A selected payment method is inactive or unavailable.'), { status: 409, code: 'PAYMENT_METHOD_INACTIVE' });
}
