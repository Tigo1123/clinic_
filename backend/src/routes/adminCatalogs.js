import { z } from 'zod';
import { Prisma } from '../generated/prisma/index.js';
import prisma from '../db.js';
import { asyncRouter } from '../utils/asyncRouter.js';
import { authenticate, checkRoles } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { sendError } from '../utils/apiError.js';
import { usdFromSdg, money } from '../utils/money.js';

const router = asyncRouter();
router.use(authenticate, checkRoles('ADMIN'));
const label = z.string().trim().min(1).max(150).regex(/^[^\u0000-\u001f\u007f]+$/u);
const code = z.string().trim().toLowerCase().min(1).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const categories = ['CONSULTATION', 'LABORATORY', 'RADIOLOGY', 'CLINICAL_PROCEDURE'];
const price = z.union([z.string().regex(/^[1-9]\d{0,9}$/), z.number().int().positive().max(1_000_000_000)])
  .refine(value => money(value).lte('1000000000'), 'Price exceeds the supported range.');
const createSchema = z.object({ code, labelAr: label, labelEn: label, category: z.enum(categories), priceSdg: price, status: z.enum(['ACTIVE', 'INACTIVE']).default('INACTIVE') }).strict();
const updateSchema = createSchema.omit({ category: true }).partial().refine(value => Object.keys(value).length > 0, 'No changes supplied.');
const pageSchema = z.object({ search: z.string().trim().max(100).default(''), category: z.enum(categories).optional(), status: z.enum(['ACTIVE', 'INACTIVE']).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) }).strict();
const idSchema = z.object({ id: z.string().uuid() });
function isValidCopayPercentage(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return false;
  } else if (typeof value !== 'string') {
    return false;
  }
  const normalized = String(value).trim();
  if (!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/.test(normalized)) return false;
  const [whole, fraction = ''] = normalized.split('.');
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(basisPoints) && basisPoints >= 0 && basisPoints <= 10_000;
}
function isValidBillingCycleDays(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 1 && value <= 365;
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  if (!/^[1-9]\d{0,2}$/.test(normalized)) return false;
  const days = Number(normalized);
  return Number.isSafeInteger(days) && days >= 1 && days <= 365;
}
const copayPercentageSchema = z.union([z.string(), z.number()])
  .refine(isValidCopayPercentage, 'Copay percentage must be between 0 and 100 with up to 2 decimal places.')
  .transform(value => String(value).trim());
const billingCycleDaysSchema = z.union([z.string(), z.number()])
  .refine(isValidBillingCycleDays, 'Billing cycle must be a whole number of days between 1 and 365.')
  .transform(value => Number(String(value).trim()));
const insuranceCreateSchema = z.object({
  labelAr: label,
  labelEn: label,
  copayPercentage: copayPercentageSchema,
  billingCycleDays: billingCycleDaysSchema,
  active: z.boolean().default(true)
}).strict();
const insuranceUpdateSchema = z.object({
  labelAr: label.optional(),
  labelEn: label.optional(),
  copayPercentage: copayPercentageSchema.optional(),
  billingCycleDays: billingCycleDaysSchema.optional(),
  active: z.boolean().optional()
}).strict().refine(value => Object.keys(value).length > 0, 'No changes supplied.');
const normalize = value => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const dto = service => ({ id: service.id, code: service.code, labelAr: service.labelAr, labelEn: service.labelEn, category: service.category, status: service.status, priceSdg: service.baseFeeSdg?.toString() ?? null, updatedAt: service.updatedAt });
const insuranceDto = company => ({
  id: company.id,
  labelAr: company.labelAr,
  labelEn: company.labelEn,
  copayPercentage: Number(company.copayPercentage),
  billingCycleDays: company.billingCycleDays,
  active: company.active,
  createdAt: company.createdAt,
  updatedAt: company.updatedAt
});
const audit = (tx, req, action, details) => tx.tenantAuditLog.create({ data: { userId: req.user.id, action, details: JSON.stringify(details), ipAddress: req.ip || 'unknown' } });

