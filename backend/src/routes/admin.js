import express from 'express';
import prisma from '../db.js';
import { authenticate, checkRoles } from '../middleware/auth.js';

const router = express.Router();

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
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
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
    const paidInvoices = await prisma.invoice.aggregate({
      where: { paymentStatus: 'PAID' },
      _sum: { totalAmountSdg: true }
    });

    const totalRevenueSdg = paidInvoices._sum?.totalAmountSdg ? Number(paidInvoices._sum.totalAmountSdg) : 0;

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
