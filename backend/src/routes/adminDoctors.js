import express from 'express';
import { z } from 'zod';
import prisma from '../db.js';
import { authenticate, checkRoles } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { sendError } from '../utils/apiError.js';

const router = express.Router();
const doctorUpdateSchema = z.object({
  fullNameAr: z.string().trim().min(1).max(150).optional(),
  fullNameEn: z.string().trim().min(1).max(150).optional(),
  specialtyId: z.string().uuid().nullable().optional(),
  consultationFee: z.coerce.number().int().positive().max(1_000_000_000).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional()
}).strict();
const doctorSelect = {
  id: true, userId: true, fullNameAr: true, fullNameEn: true,
  specialtyAr: true, specialtyEn: true, specialtyId: true,
  specialty: { select: { id: true, code: true, nameAr: true, nameEn: true, active: true } },
  consultationFee: true, status: true, weeklySchedule: false,
  updatedAt: true, user: { select: { id: true, username: true, status: true } }
};
const toDoctorDto = (doctor) => ({
  id: doctor.id, userId: doctor.userId, fullNameAr: doctor.fullNameAr, fullNameEn: doctor.fullNameEn,
  specialtyAr: doctor.specialtyAr, specialtyEn: doctor.specialtyEn, specialtyId: doctor.specialtyId,
  specialty: doctor.specialty || null, consultationFee: Number(doctor.consultationFee), status: doctor.status,
  updatedAt: doctor.updatedAt, account: doctor.user ? { id: doctor.user.id, username: doctor.user.username, status: doctor.user.status } : null
});

router.use(authenticate, checkRoles('ADMIN'));

router.get('/doctors', async (req, res, next) => {
  try {
    const doctors = await prisma.doctor.findMany({ select: doctorSelect, orderBy: { fullNameEn: 'asc' } });
    return res.json(doctors.map(toDoctorDto));
  } catch (error) { return next(error); }
});

router.get('/doctors/:id', async (req, res, next) => {
  try {
    const doctor = await prisma.doctor.findUnique({ where: { id: req.params.id }, select: doctorSelect });
    if (!doctor) return sendError(res, 404, 'DOCTOR_NOT_FOUND', 'Doctor not found.');
    return res.json(toDoctorDto(doctor));
  } catch (error) { return next(error); }
});

router.patch('/doctors/:id', validate(doctorUpdateSchema), async (req, res, next) => {
  try {
    const doctor = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Doctor" WHERE "id" = ${req.params.id} FOR UPDATE`;
      const existing = await tx.doctor.findUnique({ where: { id: req.params.id }, include: { specialty: true } });
      if (!existing) throw Object.assign(new Error('Doctor not found.'), { status: 404, code: 'DOCTOR_NOT_FOUND' });
      let specialty = existing.specialty;
      if (req.body.specialtyId !== undefined) {
        specialty = req.body.specialtyId ? await tx.specialty.findFirst({ where: { id: req.body.specialtyId, active: true } }) : null;
        if (req.body.specialtyId && !specialty) throw Object.assign(new Error('Selected specialty is unavailable.'), { status: 422, code: 'SPECIALTY_INACTIVE_OR_NOT_FOUND' });
      }
      const data = {
        ...(req.body.fullNameAr !== undefined ? { fullNameAr: req.body.fullNameAr } : {}),
        ...(req.body.fullNameEn !== undefined ? { fullNameEn: req.body.fullNameEn } : {}),
        ...(req.body.consultationFee !== undefined ? { consultationFee: req.body.consultationFee } : {}),
        ...(req.body.status !== undefined ? { status: req.body.status } : {}),
        ...(req.body.specialtyId !== undefined ? { specialtyId: req.body.specialtyId, specialtyAr: specialty?.nameAr || existing.specialtyAr, specialtyEn: specialty?.nameEn || existing.specialtyEn } : {})
      };
      const updated = await tx.doctor.update({ where: { id: existing.id }, data, select: doctorSelect });
      await tx.tenantAuditLog.create({ data: { userId: req.user.id, action: 'DOCTOR_PROFILE_UPDATED', details: JSON.stringify({ doctorId: updated.id, changedFields: Object.keys(data), status: updated.status, specialtyId: updated.specialtyId }), ipAddress: req.ip || 'unknown' } });
      return updated;
    });
    return res.json(toDoctorDto(doctor));
  } catch (error) {
    if (error.status) return sendError(res, error.status, error.code, error.message);
    return next(error);
  }
});

export default router;
