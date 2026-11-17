import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpException, HttpStatus } from '@nestjs/common';

// Service-level regression tests for the billing-state and admin-lockout fixes.
// They run the compiled Nest services (dist/) against in-memory Prisma doubles,
// the same way test/nestjs-phase10.test.js does, so no database is required.

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://localhost:5433/clinic_test';
process.env.SOCKET_REVOCATION_DATABASE_URL = 'postgresql://localhost:5433/clinic_test';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-thirty-two-characters';
process.env.MEDICAL_ENCRYPTION_KEY = 'test-medical-key-separate-at-least-thirty-two';

const sqlText = (query) => (Array.isArray(query) ? query.join('?') : String(query.sql ?? query.strings?.join('?') ?? ''));

// ---------------------------------------------------------------- Fix 1

async function pharmacyHarness({ invoice, payAfterRead = false }) {
  const { PharmacyService } = await import('../dist/modules/pharmacy/pharmacy.service.js');
  const state = { invoice: { ...invoice }, locks: [], order: [], updateManyArgs: null };
  const tx = {
    $queryRaw: async (query) => {
      state.locks.push(sqlText(query));
      state.order.push('lock');
      return [];
    },
    prescribedDrug: {
      findUnique: async () => ({
        id: 'drug-1',
        prescriptionId: 'rx-1',
        qtyPrescribed: 2,
        qtyDispensed: 0,
        pharmacyReviewStatus: 'PENDING',
        prescription: { id: 'rx-1', status: 'ACTIVE' },
      }),
      update: async () => ({}),
      findMany: async () => [{ qtyPrescribed: 2, qtyDispensed: 0, pharmacyReviewStatus: 'EXTERNAL' }],
    },
    prescription: { update: async () => ({}) },
    invoice: {
      findMany: async () => {
        state.order.push('read');
        const rows = state.invoice.paymentStatus === 'VOIDED' ? [] : [{ ...state.invoice, payments: state.invoice.payments || [] }];
        if (payAfterRead) state.invoice.paymentStatus = 'PAID'; // a payment commits right after the read
        return rows;
      },
      updateMany: async (args) => {
        state.updateManyArgs = args;
        const matches = state.invoice.id === args.where.id && state.invoice.paymentStatus === args.where.paymentStatus;
        if (matches) Object.assign(state.invoice, { paymentStatus: args.data.paymentStatus });
        return { count: matches ? 1 : 0 };
      },
    },
    tenantAuditLog: { create: async () => ({}) },
  };
  const prisma = { $transaction: async (fn) => fn(tx) };
  return { service: new PharmacyService(prisma, { emitQueueUpdate: () => {} }), state };
}

const pharmacist = { id: 'user-pharm', role: 'PHARMACIST' };

test('markMedicationUnavailable refuses a PAID pharmacy invoice and leaves it PAID', async () => {
  const { service, state } = await pharmacyHarness({
    invoice: { id: 'inv-1', paymentStatus: 'PAID', payments: [{ id: 'pay-1' }] },
  });
  await assert.rejects(
    () => service.markMedicationUnavailable('drug-1', { reason: 'OUT_OF_STOCK' }, pharmacist, '127.0.0.1'),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.CONFLICT);
      assert.equal(err.getResponse().code, 'PHARMACY_UNAVAILABLE_PAID_REVIEW_REQUIRED');
      return true;
    },
  );
  assert.equal(state.invoice.paymentStatus, 'PAID');
  assert.equal(state.updateManyArgs, null);
});

test('markMedicationUnavailable voids an UNPAID pharmacy invoice after locking, with a ledger bump', async () => {
  const { service, state } = await pharmacyHarness({
    invoice: { id: 'inv-1', paymentStatus: 'UNPAID', payments: [] },
  });
  const result = await service.markMedicationUnavailable('drug-1', { reason: 'OUT_OF_STOCK' }, pharmacist, '127.0.0.1');
  assert.equal(result.success, true);
  assert.equal(state.invoice.paymentStatus, 'VOIDED');
  assert.deepEqual(state.updateManyArgs.where, { id: 'inv-1', paymentStatus: 'UNPAID' });
  assert.deepEqual(state.updateManyArgs.data, { paymentStatus: 'VOIDED', ledgerVersion: { increment: 1 } });
  // advisory lock + row lock are both taken before the invoice read
  assert.deepEqual(state.order.slice(0, 3), ['lock', 'lock', 'read']);
  assert.match(state.locks[0], /pg_advisory_xact_lock/);
  assert.match(state.locks[1], /FOR UPDATE/);
  assert.match(state.locks[1], /ORDER BY "id"/);
});