async function uniqueInsuranceCompany(tx, data, exceptId) {
  const keys = [
    `insurance-company:ar:${normalize(data.labelAr)}`,
    `insurance-company:en:${normalize(data.labelEn)}`
  ].sort();
  for (const key of [...new Set(keys)]) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key})) IS NULL AS locked`;
  const candidates = await tx.insuranceCompany.findMany({ where: exceptId ? { id: { not: exceptId } } : {}, select: { labelAr: true, labelEn: true } });
  if (candidates.some(item => normalize(item.labelAr) === normalize(data.labelAr) || normalize(item.labelEn) === normalize(data.labelEn))) {
    throw Object.assign(new Error('An insurance provider with one of these names already exists.'), { status: 409, code: 'INSURANCE_COMPANY_DUPLICATE' });
  }
}

async function uniqueService(tx, data, exceptId) {
  // Share the existing lab-review label lock protocol. Renames lock both new
  // labels before checking every writer's existing service identities.
  const keys = [data.labelAr, data.labelEn].map(normalize).map(value => `${data.category === 'LABORATORY' ? 'lab-service' : `catalog-service:${data.category}`}:${value}`).sort();
  for (const key of [...new Set(keys)]) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key})) IS NULL AS locked`;
  const candidates = await tx.clinicalService.findMany({ where: { category: data.category, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { labelAr: true, labelEn: true } });
  if (candidates.some(item => normalize(item.labelAr) === normalize(data.labelAr) || normalize(item.labelEn) === normalize(data.labelEn))) {
    throw Object.assign(new Error('A service with one of these names already exists in this category.'), { status: 409, code: 'CATALOG_DUPLICATE' });
  }
}

function failure(error, res, next) {
  if (error.code === 'P2002') return sendError(res, 409, 'CATALOG_DUPLICATE', 'This catalog code or name already exists.');
  if (error.code === 'P2025') return sendError(res, 404, 'CATALOG_NOT_FOUND', 'Catalog entry not found.');
  if (error.status) return sendError(res, error.status, error.code, error.message);
  next(error);
}

