import { z } from 'zod';
import { asyncRouter } from '../utils/asyncRouter.js';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { sendError } from '../utils/apiError.js';
import { notificationDto } from '../services/notificationDelivery.js';

const router = asyncRouter();
// Preserve the existing authenticated API for any user's own records. New
// operational notices are created only for staff; no patient sockets are added.
router.use(authenticate);
const cursorSchema = z.object({ id: z.string().uuid(), createdAt: z.string().datetime() }).strict();

router.get('/', async (req, res) => {
  const query = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20), cursor: z.string().max(300).optional() }).strict().safeParse(req.query);
  if (!query.success) return sendError(res, 400, 'NOTIFICATION_QUERY_INVALID', 'Invalid notification query.');
  let cursor;
  if (query.data.cursor) {
    try { cursor = cursorSchema.parse(JSON.parse(Buffer.from(query.data.cursor, 'base64url').toString())); }
    catch { return sendError(res, 400, 'NOTIFICATION_CURSOR_INVALID', 'Invalid notification cursor.'); }
  }
  const where = { userId: req.user.id, ...(cursor ? { OR: [
    { createdAt: { lt: new Date(cursor.createdAt) } },
    { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } }
  ] } : {}) };
  const asOf = new Date();
  const [rows, unreadCount] = await prisma.$transaction([
    prisma.notification.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.data.limit + 1 }),
    prisma.notification.count({ where: { userId: req.user.id, isRead: false } })
  ], { isolationLevel: 'RepeatableRead' });
  const hasMore = rows.length > query.data.limit;
  const page = rows.slice(0, query.data.limit);
  const last = page.at(-1);
  const nextCursor = hasMore ? Buffer.from(JSON.stringify({ id: last.id, createdAt: last.createdAt.toISOString() })).toString('base64url') : null;
  // Older installations may contain local-wall-time timestamps ahead of UTC.
  // Include the latest visible legacy record without rewriting its history.
  const cutoff = page[0]?.createdAt > asOf ? page[0].createdAt : asOf;
  res.json({ notifications: page.map(notificationDto), unreadCount, nextCursor, asOf: cutoff });
});

router.patch('/:id/read', async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.id).success) return sendError(res, 404, 'NOTIFICATION_NOT_FOUND', 'Notification not found.');
  const result = await prisma.notification.updateMany({ where: { id: req.params.id, userId: req.user.id }, data: { isRead: true } });
  if (!result.count) return sendError(res, 404, 'NOTIFICATION_NOT_FOUND', 'Notification not found.');
  const unreadCount = await prisma.notification.count({ where: { userId: req.user.id, isRead: false } });
  res.json({ success: true, unreadCount });
});

router.patch('/read-all', async (req, res) => {
  const parsed = z.object({ before: z.string().datetime().optional() }).strict().safeParse(req.body || {});
  if (!parsed.success) return sendError(res, 400, 'NOTIFICATION_READ_INVALID', 'Invalid notification read cutoff.');
  await prisma.notification.updateMany({
    where: { userId: req.user.id, isRead: false, ...(parsed.data.before ? { createdAt: { lte: new Date(parsed.data.before) } } : {}) },
    data: { isRead: true }
  });
  const unreadCount = await prisma.notification.count({ where: { userId: req.user.id, isRead: false } });
  res.json({ success: true, unreadCount });
});

export default router;
