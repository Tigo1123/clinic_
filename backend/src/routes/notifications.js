import { asyncRouter } from '../utils/asyncRouter.js';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { markSensitiveResponse } from '../utils/edgeSecurity.js';
import {
  getUserNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from '../services/actionableNotifications.js';

const router = asyncRouter();

function createSocketEmitter(io) {
  return (userId, notification) => {
    if (io && userId) {
      io.to(`user_${userId}`).emit('notification', notification);
    }
  };
}

/**
 * GET /api/notifications
 * Fetches notifications for the authenticated user (sorted newest first).
 */
router.get('/', authenticate, async (req, res) => {
  markSensitiveResponse(res);
  try {
    const result = await getUserNotifications(prisma, req.user.id, {
      limit: req.query.limit,
      unreadOnly: req.query.unreadOnly,
    });
    return res.json(result);
  } catch (error) {
    console.error('Fetch notifications error:', error);
    return res.status(500).json({ error: 'Failed to fetch notifications.' });
  }
});

/**
 * PATCH /api/notifications/read-all
 * Marks all notifications as read for the authenticated user.
 */
router.patch('/read-all', authenticate, async (req, res) => {
  markSensitiveResponse(res);
  try {
    const result = await markAllNotificationsAsRead(prisma, req.user.id);
    return res.json(result);
  } catch (error) {
    console.error('Mark all notifications read error:', error);
    return res.status(500).json({ error: 'Failed to mark all as read.' });
  }
});

/**
 * PATCH /api/notifications/:id/read
 * Marks a single notification as read for the authenticated user.
 */
router.patch('/:id/read', authenticate, async (req, res) => {
  markSensitiveResponse(res);
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const result = await markNotificationAsRead(prisma, id, userId);
    if (!result) {
      return res.status(404).json({ error: 'Notification not found.' });
    }
    return res.json(result);
  } catch (error) {
    console.error('Mark notification as read error:', error);
    return res.status(500).json({ error: 'Failed to update notification status.' });
  }
});

export function deliverNotification(req, producer, input) {
  return producer(prisma, createSocketEmitter(req.app.get('io')), input);
}

export default router;