router.get('/catalog/services', validate(pageSchema, 'query'), async (req, res) => {
  const { page, pageSize, search, category, status } = req.query;
  const where = { ...(category ? { category } : {}), ...(status ? { status } : {}), ...(search ? { OR: ['code', 'labelAr', 'labelEn'].map(field => ({ [field]: { contains: search, mode: 'insensitive' } })) } : {}) };
  const [total, items] = await prisma.$transaction([
    prisma.clinicalService.count({ where }),
    prisma.clinicalService.findMany({ where, orderBy: [{ labelEn: 'asc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  res.json({ items: items.map(dto), page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
});

router.post('/catalog/services', validate(createSchema), async (req, res, next) => {
  try {
    const result = await prisma.$transaction(async tx => {
      await uniqueService(tx, req.body);
      const created = await tx.clinicalService.create({ data: { code: req.body.code, labelAr: req.body.labelAr, labelEn: req.body.labelEn, category: req.body.category, status: req.body.status, baseFeeSdg: money(req.body.priceSdg), baseFeeUsd: usdFromSdg(req.body.priceSdg) } });
      await audit(tx, req, 'CATALOG_SERVICE_CREATED', { serviceId: created.id, code: created.code, category: created.category });
      return created;
    });
    res.status(201).json(dto(result));
  } catch (error) { failure(error, res, next); }
});

router.patch('/catalog/services/:id', validate(idSchema, 'params'), validate(updateSchema), async (req, res, next) => {
  try {
    const result = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "ClinicalService" WHERE "id" = ${req.params.id} FOR UPDATE`;
      const existing = await tx.clinicalService.findUniqueOrThrow({ where: { id: req.params.id } });
      const identity = { ...existing, ...req.body };
      await uniqueService(tx, identity, existing.id);
      if ((req.body.status || existing.status) === 'ACTIVE' && req.body.priceSdg === undefined && (!existing.baseFeeSdg || !existing.baseFeeSdg.isInteger() || existing.baseFeeSdg.lte(0))) {
        throw Object.assign(new Error('An active service requires an official whole-SDG price.'), { status: 422, code: 'CATALOG_PRICE_REQUIRED' });
      }
      const { priceSdg, ...metadata } = req.body;
      const updated = await tx.clinicalService.update({ where: { id: existing.id }, data: { ...metadata, ...(priceSdg !== undefined ? { baseFeeSdg: money(priceSdg), baseFeeUsd: usdFromSdg(priceSdg) } : {}) } });
      await audit(tx, req, 'CATALOG_SERVICE_UPDATED', { serviceId: existing.id, changedFields: Object.keys(req.body), previousStatus: existing.status, status: updated.status, previousPriceSdg: existing.baseFeeSdg?.toString() ?? null, priceSdg: updated.baseFeeSdg?.toString() ?? null });
      return updated;
    });
    res.json(dto(result));
  } catch (error) { failure(error, res, next); }
});

router.get('/catalog/payment-methods', async (req, res) => {
  res.json(await prisma.paymentMethod.findMany({ orderBy: { code: 'asc' } }));
});

router.patch('/catalog/payment-methods/:code', validate(z.object({ code: z.enum(['CASH', 'CARD', 'BANKAK', 'FAWRY']) }), 'params'), validate(z.object({ labelAr: label.optional(), labelEn: label.optional(), active: z.boolean().optional() }).strict().refine(value => Object.keys(value).length > 0)), async (req, res, next) => {
  try {
    const result = await prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT "code" FROM "PaymentMethod" WHERE "code" = ${req.params.code} FOR UPDATE`);
      const updated = await tx.paymentMethod.update({ where: { code: req.params.code }, data: req.body });
      await audit(tx, req, 'PAYMENT_METHOD_CONFIGURED', { code: updated.code, active: updated.active, changedFields: Object.keys(req.body) });
      return updated;
    });
    res.json(result);
  } catch (error) { failure(error, res, next); }
});

router.get('/catalog/insurance-companies', async (req, res) => {
  const companies = await prisma.insuranceCompany.findMany({ orderBy: [{ labelEn: 'asc' }, { id: 'asc' }] });
  res.json(companies.map(insuranceDto));
});

router.post('/catalog/insurance-companies', validate(insuranceCreateSchema), async (req, res, next) => {
  try {
    const created = await prisma.$transaction(async tx => {
      await uniqueInsuranceCompany(tx, req.body);
      const company = await tx.insuranceCompany.create({
        data: {
          labelAr: req.body.labelAr,
          labelEn: req.body.labelEn,
          copayPercentage: money(req.body.copayPercentage),
          billingCycleDays: req.body.billingCycleDays,
          active: req.body.active
        }
      });
      await audit(tx, req, 'INSURANCE_COMPANY_CREATED', {
        insuranceCompanyId: company.id,
        labelAr: company.labelAr,
        labelEn: company.labelEn,
        copayPercentage: Number(company.copayPercentage),
        billingCycleDays: company.billingCycleDays,
        active: company.active
      });
      return company;
    });
    res.status(201).json(insuranceDto(created));
  } catch (error) { failure(error, res, next); }
});

router.patch('/catalog/insurance-companies/:id', validate(idSchema, 'params'), validate(insuranceUpdateSchema), async (req, res, next) => {
  try {
    const updated = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "InsuranceCompany" WHERE "id" = ${req.params.id} FOR UPDATE`;
      const existing = await tx.insuranceCompany.findUnique({ where: { id: req.params.id } });
      if (!existing) {
        throw Object.assign(new Error('Insurance provider not found.'), { status: 404, code: 'INSURANCE_COMPANY_NOT_FOUND' });
      }
      const identity = {
        labelAr: req.body.labelAr ?? existing.labelAr,
        labelEn: req.body.labelEn ?? existing.labelEn
      };
      await uniqueInsuranceCompany(tx, identity, existing.id);
      const { copayPercentage, ...rest } = req.body;
      const company = await tx.insuranceCompany.update({
        where: { id: existing.id },
        data: {
          ...rest,
          ...(copayPercentage !== undefined ? { copayPercentage: money(copayPercentage) } : {})
        }
      });
      await audit(tx, req, 'INSURANCE_COMPANY_UPDATED', {
        insuranceCompanyId: company.id,
        changedFields: Object.keys(req.body),
        previousActive: existing.active,
        active: company.active,
        previousCopayPercentage: Number(existing.copayPercentage),
        copayPercentage: Number(company.copayPercentage),
        previousBillingCycleDays: existing.billingCycleDays,
        billingCycleDays: company.billingCycleDays
      });
      return company;
    });
    res.json(insuranceDto(updated));
  } catch (error) { failure(error, res, next); }
});

export default router;