test('markMedicationUnavailable refuses when a payment lands between the read and the void', async () => {
  const { service, state } = await pharmacyHarness({
    invoice: { id: 'inv-1', paymentStatus: 'UNPAID', payments: [] },
    payAfterRead: true,
  });
  await assert.rejects(
    () => service.markMedicationUnavailable('drug-1', { reason: 'OUT_OF_STOCK' }, pharmacist, '127.0.0.1'),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.CONFLICT);
      assert.equal(err.getResponse().code, 'PHARMACY_UNAVAILABLE_PAID_REVIEW_REQUIRED');
      return true;
    },
  );
  assert.equal(state.invoice.paymentStatus, 'PAID');
});

// ---------------------------------------------------------------- Fix 2

async function adminHarness({ users }) {
  const { AdminService } = await import('../dist/modules/admin/admin.service.js');
  const state = { users: structuredClone(users), locks: [], audits: [] };
  const pick = (id) => state.users.find((user) => user.id === id) || null;
  const tx = {
    $queryRaw: async (query) => {
      state.locks.push({ sql: sqlText(query), values: query.values });
      return [];
    },
    user: {
      findUnique: async ({ where }) => {
        const user = pick(where.id);
        return user ? { ...user } : null;
      },
      update: async ({ where, data }) => {
        const user = pick(where.id);
        user.status = data.status;
        user.authVersion = (user.authVersion || 0) + 1;
        return { ...user };
      },
    },
    doctor: { findUnique: async () => null, update: async () => ({}) },
    tenantAuditLog: { create: async ({ data }) => state.audits.push(data) },
  };
  const prisma = { $transaction: async (fn) => fn(tx) };
  return { service: new AdminService(prisma), state };
}

const adminUsers = [
  { id: 'admin-a', username: 'a@example.test', role: 'ADMIN', status: 'ACTIVE', authVersion: 0 },
  { id: 'admin-b', username: 'b@example.test', role: 'ADMIN', status: 'ACTIVE', authVersion: 0 },
  { id: 'recep-1', username: 'r@example.test', role: 'RECEPTIONIST', status: 'ACTIVE', authVersion: 0 },
];

test('toggleStaffStatus refuses self-deactivation with 409 ADMIN_SELF_DEACTIVATION_UNSUPPORTED', async () => {
  const { service, state } = await adminHarness({ users: adminUsers });
  await assert.rejects(
    () => service.toggleStaffStatus('admin-a', 'INACTIVE', 'admin-a', '127.0.0.1'),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.CONFLICT);
      assert.equal(err.getResponse().code, 'ADMIN_SELF_DEACTIVATION_UNSUPPORTED');
      return true;
    },
  );
  assert.equal(state.users[0].status, 'ACTIVE');
  assert.equal(state.locks.length, 0, 'refused before the transaction starts');
});

test('toggleStaffStatus still deactivates and reactivates another staff user, locking both rows in id order', async () => {
  const { service, state } = await adminHarness({ users: adminUsers });
  const down = await service.toggleStaffStatus('recep-1', 'INACTIVE', 'admin-a', '127.0.0.1');
  assert.equal(down.status, 'INACTIVE');
  assert.match(state.locks[0].sql, /ORDER BY "id" FOR UPDATE/);
  assert.deepEqual([...state.locks[0].values].sort(), ['admin-a', 'recep-1']);
  const up = await service.toggleStaffStatus('recep-1', 'ACTIVE', 'admin-a', '127.0.0.1');
  assert.equal(up.status, 'ACTIVE');
  assert.equal(state.audits.filter((audit) => audit.action === 'USER_STATUS_CHANGE').length, 2);
});

test('toggleStaffStatus lets an admin reactivate themselves only as a no-op, never deactivate', async () => {
  const { service } = await adminHarness({ users: adminUsers });
  const same = await service.toggleStaffStatus('admin-a', 'ACTIVE', 'admin-a', '127.0.0.1');
  assert.equal(same.status, 'ACTIVE');
});

