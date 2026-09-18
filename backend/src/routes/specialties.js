import express from 'express';
import { z } from 'zod';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { checkRoles } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { sendError } from '../utils/apiError.js';

const router = express.Router();
const specialtySchema = z.object({
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(60),
  nameAr: z.string().trim().min(1).max(100),
  nameEn: z.string().trim().min(1).max(100),
  active: z.boolean().optional()
}).strict();
const specialtyUpdateSchema = specialtySchema.omit({ code: true }).extend({ code: specialtySchema.shape.code.optional() }).strict();
const safeSelect = { id: true, code: true, nameAr: true, nameEn: true, active: true, createdAt: true, updatedAt: true };

router.get('/', authenticate, checkRoles('ADMIN'), async (req, res, next) => {
  try { return res.json(await prisma.specialty.findMany({ select: safeSelect, orderBy: { nameEn: 'asc' } })); } catch (error) { next(error); }
});
router.post('/', authenticate, checkRoles('ADMIN'), validate(specialtySchema), async (req, res, next) => {
  try {
    const specialty = await prisma.specialty.create({ data: req.body, select: safeSelect });
    await prisma.tenantAuditLog.create({ data: { userId: req.user.id, action: 'SPECIALTY_CREATED', details: JSON.stringify({ specialtyId: specialty.id, code: specialty.code }), ipAddress: req.ip || 'unknown' } });
    return res.status(201).json(specialty);
  } catch (error) { if (error.code === 'P2002') return sendError(res, 409, 'SPECIALTY_CODE_EXISTS', 'A specialty with this code already exists.'); next(error); }
});
router.patch('/:id', authenticate, checkRoles('ADMIN'), validate(specialtyUpdateSchema), async (req, res, next) => {
  try {
    const specialty = await prisma.specialty.update({ where: { id: req.params.id }, data: req.body, select: safeSelect });
    await prisma.tenantAuditLog.create({ data: { userId: req.user.id, action: 'SPECIALTY_UPDATED', details: JSON.stringify({ specialtyId: specialty.id, active: specialty.active }), ipAddress: req.ip || 'unknown' } });
    return res.json(specialty);
  } catch (error) { if (error.code === 'P2025') return sendError(res, 404, 'SPECIALTY_NOT_FOUND', 'Specialty not found.'); if (error.code === 'P2002') return sendError(res, 409, 'SPECIALTY_CODE_EXISTS', 'A specialty with this code already exists.'); next(error); }
});

router.delete('/:id', authenticate, checkRoles('ADMIN'), validate(z.object({ id: z.string().uuid() }), 'params'), async (req, res, next) => {
  const referenced = () => sendError(res, 409, 'SPECIALTY_REFERENCED', 'This specialty cannot be deleted because it is referenced by existing data. You can deactivate it instead.');
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Specialty" WHERE "id" = ${req.params.id} FOR UPDATE`;
      const specialty = await tx.specialty.findUnique({ where: { id: req.params.id } });
      if (!specialty) return 'missing';
      // Clinical records, appointments, and schedules all depend on Doctor.
      // Keep former assignments protected even after a doctor changes specialty.
      const doctor = await tx.doctor.findFirst({ where: { OR: [
        { specialtyId: specialty.id },
        { specialtyId: null, OR: [{ specialtyEn: { equals: specialty.nameEn, mode: 'insensitive' } }, { specialtyAr: specialty.nameAr }] }
      ] }, select: { id: true } });
      if (specialty.deletionProtected || doctor) return 'referenced';
      await tx.specialty.delete({ where: { id: specialty.id } });
      await tx.tenantAuditLog.create({ data: { userId: req.user.id, action: 'SPECIALTY_DELETED', details: JSON.stringify({ specialtyId: specialty.id, code: specialty.code }), ipAddress: req.ip || 'unknown' } });
      return 'deleted';
    });
    if (result === 'missing') return sendError(res, 404, 'SPECIALTY_NOT_FOUND', 'Specialty not found.');
    if (result === 'referenced') return referenced();
    return res.status(204).end();
  } catch (error) {
    if (['P2003', 'P2014', 'P2034'].includes(error.code)) return referenced();
    if (error.code === 'P2025') return sendError(res, 404, 'SPECIALTY_NOT_FOUND', 'Specialty not found.');
    return next(error);
  }
});

export default router;
