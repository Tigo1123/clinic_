import express from 'express';
import prisma from '../db.js';
import { authenticate, checkRoles } from '../middleware/auth.js';
import { clinicDateSequence, clinicMonthBounds } from '../utils/clinicTime.js';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { sendError } from '../utils/apiError.js';

const router = express.Router();
const MAX_MONEY_SDG = 1_000_000_000;
const priceUpdateSchema = z.object({
  priceSdg: z.number().int().positive().max(MAX_MONEY_SDG),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional()
}).strict();

function auditDetails(resourceType, resourceId, previousPriceSdg, newPriceSdg, previousStatus, newStatus) {
  return JSON.stringify({
    resourceType,
    resourceId,
    previousPriceSdg,
    newPriceSdg,
    previousStatus,
    newStatus
  });
}

router.get('/pricing', authenticate, checkRoles('ADMIN'), async (req, res) => {
  try {
    const [doctors, services, medicines] = await Promise.all([
      prisma.doctor.findMany({
        select: {
          id: true, fullNameAr: true, fullNameEn: true, specialtyAr: true,
          specialtyEn: true, consultationFee: true, status: true, updatedAt: true
        },
        orderBy: { fullNameEn: 'asc' }
      }),
      prisma.clinicalService.findMany({
        select: {
          id: true, labelAr: true, labelEn: true, category: true,
          baseFeeSdg: true, status: true, updatedAt: true
        },
        orderBy: [{ category: 'asc' }, { labelEn: 'asc' }]
      }),
      prisma.drugFormulary.findMany({
        select: {
          id: true, labelAr: true, labelEn: true, genericName: true,
          strength: true, dosageForm: true, unitPriceSdg: true, status: true, updatedAt: true
        },
        orderBy: { labelEn: 'asc' }
      })
    ]);
    return res.json({ doctors, services, medicines });
  } catch (error) {
    console.error('Pricing catalogue fetch error:', error);
    return sendError(res, 500, 'PRICING_CATALOGUE_FAILED', 'Failed to retrieve clinic pricing.');
  }
});

router.patch('/pricing/doctors/:id', authenticate, checkRoles('ADMIN'), validate(priceUpdateSchema), async (req, res) => {
  try {
    const doctor = await prisma.$transaction(async (tx) => {
      const existing = await tx.doctor.findUnique({ where: { id: req.params.id } });
      if (!existing) throw Object.assign(new Error('Doctor not found.'), { status: 404, code: 'DOCTOR_NOT_FOUND' });
      const updated = await tx.doctor.update({
        where: { id: existing.id },
        data: { consultationFee: req.body.priceSdg, ...(req.body.status && { status: req.body.status }) }
      });
      await tx.tenantAuditLog.create({ data: {
        userId: req.user.id,
        action: 'DOCTOR_CONSULTATION_PRICE_UPDATED',
        details: auditDetails('DOCTOR', existing.id, Number(existing.consultationFee), req.body.priceSdg, existing.status, updated.status),
        ipAddress: req.ip || 'unknown'
      } });
      return updated;
    });
    return res.json({ ...doctor, consultationFee: Number(doctor.consultationFee) });
  } catch (error) {
    if (error.status) return sendError(res, error.status, error.code, error.message);
    return sendError(res, 500, 'DOCTOR_PRICE_UPDATE_FAILED', 'Failed to update consultation pricing.');
  }
});

router.patch('/pricing/services/:id', authenticate, checkRoles('ADMIN'), validate(priceUpdateSchema), async (req, res) => {
  try {
    const service = await prisma.$transaction(async (tx) => {
      const existing = await tx.clinicalService.findUnique({ where: { id: req.params.id } });
      if (!existing) throw Object.assign(new Error('Clinical service not found.'), { status: 404, code: 'SERVICE_NOT_FOUND' });
      const updated = await tx.clinicalService.update({
        where: { id: existing.id },
        data: {
          baseFeeSdg: req.body.priceSdg,
          baseFeeUsd: req.body.priceSdg / 1500,
          ...(req.body.status && { status: req.body.status })
        }
      });
      await tx.tenantAuditLog.create({ data: {
        userId: req.user.id,
        action: 'CLINICAL_SERVICE_PRICE_UPDATED',
        details: auditDetails(
          'CLINICAL_SERVICE',
          existing.id,
          existing.baseFeeSdg == null ? null : Number(existing.baseFeeSdg),
          req.body.priceSdg,
          existing.status,
          updated.status
        ),
        ipAddress: req.ip || 'unknown'
      } });
      return updated;
    });
    return res.json({ ...service, baseFeeSdg: Number(service.baseFeeSdg), baseFeeUsd: Number(service.baseFeeUsd) });
  } catch (error) {
    if (error.status) return sendError(res, error.status, error.code, error.message);
    return sendError(res, 500, 'SERVICE_PRICE_UPDATE_FAILED', 'Failed to update clinical service pricing.');
  }
});

