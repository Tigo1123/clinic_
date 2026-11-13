import {
  Injectable,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { createRequire } from 'node:module';
import { PrismaService } from '../../database/prisma.service.js';
import { lockDoctorLifecycle, synchronizeDoctorAccount } from '../../services/doctorLifecycle.js';
import { usdFromSdg, subtractMoney } from '../../common/utils/money.js';

const require = createRequire(import.meta.url);
const { clinicMonthBounds, clinicDateSequence, clinicDayBounds } = require('../../utils/clinicTime.js');
const { consumeTotp } = require('../../services/mfa.js');
const { ensurePharmacyInvoiceInTransaction } = require('../../services/pharmacyInvoice.js');
const { logger } = require('../../utils/logger.js');

export const STAFF_ROLES = ['ADMIN', 'RECEPTIONIST', 'DOCTOR', 'PHARMACIST', 'LAB_TECH'];
const bcryptRounds = 12;

function isUsernameUniqueViolation(error: any): boolean {
  if (error?.code !== 'P2002') return false;

  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.length === 1 && String(target[0]).toLowerCase() === 'username';
  }
  if (typeof target !== 'string') return false;

  const normalizedTarget = target.replace(/["'`\s]/g, '').toLowerCase();
  return normalizedTarget === 'username'
    || normalizedTarget === 'user_username_key'
    || normalizedTarget.endsWith('.user_username_key');
}

const AUDIT_TARGET_FIELDS: ReadonlyArray<readonly [string, string]> = Object.freeze([
  ['patientId', 'PATIENT'], ['appointmentId', 'APPOINTMENT'], ['doctorId', 'DOCTOR'],
  ['labOrderId', 'LAB_ORDER'], ['labOrderItemId', 'LAB_ORDER_ITEM'], ['invoiceId', 'INVOICE'],
  ['prescriptionId', 'PRESCRIPTION'], ['drugId', 'MEDICINE'], ['batchId', 'INVENTORY_BATCH'],
  ['userId', 'USER'], ['entityId', 'ENTITY'],
]);

function safeStructuredAuditDetails(details: string | null): { summary: any; target: { type: string; id: any } | null } {
  try {
    const value: any = JSON.parse(details as string);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { summary: details, target: null };
    const targetEntry = AUDIT_TARGET_FIELDS.find(([field]) => typeof value[field] === 'string');
    const targetFields = new Set(AUDIT_TARGET_FIELDS.map(([field]) => field));
    const safeValues = Object.fromEntries(Object.entries(value).filter(([key, item]) =>
      !targetFields.has(key)
      && !/(password|hash|secret|token|otp|recovery|clinicalNotes|diagnosis|treatment|symptoms)/i.test(key)
      && ['string', 'number', 'boolean'].includes(typeof item),
    ));
    return {
      summary: JSON.stringify(safeValues),
      target: targetEntry ? { type: targetEntry[1], id: value[targetEntry[0]] } : null,
    };
  } catch {
    const containsSensitiveMaterial = /(password(?:Hash)?|mfaSecret|recoveryCode|accessToken|refreshToken|Bearer\s+[A-Za-z0-9._-]+|eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/i.test(String(details));
    return { summary: containsSensitiveMaterial ? '[Sensitive audit detail redacted]' : details, target: null };
  }
}

function auditDetails(
  resourceType: string,
  resourceId: string,
  previousPriceSdg: any,
  newPriceSdg: any,
  previousStatus: any,
  newStatus: any,
) {
  return JSON.stringify({
    resourceType,
    resourceId,
    previousPriceSdg,
    newPriceSdg,
    previousStatus,
    newStatus,
  });
}

const normalizeEmail = (val: string) => (val || '').trim().toLowerCase();

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  // ===================== PRICING =====================

  async getPricing() {
    try {
      const [doctors, services, medicines] = await Promise.all([
        this.prisma.doctor.findMany({
          select: {
            id: true,
            fullNameAr: true,
            fullNameEn: true,
            specialtyAr: true,
            specialtyEn: true,
            consultationFee: true,
            status: true,
            updatedAt: true,
            user: { select: { status: true } },
          },
          orderBy: { fullNameEn: 'asc' },
        }),
        this.prisma.clinicalService.findMany({
          select: {
            id: true,
            labelAr: true,
            labelEn: true,
            category: true,
            baseFeeSdg: true,
            status: true,
            updatedAt: true,
          },
          orderBy: [{ category: 'asc' }, { labelEn: 'asc' }],
        }),
        this.prisma.drugFormulary.findMany({
          select: {
            id: true,
            labelAr: true,
            labelEn: true,
            genericName: true,
            strength: true,
            dosageForm: true,
            unitPriceSdg: true,
            status: true,
            updatedAt: true,
          },
          orderBy: { labelEn: 'asc' },
        }),
      ]);

      return {
        doctors: doctors.map(({ user, ...doctor }: any) => ({
          ...doctor,
          status:
            doctor.status === 'ACTIVE' && user?.status === 'ACTIVE'
              ? 'ACTIVE'
              : 'INACTIVE',
        })),
        services,
        medicines,
      };
    } catch (error) {
      throw new HttpException(
        {
          code: 'PRICING_CATALOGUE_FAILED',
          message: 'Failed to retrieve clinic pricing.',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async updateDoctorPrice(id: string, body: { priceSdg: number; status?: 'ACTIVE' | 'INACTIVE' }, userId: string, ip?: string) {
    try {
      const doctor = await this.prisma.$transaction(async (tx: any) => {
        await lockDoctorLifecycle(tx, id);
        const existing = await tx.doctor.findUnique({ where: { id } });
        if (!existing) {
          throw new HttpException(
            { code: 'DOCTOR_NOT_FOUND', message: 'Doctor not found.' },
            HttpStatus.NOT_FOUND,
          );
        }
        if (body.status) {
          await synchronizeDoctorAccount(tx, existing.userId, body.status);
        }
        const updated = await tx.doctor.update({
          where: { id: existing.id },
          data: {
            consultationFee: body.priceSdg,
            ...(body.status && { status: body.status }),
          },
        });
        await tx.tenantAuditLog.create({
          data: {
            userId,
            action: 'DOCTOR_CONSULTATION_PRICE_UPDATED',
            details: auditDetails(
              'DOCTOR',
              existing.id,
              Number(existing.consultationFee),
              body.priceSdg,
              existing.status,
              updated.status,
            ),
            ipAddress: ip || 'unknown',
          },
        });
        return updated;
      });

      return { ...doctor, consultationFee: Number(doctor.consultationFee) };
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      if (error.status && error.code) {
        throw new HttpException({ code: error.code, message: error.message }, error.status);
      }
      throw new HttpException(
        {
          code: 'DOCTOR_PRICE_UPDATE_FAILED',
          message: 'Failed to update consultation pricing.',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async updateServicePrice(id: string, body: { priceSdg: number; status?: 'ACTIVE' | 'INACTIVE' }, userId: string, ip?: string) {
    try {
      const service = await this.prisma.$transaction(async (tx: any) => {
        await tx.$queryRaw`SELECT "id" FROM "ClinicalService" WHERE "id" = ${id} FOR UPDATE`;
        const existing = await tx.clinicalService.findUnique({ where: { id } });
        if (!existing) {
          throw new HttpException(
            { code: 'SERVICE_NOT_FOUND', message: 'Clinical service not found.' },
            HttpStatus.NOT_FOUND,
          );
        }
        const updated = await tx.clinicalService.update({
          where: { id: existing.id },
          data: {
            baseFeeSdg: body.priceSdg,
            baseFeeUsd: usdFromSdg(body.priceSdg),
            ...(body.status && { status: body.status }),
          },
        });
        await tx.tenantAuditLog.create({
          data: {
            userId,
            action: 'CLINICAL_SERVICE_PRICE_UPDATED',
            details: auditDetails(
              'CLINICAL_SERVICE',
              existing.id,
              existing.baseFeeSdg == null ? null : Number(existing.baseFeeSdg),
              body.priceSdg,
              existing.status,
              updated.status,
            ),
            ipAddress: ip || 'unknown',
          },
        });
        return updated;
      });

      return {
        ...service,
        baseFeeSdg: Number(service.baseFeeSdg),
        baseFeeUsd: Number(service.baseFeeUsd),
      };
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      if (error.status && error.code) {
        throw new HttpException({ code: error.code, message: error.message }, error.status);
      }
      throw new HttpException(
        {
          code: 'SERVICE_PRICE_UPDATE_FAILED',
          message: 'Failed to update clinical service pricing.',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async updateMedicinePrice(id: string, body: { priceSdg: number; status?: 'ACTIVE' | 'INACTIVE' }, userId: string, ip?: string) {
    try {
      const medicine = await this.prisma.$transaction(async (tx: any) => {
        await tx.$queryRaw`SELECT "id" FROM "DrugFormulary" WHERE "id" = ${id} FOR UPDATE`;
        const existing = await tx.drugFormulary.findUnique({ where: { id } });
        if (!existing) {
          throw new HttpException(
            { code: 'MEDICINE_NOT_FOUND', message: 'Medicine not found.' },
            HttpStatus.NOT_FOUND,
          );
        }
        const updated = await tx.drugFormulary.update({
          where: { id: existing.id },
          data: {
            unitPriceSdg: body.priceSdg,
            ...(body.status && { status: body.status }),
          },
        });
        await tx.tenantAuditLog.create({
          data: {
            userId,
            action: 'MEDICINE_SELLING_PRICE_UPDATED',
            details: auditDetails(
              'MEDICINE',
              existing.id,
              existing.unitPriceSdg == null ? null : Number(existing.unitPriceSdg),
              body.priceSdg,
              existing.status,
              updated.status,
            ),
            ipAddress: ip || 'unknown',
          },
        });

        if (updated.status === 'ACTIVE') {
          const affectedPrescriptions = await tx.prescribedDrug.findMany({
            where: {
              drugId: updated.id,
              prescription: {
                status: { in: ['ACTIVE', 'PARTIALLY_FILLED'] },
                invoices: {
                  none: {
                    invoiceType: 'PHARMACY',
                    paymentStatus: { notIn: ['REFUNDED', 'VOIDED'] },
                  },
                },
              },
            },
            select: { prescriptionId: true },
            distinct: ['prescriptionId'],
            orderBy: { prescriptionId: 'asc' },
            take: 101,
          });

          if (affectedPrescriptions.length > 100) {
            throw new HttpException(
              {
                code: 'PHARMACY_REEVALUATION_LIMIT_EXCEEDED',
                message: 'Too many pending prescriptions require pharmacy billing review.',
              },
              HttpStatus.CONFLICT,
            );
          }

          for (const { prescriptionId } of affectedPrescriptions) {
            await ensurePharmacyInvoiceInTransaction(tx, {
              prescriptionId,
              actorUserId: userId,
              ipAddress: ip || 'unknown',
              trigger: 'MEDICINE_PRICED_AND_ACTIVATED',
            });
          }
        }

        return updated;
      });

      return { ...medicine, unitPriceSdg: Number(medicine.unitPriceSdg) };
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      if (error.status && error.code) {
        throw new HttpException({ code: error.code, message: error.message }, error.status);
      }
      throw new HttpException(
        {
          code: 'MEDICINE_PRICE_UPDATE_FAILED',
          message: 'Failed to update medicine pricing.',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ===================== ANALYTICS =====================

  async getAnalytics() {
    try {
      const totalPatients = await this.prisma.patient.count();

      const now = new Date();
      const { start: startOfMonth, end: startOfNextMonth } = clinicMonthBounds(now);
      const monthlyVisits = await this.prisma.medicalRecord.count({
        where: {
          visitDate: {
            gte: startOfMonth,
            lt: startOfNextMonth,
          },
        },
      });

      const totalAppointments = await this.prisma.appointment.count();

      const statusCountsRaw = await this.prisma.appointment.groupBy({
        by: ['status'],
        _count: { status: true },
      });

      const statusMap: Record<string, number> = {
        PENDING: 0,
        SCHEDULED: 0,
        CONFIRMED: 0,
        CHECKED_IN: 0,
        IN_CONSULTATION: 0,
        WAITING_LAB: 0,
        COMPLETED: 0,
        CANCELLED: 0,
        NO_SHOW: 0,
      };

      statusCountsRaw.forEach((item: any) => {
        if (statusMap[item.status] !== undefined) {
          statusMap[item.status] = item._count.status;
        }
      });

      const completedVisits = statusMap.COMPLETED;
      const waitingVisits =
        statusMap.PENDING +
        statusMap.SCHEDULED +
        statusMap.CONFIRMED +
        statusMap.CHECKED_IN +
        statusMap.IN_CONSULTATION +
        statusMap.WAITING_LAB;
      const completionRate =
        totalAppointments > 0 ? Math.round((completedVisits / totalAppointments) * 100) : 0;

      const doctorVolumeRaw = await this.prisma.medicalRecord.groupBy({
        by: ['doctorId'],
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 50,
      });

      const doctors = await this.prisma.doctor.findMany({
        where: { id: { in: doctorVolumeRaw.map(({ doctorId }: any) => doctorId) } },
        select: {
          id: true,
          fullNameAr: true,
          fullNameEn: true,
          specialtyAr: true,
          specialtyEn: true,
        },
      });

      const doctorMap = new Map();
      doctors.forEach((d: any) => doctorMap.set(d.id, d));

      const doctorVisits = doctorVolumeRaw.map((dv: any) => {
        const doc = doctorMap.get(dv.doctorId) || {
          fullNameAr: 'طبيب غير محدد',
          fullNameEn: 'Unknown Doctor',
          specialtyAr: 'عام',
          specialtyEn: 'General',
        };
        return {
          doctorId: dv.doctorId,
          fullNameAr: doc.fullNameAr,
          fullNameEn: doc.fullNameEn,
          specialtyAr: doc.specialtyAr,
          specialtyEn: doc.specialtyEn,
          visitsCount: dv._count.id,
        };
      });

      const totalInvoices = await this.prisma.invoice.count();
      const [paymentTotals, refundTotals] = await Promise.all([
        this.prisma.payment.aggregate({ _sum: { amountSdg: true } }),
        this.prisma.refund.aggregate({ _sum: { amountSdg: true } }),
      ]);
      const totalRevenueSdg = subtractMoney(
        paymentTotals._sum.amountSdg || 0,
        refundTotals._sum.amountSdg || 0,
      );

      const trendDays = clinicDateSequence(7, now);
      const trendCounts = await this.prisma.appointment.groupBy({
        by: ['appointmentDate'],
        where: { appointmentDate: { gte: trendDays[0], lte: trendDays[6] } },
        _count: { id: true },
      });
      const trendMap = new Map(trendCounts.map((item: any) => [item.appointmentDate, item._count.id]));
      const appointmentTrend = trendDays.map((date: string) => ({
        date,
        count: trendMap.get(date) || 0,
      }));

      return {
        totalPatients,
        monthlyVisits,
        totalAppointments,
        completionRate,
        statusBreakdown: {
          completed: statusMap.COMPLETED,
          inConsultation: statusMap.IN_CONSULTATION,
          waiting: statusMap.CHECKED_IN,
          confirmed: statusMap.CONFIRMED,
          pending: statusMap.PENDING,
          scheduled: statusMap.SCHEDULED,
          waitingLab: statusMap.WAITING_LAB,
          cancelled: statusMap.CANCELLED,
          noShow: statusMap.NO_SHOW,
          totalActiveQueue: waitingVisits,
        },
        appointmentStatuses: statusCountsRaw.map((item: any) => ({
          status: item.status,
          count: item._count.status,
        })),
        doctorVisits,
        appointmentTrend,
        financials: {
          totalInvoices,
          totalRevenueSdg,
        },
      };
    } catch (error) {
      throw new HttpException(
        { error: 'Failed to compute administrative analytics.' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ===================== STAFF USER MANAGEMENT =====================

  async listStaffUsers() {
    return this.prisma.user.findMany({
      where: { role: { in: STAFF_ROLES } },
      select: {
        id: true,
        username: true,
        role: true,
        status: true,
        preferredLanguage: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createStaffUser(body: any, actorUserId: string, ip?: string) {
    const username = normalizeEmail(body.username);
    const { password, role, preferredLanguage } = body;

    if (!username || !password || !role) {
      throw new HttpException(
        {
          code: 'BAD_REQUEST',
          message: 'Username, password, and role are required.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (role === 'DOCTOR' && (body.consultationFee == null || !body.specialtyId)) {
      throw new HttpException(
        {
          code: 'DOCTOR_CONFIGURATION_REQUIRED',
          message: 'A consultation fee and active specialty are required for a doctor account.',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    try {
      const existing = await this.prisma.user.findFirst({
        where: { username: { equals: username, mode: 'insensitive' } },
      });
      if (existing) {
        throw new HttpException(
          {
            code: 'USERNAME_ALREADY_REGISTERED',
            message: 'Username is already registered.',
          },
          HttpStatus.CONFLICT,
        );
      }

      const passwordHash = await bcrypt.hash(password, bcryptRounds);

      const newUser = await this.prisma.$transaction(async (tx: any) => {
        const createdUser = await tx.user.create({
          data: {
            username,
            passwordHash,
            role,
            preferredLanguage: preferredLanguage || 'ar',
            status: 'ACTIVE',
            mustChangePassword: true,
          },
        });

        if (role === 'DOCTOR') {
          const specialty = await tx.specialty.findFirst({
            where: { id: body.specialtyId, active: true },
          });
          if (!specialty) {
            throw new HttpException(
              {
                code: 'SPECIALTY_INACTIVE_OR_NOT_FOUND',
                message: 'The selected specialty is not available.',
              },
              HttpStatus.UNPROCESSABLE_ENTITY,
            );
          }

          await tx.doctor.create({
            data: {
              userId: createdUser.id,
              fullNameAr: body.fullNameAr || `د. ${username.split('@')[0]}`,
              fullNameEn: body.fullNameEn || `Dr. ${username.split('@')[0]}`,
              specialtyId: specialty.id,
              specialtyAr: specialty.nameAr,
              specialtyEn: specialty.nameEn,
              consultationFee: body.consultationFee,
              weeklySchedule: '[]',
              status: 'ACTIVE',
            },
          });
        }

        await tx.tenantAuditLog.create({
          data: {
            userId: actorUserId,
            action: 'USER_CREATION',
            details: `Created new staff user: ${username} with role ${role}`,
            ipAddress: ip || '127.0.0.1',
          },
        });

        return createdUser;
      });

      return {
        success: true,
        message: 'Staff user created successfully.',
        user: {
          id: newUser.id,
          username: newUser.username,
          role: newUser.role,
          status: newUser.status,
          mustChangePassword: newUser.mustChangePassword,
        },
      };
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      if (isUsernameUniqueViolation(error)) {
        throw new HttpException(
          {
            code: 'USERNAME_ALREADY_REGISTERED',
            message: 'Username is already registered.',
          },
          HttpStatus.CONFLICT,
        );
      }
      logger.error('auth.staff_creation_failed', { error });
      throw new HttpException(
        {
          code: 'STAFF_CREATION_FAILED',
          message: 'Failed to create staff user.',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async resetStaffPassword(
    targetId: string,
    body: any,
    actorUserId: string,
    actorAuthVersion: number,
    ip?: string,
  ) {
    if (targetId === actorUserId) {
      throw new HttpException(
        {
          code: 'ADMIN_SELF_RESET_UNSUPPORTED',
          message: 'Use the dedicated administrator recovery process to reset your own password.',
        },
        HttpStatus.CONFLICT,
      );
    }

    try {
      const actor = await this.prisma.user.findUnique({
        where: { id: actorUserId },
        select: {
          id: true,
          role: true,
          status: true,
          authVersion: true,
          passwordHash: true,
          mfaEnabled: true,
          mfaConfiguration: { select: { state: true, updatedAt: true } },
        },
      });

      if (
        !actor ||
        actor.role !== 'ADMIN' ||
        actor.status !== 'ACTIVE' ||
        actor.authVersion !== actorAuthVersion
      ) {
        throw this.reauthenticationFailed();
      }

      if (!(await bcrypt.compare(body.currentAdminPassword, actor.passwordHash))) {
        throw this.reauthenticationFailed();
      }

      const hasActiveMfa = actor.mfaEnabled && actor.mfaConfiguration?.state === 'ACTIVE';
      const hasInconsistentMfaState =
        actor.mfaEnabled !== (actor.mfaConfiguration?.state === 'ACTIVE');
      if (hasInconsistentMfaState) {
        throw new HttpException(
          {
            code: 'MFA_CONFIGURATION_INVALID',
            message: 'Multi-factor authentication is unavailable for this administrator account.',
          },
          HttpStatus.FORBIDDEN,
        );
      }

      if (hasActiveMfa && (!body.mfaCode || !(await consumeTotp(actor.id, body.mfaCode)))) {
        throw this.reauthenticationFailed();
      }

      const reauthenticatedSecurityState = await this.prisma.user.findUnique({
        where: { id: actor.id },
        select: {
          mfaEnabled: true,
          mfaConfiguration: { select: { state: true, updatedAt: true } },
        },
      });
      if (
        !reauthenticatedSecurityState ||
        reauthenticatedSecurityState.mfaEnabled !== actor.mfaEnabled ||
        reauthenticatedSecurityState.mfaConfiguration?.state !== actor.mfaConfiguration?.state ||
        (!hasActiveMfa &&
          reauthenticatedSecurityState.mfaConfiguration?.updatedAt?.getTime() !==
            actor.mfaConfiguration?.updatedAt?.getTime())
      ) {
        throw this.reauthenticationFailed();
      }

      const target = await this.prisma.user.findUnique({
        where: { id: targetId },
        select: { id: true, username: true, role: true, status: true, authVersion: true },
      });
      if (!target) {
        throw new HttpException(
          {
            code: 'STAFF_USER_NOT_FOUND',
            message: 'Staff user was not found.',
          },
          HttpStatus.NOT_FOUND,
        );
      }
      if (!STAFF_ROLES.includes(target.role)) {
        throw new HttpException(
          {
            code: 'STAFF_PASSWORD_RESET_UNSUPPORTED',
            message: 'Password reset through this endpoint is limited to staff accounts.',
          },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      const passwordHash = await bcrypt.hash(body.newPassword, bcryptRounds);
      const changedAt = new Date();

      const updated = await this.prisma.$transaction(async (tx: any) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" IN (${actor.id}, ${target.id}) ORDER BY "id" FOR UPDATE`;
        const currentActor = await tx.user.findUnique({
          where: { id: actor.id },
          select: {
            role: true,
            status: true,
            authVersion: true,
            mfaEnabled: true,
            mfaConfiguration: { select: { state: true, updatedAt: true } },
          },
        });
        const currentTarget = await tx.user.findUnique({
          where: { id: target.id },
          select: { role: true, authVersion: true },
        });
        if (
          !currentActor ||
          currentActor.role !== 'ADMIN' ||
          currentActor.status !== 'ACTIVE' ||
          currentActor.authVersion !== actor.authVersion ||
          currentActor.mfaEnabled !== reauthenticatedSecurityState.mfaEnabled ||
          currentActor.mfaConfiguration?.state !== reauthenticatedSecurityState.mfaConfiguration?.state ||
          currentActor.mfaConfiguration?.updatedAt?.getTime() !==
            reauthenticatedSecurityState.mfaConfiguration?.updatedAt?.getTime()
        ) {
          throw new Error('ADMIN_REAUTHENTICATION_STATE_CHANGED');
        }
        if (
          !currentTarget ||
          !STAFF_ROLES.includes(currentTarget.role) ||
          currentTarget.role !== target.role ||
          currentTarget.authVersion !== target.authVersion
        ) {
          throw new Error('STAFF_RESET_TARGET_STATE_CHANGED');
        }

        const resetUser = await tx.user.update({
          where: { id: target.id },
          data: {
            passwordHash,
            lastPasswordChange: changedAt,
            mustChangePassword: true,
            authVersion: { increment: 1 },
          },
          select: { id: true, username: true, role: true, status: true },
        });

        await tx.tenantAuditLog.create({
          data: {
            userId: actor.id,
            action: 'STAFF_PASSWORD_RESET_BY_ADMIN',
            details: `Administrator reset credentials for staff user ${target.id} with role ${currentTarget.role}.`,
            ipAddress: ip || 'unknown',
          },
        });

        return resetUser;
      });

      logger.security('auth.staff_password_reset', {
        actorUserId: actor.id,
        targetUserId: updated.id,
        targetRole: updated.role,
        ip,
      });
      return { success: true, user: updated };
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      if (error?.message === 'ADMIN_REAUTHENTICATION_STATE_CHANGED') {
        throw this.reauthenticationFailed();
      }
      if (error?.message === 'STAFF_RESET_TARGET_STATE_CHANGED') {
        throw new HttpException(
          {
            code: 'STAFF_PASSWORD_RESET_CONFLICT',
            message: 'Staff account changed during password reset. Please retry.',
          },
          HttpStatus.CONFLICT,
        );
      }
      logger.error('auth.staff_password_reset_failed', { error });
      throw new HttpException(
        {
          code: 'STAFF_PASSWORD_RESET_FAILED',
          message: 'Failed to reset staff password.',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private reauthenticationFailed() {
    return new HttpException(
      {
        code: 'ADMIN_REAUTHENTICATION_FAILED',
        message: 'Administrator reauthentication failed.',
      },
      HttpStatus.UNAUTHORIZED,
    );
  }

  async revokeStaffSessions(targetId: string, actorUserId: string, ip?: string) {
    if (targetId === actorUserId) {
      throw new HttpException(
        {
          code: 'ADMIN_SELF_SESSION_REVOCATION_UNSUPPORTED',
          message: 'Use logout to sign out your own sessions.',
        },
        HttpStatus.CONFLICT,
      );
    }

    const updated = await this.prisma.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${targetId} FOR UPDATE`;
      const target = await tx.user.findUnique({
        where: { id: targetId },
        select: { id: true, username: true, role: true, status: true, authVersion: true },
      });
      if (!target) {
        throw new HttpException(
          { code: 'USER_NOT_FOUND', message: 'User was not found.' },
          HttpStatus.NOT_FOUND,
        );
      }
      if (target.status !== 'ACTIVE') {
        throw new HttpException(
          {
            code: 'USER_SESSION_REVOCATION_NOT_APPLICABLE',
            message: 'Inactive accounts do not have active sessions to revoke.',
          },
          HttpStatus.CONFLICT,
        );
      }

      const revoked = await tx.user.update({
        where: { id: target.id },
        data: { authVersion: { increment: 1 } },
        select: { id: true, username: true, role: true, status: true, authVersion: true },
      });

      await tx.tenantAuditLog.create({
        data: {
          userId: actorUserId,
          action: 'USER_SESSIONS_REVOKED_BY_ADMIN',
          details: JSON.stringify({
            userId: target.id,
            targetRole: target.role,
            previousAuthVersion: target.authVersion,
            authVersion: revoked.authVersion,
          }),
          ipAddress: ip || 'unknown',
        },
      });

      return revoked;
    });

    logger.security('auth.user_sessions_revoked_by_admin', {
      actorUserId,
      targetUserId: updated.id,
      targetRole: updated.role,
      ip,
    });
    return { success: true, user: updated };
  }

  /**
   * Express parity: any failure other than the unsupported-role 422 (including
   * a missing target) reaches the caller as a plain Error; the controller maps
   * it to the legacy `{ error: string }` 500 body.
   */
  async toggleStaffStatus(
    targetId: string,
    status: 'ACTIVE' | 'INACTIVE',
    actorUserId: string,
    ip?: string,
  ) {
    return this.prisma.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${targetId} FOR UPDATE`;
      const current = await tx.user.findUnique({
        where: { id: targetId },
        select: {
          id: true,
          username: true,
          role: true,
          status: true,
          preferredLanguage: true,
          createdAt: true,
        },
      });
      if (!current) {
        throw new Error('STAFF_STATUS_TARGET_NOT_FOUND');
      }
      if (!STAFF_ROLES.includes(current.role)) {
        throw new HttpException(
          {
            code: 'STAFF_STATUS_UNSUPPORTED',
            message: 'Status management through this endpoint is limited to staff accounts.',
          },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      let doctorStateChanged = false;
      if (current.role === 'DOCTOR') {
        const doctor = await tx.doctor.findUnique({
          where: { userId: current.id },
          select: { id: true, status: true },
        });
        if (doctor) {
          await tx.$queryRaw`SELECT "id" FROM "Doctor" WHERE "id" = ${doctor.id} FOR UPDATE`;
          doctorStateChanged = doctor.status !== status;
          await tx.doctor.update({ where: { id: doctor.id }, data: { status } });
        }
      }

      if (current.status === status) {
        if (doctorStateChanged) {
          await tx.tenantAuditLog.create({
            data: {
              userId: actorUserId,
              action: 'DOCTOR_ACCOUNT_STATUS_SYNCHRONIZED',
              details: JSON.stringify({ userId: current.id, status }),
              ipAddress: ip || 'unknown',
            },
          });
        }
        return current;
      }

      const transitioned = await tx.user.update({
        where: { id: current.id },
        data: { status, authVersion: { increment: 1 } },
        select: {
          id: true,
          username: true,
          role: true,
          status: true,
          preferredLanguage: true,
          createdAt: true,
        },
      });

      await tx.tenantAuditLog.create({
        data: {
          userId: actorUserId,
          action: 'USER_STATUS_CHANGE',
          details: `Changed status of user ${transitioned.username} to ${status}`,
          ipAddress: ip || '127.0.0.1',
        },
      });

      return transitioned;
    });
  }

  // ===================== AUDIT LOGS =====================

  async listAuditLogs(query: {
    search: string;
    action?: string;
    role?: string;
    from?: string;
    to?: string;
    page: number;
    pageSize: number;
  }) {
    const { search, action, role, from, to, page, pageSize } = query;
    const actorWhere: any = {
      ...(role ? { role } : {}),
      ...(search
        ? {
            OR: [
              { username: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              {
                doctor: {
                  is: {
                    OR: [
                      { fullNameAr: { contains: search, mode: 'insensitive' } },
                      { fullNameEn: { contains: search, mode: 'insensitive' } },
                    ],
                  },
                },
              },
              {
                patient: {
                  is: {
                    OR: [
                      { fullNameAr: { contains: search, mode: 'insensitive' } },
                      { fullNameEn: { contains: search, mode: 'insensitive' } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };
    const filterActors = Boolean(role || search);
    const actorIds: string[] = filterActors
      ? (await this.prisma.user.findMany({ where: actorWhere, select: { id: true } })).map(
          ({ id }: { id: string }) => id,
        )
      : [];
    const timestamp: any = {
      ...(from ? { gte: clinicDayBounds(from).start } : {}),
      ...(to ? { lt: clinicDayBounds(to).end } : {}),
    };
    const where: any = {
      ...(action ? { action } : {}),
      ...(filterActors ? { userId: { in: actorIds } } : {}),
      ...(from || to ? { timestamp } : {}),
    };
    const [total, logs] = await this.prisma.$transaction([
      this.prisma.tenantAuditLog.count({ where }),
      this.prisma.tenantAuditLog.findMany({
        where,
        select: { id: true, userId: true, action: true, details: true, ipAddress: true, timestamp: true },
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const users: any[] = logs.length
      ? await this.prisma.user.findMany({
          where: {
            id: { in: [...new Set(logs.map((log: any) => log.userId).filter(Boolean))] as string[] },
          },
          select: {
            id: true,
            username: true,
            email: true,
            role: true,
            doctor: { select: { fullNameAr: true, fullNameEn: true } },
            patient: { select: { fullNameAr: true, fullNameEn: true } },
          },
        })
      : [];
    const usersById = new Map<string, any>(users.map((user: any) => [user.id, user]));
    const actions = await this.prisma.tenantAuditLog.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
      take: 200,
    });

    return {
      items: logs.map((log: any) => {
        const actor = usersById.get(log.userId);
        const safeDetails = safeStructuredAuditDetails(log.details);
        return {
          id: log.id,
          action: log.action,
          details: safeDetails.summary,
          target: safeDetails.target,
          ipAddress: log.ipAddress,
          timestamp: log.timestamp,
          actor: actor
            ? {
                id: actor.id,
                username: actor.username,
                email: actor.email,
                role: actor.role,
                displayNameAr: actor.doctor?.fullNameAr || actor.patient?.fullNameAr || null,
                displayNameEn: actor.doctor?.fullNameEn || actor.patient?.fullNameEn || null,
              }
            : null,
        };
      }),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      filters: { actions },
    };
  }
}