test('toggleStaffStatus rejects an actor who is no longer an active admin (mutual deactivation loser)', async () => {
  const users = structuredClone(adminUsers);
  users.find((user) => user.id === 'admin-b').status = 'INACTIVE'; // B was deactivated by A first
  const { service, state } = await adminHarness({ users });
  await assert.rejects(
    () => service.toggleStaffStatus('admin-a', 'INACTIVE', 'admin-b', '127.0.0.1'),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.FORBIDDEN);
      assert.equal(err.getResponse().code, 'ADMIN_ACTOR_NOT_ACTIVE');
      return true;
    },
  );
  assert.equal(state.users.find((user) => user.id === 'admin-a').status, 'ACTIVE');

  const nonAdmin = await adminHarness({ users: adminUsers });
  await assert.rejects(
    () => nonAdmin.service.toggleStaffStatus('admin-a', 'INACTIVE', 'recep-1', '127.0.0.1'),
    (err) => err.getResponse().code === 'ADMIN_ACTOR_NOT_ACTIVE',
  );
  const missing = await adminHarness({ users: adminUsers });
  await assert.rejects(
    () => missing.service.toggleStaffStatus('recep-1', 'INACTIVE', 'ghost', '127.0.0.1'),
    (err) => err.getResponse().code === 'ADMIN_ACTOR_NOT_ACTIVE',
  );
});

test('toggleStaffStatus keeps the Express-parity plain Error for a missing target', async () => {
  const { service } = await adminHarness({ users: adminUsers });
  await assert.rejects(
    () => service.toggleStaffStatus('nobody', 'INACTIVE', 'admin-a', '127.0.0.1'),
    (err) => !(err instanceof HttpException) && err.message === 'STAFF_STATUS_TARGET_NOT_FOUND',
  );
});

// ---------------------------------------------------------------- Fixes 3 and 4

function billingHarness({ copayPercentage, existingByType = {}, labOrderStatus = 'PENDING_BILLING' } = {}) {
  const state = { invoices: [], audits: [], labOrder: { id: 'lab-1', status: labOrderStatus }, findFirstWheres: [] };
  const company = copayPercentage === undefined ? null : { id: 'ins-1', copayPercentage: String(copayPercentage) };
  const tx = {
    $queryRaw: async () => [],
    invoice: {
      findFirst: async ({ where }) => {
        state.findFirstWheres.push(where);
        const excluded = where.paymentStatus?.notIn || [];
        const rows = state.invoices
          .concat(existingByType.seed || [])
          .filter((row) => row.invoiceType === where.invoiceType)
          .filter((row) => !where.appointmentId || row.appointmentId === where.appointmentId)
          .filter((row) => !excluded.includes(row.paymentStatus))
          .filter((row) => !where.paymentStatus?.not || row.paymentStatus !== where.paymentStatus.not);
        return rows.at(-1) ? { ...rows.at(-1), items: [], insuranceClaim: null } : null;
      },
      create: async ({ data }) => {
        const row = { id: `inv-${state.invoices.length + 1}`, ...data, items: [] };
        delete row.items;
        const stored = { ...row, items: [] };
        state.invoices.push(stored);
        return stored;
      },
      update: async () => ({}),
    },
    patient: { findUnique: async () => ({ id: 'patient-1', status: 'ACTIVE' }) },
    insuranceCompany: { findUnique: async () => company },
    insuranceClaim: { create: async ({ data }) => ({ id: 'claim-1', ...data }) },
    clinicalService: { findMany: async () => [{ id: 'svc-1', status: 'ACTIVE', baseFeeSdg: { equals: (value) => value === '3000' } }] },
    labOrder: {
      updateMany: async ({ where, data }) => {
        if (state.labOrder.id === where.id && state.labOrder.status === where.status) {
          state.labOrder.status = data.status;
          return { count: 1 };
        }
        return { count: 0 };
      },
      findUnique: async () => state.labOrder,
    },
    tenantAuditLog: { create: async ({ data }) => state.audits.push(data) },
  };
  const prisma = {
    $transaction: async (fn) => fn(tx),
    appointment: {
      findUnique: async () => ({
        id: 'appt-1',
        patientId: 'patient-1',
        status: 'CHECKED_IN',
        doctor: { status: 'ACTIVE', consultationFee: 5000, fullNameAr: 'د', fullNameEn: 'D' },
      }),
    },
    labOrder: {
      findUnique: async () => ({
        id: 'lab-1',
        patientId: 'patient-1',
        status: state.labOrder.status,
        medicalRecord: { appointmentId: 'appt-1' },
        items: [
          {
            labReviewStatus: 'NOT_REQUIRED',
            serviceId: 'svc-1',
            service: { id: 'svc-1', category: 'LABORATORY', status: 'ACTIVE', baseFeeSdg: 3000, labelAr: 'ف', labelEn: 'Test' },
          },
        ],
      }),
    },
  };
  return { prisma, state };
}

async function billingService(options) {
  const { BillingService } = await import('../dist/modules/billing/billing.service.js');
  const harness = billingHarness(options);
  return { service: new BillingService(harness.prisma, { emitQueueUpdate: () => {} }), state: harness.state };
}

