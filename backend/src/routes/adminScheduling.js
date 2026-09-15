import express from 'express';
import { z } from 'zod';
import { authenticate, checkRoles } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { sendError } from '../utils/apiError.js';
import { clinicTimeZone } from '../utils/clinicTime.js';
import { listSchedules, replaceSchedule, setScheduleStatus, listExceptions, replaceException, setExceptionStatus, preview, ScheduleDomainError } from '../services/doctorSchedulingAdmin.js';

const router = express.Router();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const period = z.object({ dayOfWeek: z.enum(['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY']), startTime: time, endTime: time, slotDurationMinutes: z.number().int().min(1).max(1440), active: z.boolean().optional(), breaks: z.array(z.object({ startTime: time, endTime: time, active: z.boolean().optional() }).strict()).optional() }).strict();
const schedule = z.object({ effectiveFrom: z.string(), effectiveTo: z.string().nullable().optional(), active: z.boolean().optional(), periods: z.array(period) }).strict();
const exception = z.object({ type: z.enum(['FULL_DAY_LEAVE','SPECIAL_HOURS']), reason: z.string().trim().max(500).nullable().optional(), active: z.boolean().optional(), periods: z.array(z.object({ startTime: time, endTime: time, slotDurationMinutes: z.number().int().min(1).max(1440), active: z.boolean().optional() }).strict()).optional() }).strict();
const status = z.object({ active: z.boolean() }).strict();
const handle = (fn) => async (req, res, next) => { try { return res.json(await fn(req)); } catch (error) { if (error instanceof ScheduleDomainError) return sendError(res, error.status, error.code, error.message, error.details); return next(error); } };

router.use(authenticate, checkRoles('ADMIN'));
router.get('/doctors/:doctorId/schedules', handle(async (req) => listSchedules(req.params.doctorId)));
router.post('/doctors/:doctorId/schedules', validate(schedule), handle(async (req) => replaceSchedule(req, req.params.doctorId, req.body)));
router.put('/doctors/:doctorId/schedules/:scheduleId', validate(schedule), handle(async (req) => replaceSchedule(req, req.params.doctorId, req.body, req.params.scheduleId)));
router.patch('/doctors/:doctorId/schedules/:scheduleId/status', validate(status), handle(async (req) => setScheduleStatus(req, req.params.doctorId, req.params.scheduleId, req.body.active)));
router.get('/doctors/:doctorId/schedule-exceptions', handle(async (req) => listExceptions(req.params.doctorId, req.query.from, req.query.to)));
router.put('/doctors/:doctorId/schedule-exceptions/:date', validate(exception), handle(async (req) => replaceException(req, req.params.doctorId, req.params.date, req.body)));
router.patch('/doctors/:doctorId/schedule-exceptions/:date/status', validate(status), handle(async (req) => setExceptionStatus(req, req.params.doctorId, req.params.date, req.body.active)));
router.get('/doctors/:doctorId/availability/preview', handle(async (req) => ({ ...(await preview(req.params.doctorId, req.query.date)), clinicTimeZone: clinicTimeZone() })));

export default router;
