import express from 'express';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/notifications
 * Fetches notifications for the authenticated user (sorted newest first).
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    const unreadCount = await prisma.notification.count({
      where: { userId, isRead: false }
    });

    return res.json({ notifications, unreadCount });
  } catch (error) {
    console.error('Fetch notifications error:', error);
    return res.status(500).json({ error: 'Failed to fetch notifications.' });
  }
});

/**
 * PATCH /api/notifications/:id/read
 * Marks a single notification as read for the authenticated user.
 */
router.patch('/:id/read', authenticate, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const notification = await prisma.notification.findFirst({
      where: { id, userId }
    });

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found.' });
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: { isRead: true }
    });

    return res.json({ success: true, notification: updated });
  } catch (error) {
    console.error('Mark notification as read error:', error);
    return res.status(500).json({ error: 'Failed to update notification status.' });
  }
});

/**
 * PATCH /api/notifications/read-all
 * Marks all notifications as read for the authenticated user.
 */
router.patch('/read-all', authenticate, async (req, res) => {
  const userId = req.user.id;

  try {
    await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true }
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Mark all notifications read error:', error);
    return res.status(500).json({ error: 'Failed to mark all as read.' });
  }
});

/**
 * Helper function to create a notification in DB and emit in real-time via Socket.io
 * @param {Object} io - Socket.io server instance
 * @param {Object} payload - { userId, title, message }
 */
export async function sendNotification(io, { userId, title, message }) {
  try {
    const notification = await prisma.notification.create({
      data: {
        userId,
        title,
        message,
        isRead: false
      }
    });

    if (io) {
      // Emit to targeted user room (supports both io.to(userId) and io.to(`user_${userId}`))
      io.to(userId).to(`user_${userId}`).emit('notification', notification);
    }

    return notification;
  } catch (error) {
    console.error('Send notification error:', error);
    throw error;
  }
}

export default router;