router.patch('/pricing/medicines/:id', authenticate, checkRoles('ADMIN'), validate(priceUpdateSchema), async (req, res) => {
  try {
    const medicine = await prisma.$transaction(async (tx) => {
      const existing = await tx.drugFormulary.findUnique({ where: { id: req.params.id } });
      if (!existing) throw Object.assign(new Error('Medicine not found.'), { status: 404, code: 'MEDICINE_NOT_FOUND' });
      const updated = await tx.drugFormulary.update({
        where: { id: existing.id },
        data: { unitPriceSdg: req.body.priceSdg, ...(req.body.status && { status: req.body.status }) }
      });
      await tx.tenantAuditLog.create({ data: {
        userId: req.user.id,
        action: 'MEDICINE_SELLING_PRICE_UPDATED',
        details: auditDetails('MEDICINE', existing.id, existing.unitPriceSdg == null ? null : Number(existing.unitPriceSdg), req.body.priceSdg, existing.status, updated.status),
        ipAddress: req.ip || 'unknown'
      } });
      return updated;
    });
    return res.json({ ...medicine, unitPriceSdg: Number(medicine.unitPriceSdg) });
  } catch (error) {
    if (error.status) return sendError(res, error.status, error.code, error.message);
    return sendError(res, 500, 'MEDICINE_PRICE_UPDATE_FAILED', 'Failed to update medicine pricing.');
  }
});

/**
 * GET /api/admin/analytics
 * Retrieves key operational performance metrics, patient counts, monthly visit trends,
 * doctor clinical volume breakdown, and appointment status distribution.
 */
router.get('/analytics', authenticate, checkRoles('ADMIN'), async (req, res) => {
  try {
    // 1. Total Registered Patients
    const totalPatients = await prisma.patient.count();

    // 2. Monthly Visits (Visits logged in current calendar month)
    const now = new Date();
    const { start: startOfMonth } = clinicMonthBounds(now);
    const monthlyVisits = await prisma.medicalRecord.count({
      where: {
        visitDate: {
          gte: startOfMonth
        }
      }
    });

    // 3. Total Appointments Count
    const totalAppointments = await prisma.appointment.count();

    // 4. Appointments Status Breakdown
    const statusCountsRaw = await prisma.appointment.groupBy({
      by: ['status'],
      _count: { status: true }
    });

    const statusMap = {
      COMPLETED: 0,
      IN_CONSULTATION: 0,
      CHECKED_IN: 0,
      CONFIRMED: 0,
      PENDING: 0,
      CANCELLED: 0
    };

    statusCountsRaw.forEach((item) => {
      if (statusMap[item.status] !== undefined) {
        statusMap[item.status] = item._count.status;
      }
    });

    const completedVisits = statusMap.COMPLETED;
    const waitingVisits = statusMap.CHECKED_IN + statusMap.IN_CONSULTATION + statusMap.CONFIRMED + statusMap.PENDING;
    const completionRate = totalAppointments > 0 ? Math.round((completedVisits / totalAppointments) * 100) : 0;

    // 5. Visits per Doctor (Clinical Volume Breakdown)
    const doctorVolumeRaw = await prisma.medicalRecord.groupBy({
      by: ['doctorId'],
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } }
    });

    // Fetch Doctor details for top doctors
    const doctors = await prisma.doctor.findMany({
      select: {
        id: true,
        fullNameAr: true,
        fullNameEn: true,
        specialtyAr: true,
        specialtyEn: true
      }
    });

    const doctorMap = new Map();
    doctors.forEach((d) => doctorMap.set(d.id, d));

    const doctorVisits = doctorVolumeRaw.map((dv) => {
      const doc = doctorMap.get(dv.doctorId) || {
        fullNameAr: 'طبيب غير محدد',
        fullNameEn: 'Unknown Doctor',
        specialtyAr: 'عام',
        specialtyEn: 'General'
      };
      return {
        doctorId: dv.doctorId,
        fullNameAr: doc.fullNameAr,
        fullNameEn: doc.fullNameEn,
        specialtyAr: doc.specialtyAr,
        specialtyEn: doc.specialtyEn,
        visitsCount: dv._count.id
      };
    });

    // 6. Financial Summary (Total Revenues & Invoices)
    const totalInvoices = await prisma.invoice.count();
    const [paymentTotals, refundTotals] = await Promise.all([
      prisma.payment.aggregate({ _sum: { amountSdg: true } }),
      prisma.refund.aggregate({ _sum: { amountSdg: true } })
    ]);
    const totalRevenueSdg = Number(paymentTotals._sum.amountSdg || 0) - Number(refundTotals._sum.amountSdg || 0);
    const trendDays = clinicDateSequence(7, now);
    const trendCounts = await prisma.appointment.groupBy({
      by: ['appointmentDate'],
      where: { appointmentDate: { gte: trendDays[0], lte: trendDays[6] } },
      _count: { id: true }
    });
    const trendMap = new Map(trendCounts.map((item) => [item.appointmentDate, item._count.id]));
    const appointmentTrend = trendDays.map((date) => ({ date, count: trendMap.get(date) || 0 }));

    return res.json({
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
        cancelled: statusMap.CANCELLED,
        totalActiveQueue: waitingVisits
      },
      doctorVisits,
      appointmentTrend,
      financials: {
        totalInvoices,
        totalRevenueSdg
      }
    });
  } catch (error) {
    console.error('Fetch admin analytics error:', error);
    return res.status(500).json({ error: 'Failed to compute administrative analytics.' });
  }
});

export default router;
