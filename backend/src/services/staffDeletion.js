import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import prisma from '../db.js';

const staffRoles = ['ADMIN', 'RECEPTIONIST', 'DOCTOR', 'PHARMACIST', 'LAB_TECH'];
export class StaffDeletionError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status; }
}
// Status changes and deletion share a lock so administrator counts cannot race.
export const lockStaffAdministration = tx => tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('staff-account-administration')) IS NULL AS locked`;

export async function deleteStaffAccount(req, id) {
  if (id === req.user.id) throw new StaffDeletionError('STAFF_DELETE_SELF', 'You cannot delete your own account.');
  const passwordHash = await bcrypt.hash(randomBytes(48).toString('base64'), Number(process.env.BCRYPT_ROUNDS || 12));
  return prisma.$transaction(async tx => {
    await lockStaffAdministration(tx);
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "role" = 'ADMIN' OR "id" = ${id} OR "id" = ${req.user.id} ORDER BY "id" FOR UPDATE`;
    const target = await tx.user.findUnique({ where: { id }, select: { id: true, username: true, role: true, status: true } });
    if (!target || target.status === 'DELETED') throw new StaffDeletionError('STAFF_USER_NOT_FOUND', 'Staff account was not found.', 404);
    if (!staffRoles.includes(target.role)) throw new StaffDeletionError('STAFF_DELETE_UNSUPPORTED', 'Only staff accounts can be deleted.', 422);
    if (target.role === 'ADMIN') {
      if (target.status === 'ACTIVE' && await tx.user.count({ where: { role: 'ADMIN', status: 'ACTIVE' } }) <= 1) throw new StaffDeletionError('STAFF_LAST_ACTIVE_ADMIN', 'The last active administrator cannot be deleted.');
      const primary = await tx.user.findFirst({ where: { role: 'ADMIN' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } });
      if (primary?.id === id) throw new StaffDeletionError('STAFF_PROTECTED_ADMIN', 'The primary administrator cannot be deleted.');
    }
    const actor = await tx.user.findUnique({ where: { id: req.user.id }, select: { id: true, role: true, status: true, authVersion: true } });
    if (!actor || actor.role !== 'ADMIN' || actor.status !== 'ACTIVE' || actor.authVersion !== req.user.av) throw new StaffDeletionError('STAFF_DELETE_ACTOR_CHANGED', 'Your account permissions changed. Sign in again.', 403);
    const doctor = await tx.doctor.findUnique({ where: { userId: id }, select: { id: true, weeklySchedule: true } });
    if (doctor) await tx.$queryRaw`SELECT "id" FROM "Doctor" WHERE "id" = ${doctor.id} FOR UPDATE`;
    const historyChecks = [
      tx.patient.count({ where: { userId: id } }),
      tx.patientRegistration.count({ where: { userId: id } }),
      tx.patientClaimCode.count({ where: { createdById: id } }),
      tx.stockMovement.count({ where: { actorUserId: id } }),
      tx.refund.count({ where: { processedBy: id } }),
      tx.invoice.count({ where: { createdBy: id } }),
      tx.payment.count({ where: { receivedBy: id } }),
      tx.paymentOperation.count({ where: { receivedBy: id } }),
      tx.emergencyOverride.count({ where: { authorizedById: id } }),
      tx.notification.count({ where: { userId: id } }),
      tx.tenantAuditLog.count({ where: { OR: [{ userId: id }, { details: { contains: id } }] } })
    ];
    if (doctor) {
      for (const model of ['appointment', 'medicalRecord', 'prescription', 'labOrder', 'doctorSchedule', 'doctorScheduleException']) historyChecks.push(tx[model].count({ where: { doctorId: doctor.id } }));
      // Legacy working hours are configuration that must not be removed silently.
      if (doctor.weeklySchedule !== '[]') {
        try { const legacy = JSON.parse(doctor.weeklySchedule); if (!Array.isArray(legacy) || legacy.length) historyChecks.push(Promise.resolve(1)); }
        catch { historyChecks.push(Promise.resolve(1)); }
      }
    }
    if ((await Promise.all(historyChecks)).some(Boolean)) throw new StaffDeletionError('STAFF_HAS_HISTORY', 'This account cannot be permanently deleted because it is linked to historical records. Disable it instead.');

    // Preserve the UUID: some historical actor columns have no foreign keys and
    // an already-authorized request can still finish after this transaction.
    // This irreversible tombstone erases login identities without cascading data.
    await tx.user.update({ where: { id }, data: {
      username: `deleted-${id}`, email: null, phoneNormalized: null,
      emailVerifiedAt: null, phoneVerifiedAt: null, passwordHash,
      status: 'DELETED', authVersion: { increment: 1 }, mustChangePassword: false,
      mfaSecret: null, mfaEnabled: false
    } });
    for (const model of ['mfaConfiguration', 'mfaRecoveryCode', 'mfaChallenge', 'verificationChallenge', 'userExternalIdentity']) await tx[model].deleteMany({ where: { userId: id } });
    if (doctor) await tx.doctor.update({ where: { id: doctor.id }, data: { status: 'INACTIVE' } });
    await tx.tenantAuditLog.create({ data: {
      userId: actor.id, action: 'STAFF_ACCOUNT_DELETED',
      details: JSON.stringify({ targetUserId: id, username: target.username, role: target.role, policy: 'IRREVERSIBLE_TOMBSTONE' }), ipAddress: req.ip || 'unknown'
    } });
  }, { timeout: 15000 });
}