const actor = { id: 'user-recep', role: 'RECEPTIONIST' };
const consultationBody = { patientId: 'patient-1', appointmentId: 'appt-1', invoiceType: 'CONSULTATION' };

test('consultation invoice with a 0% copay insurer is created PAID, audited, and unlocks the visit', async () => {
  const { service, state } = await billingService({ copayPercentage: 0 });
  const result = await service.createInvoice({ ...consultationBody, insuranceCompanyId: 'ins-1' }, actor, '10.0.0.5');
  assert.equal(result.existing, false);
  assert.equal(result.invoice.paymentStatus, 'PAID');
  assert.equal(result.patientShareSdg, 0);
  assert.equal(result.insuranceCoverageSdg, 5000);
  assert.equal(state.invoices[0].paymentStatus, 'PAID');
  assert.equal(state.audits.length, 1);
  assert.equal(state.audits[0].action, 'INVOICE_SETTLED_ZERO_PATIENT_SHARE');
  assert.equal(state.audits[0].userId, 'user-recep');
  assert.equal(state.audits[0].ipAddress, '10.0.0.5');
  assert.deepEqual(JSON.parse(state.audits[0].details), {
    invoiceId: result.invoice.id,
    invoiceType: 'CONSULTATION',
    grossTotalSdg: 5000,
    insuranceCoverageSdg: 5000,
    patientShareSdg: 0,
  });
  // The appointment gate only looks for a PAID consultation invoice for the appointment.
  assert.equal(state.invoices.some((row) => row.appointmentId === 'appt-1' && row.invoiceType === 'CONSULTATION' && row.paymentStatus === 'PAID'), true);
});

test('laboratory invoice with a zero patient share moves the lab order to PAID', async () => {
  const { service, state } = await billingService({ copayPercentage: 0 });
  const result = await service.createInvoice(
    { patientId: 'patient-1', labOrderId: 'lab-1', invoiceType: 'LABORATORY', insuranceCompanyId: 'ins-1' },
    actor,
    '10.0.0.5',
  );
  assert.equal(result.invoice.paymentStatus, 'PAID');
  assert.equal(state.labOrder.status, 'PAID');
  assert.equal(state.audits[0].action, 'INVOICE_SETTLED_ZERO_PATIENT_SHARE');
});

test('laboratory zero-share invoice tolerates a lab order that is already PAID', async () => {
  const advanced = await billingService({ copayPercentage: 0, labOrderStatus: 'PAID' });
  const result = await advanced.service.createInvoice(
    { patientId: 'patient-1', labOrderId: 'lab-1', invoiceType: 'LABORATORY', insuranceCompanyId: 'ins-1' },
    actor,
    '10.0.0.5',
  );
  assert.equal(result.invoice.paymentStatus, 'PAID');
  assert.equal(advanced.state.labOrder.status, 'PAID');
});

test('a normal invoice with a non-zero patient share is still created UNPAID with no settlement audit', async () => {
  const plain = await billingService({});
  const unpaid = await plain.service.createInvoice(consultationBody, actor, '10.0.0.5');
  assert.equal(unpaid.invoice.paymentStatus, 'UNPAID');
  assert.equal(plain.state.audits.length, 0);

  const partial = await billingService({ copayPercentage: 20 });
  const copay = await partial.service.createInvoice({ ...consultationBody, insuranceCompanyId: 'ins-1' }, actor, '10.0.0.5');
  assert.equal(copay.invoice.paymentStatus, 'UNPAID');
  assert.equal(copay.patientShareSdg, 1000);
  assert.equal(partial.state.audits.length, 0);
});

test('consultation dedupe ignores REFUNDED and VOIDED invoices and prefers the newest', async () => {
  const refunded = {
    id: 'inv-old',
    appointmentId: 'appt-1',
    invoiceType: 'CONSULTATION',
    paymentStatus: 'REFUNDED',
    totalAmountSdg: 5000,
  };
  const { service, state } = await billingService({ existingByType: { seed: [refunded] } });
  const fresh = await service.createInvoice(consultationBody, actor, '10.0.0.5');
  assert.equal(fresh.existing, false);
  assert.notEqual(fresh.invoice.id, 'inv-old');
  assert.equal(fresh.invoice.paymentStatus, 'UNPAID');
  const dedupe = state.findFirstWheres[0];
  assert.deepEqual(dedupe.paymentStatus, { notIn: ['REFUNDED', 'VOIDED'] });

  // A live (non-refunded) invoice is still deduplicated.
  const again = await service.createInvoice(consultationBody, actor, '10.0.0.5');
  assert.equal(again.existing, true);
  assert.equal(again.invoice.id, fresh.invoice.id);
});
