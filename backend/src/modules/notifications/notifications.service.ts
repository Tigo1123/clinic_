import {
  Injectable,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';

export interface SendNotificationParams {
  userId: string;
  title: string;
  message: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeGateway: RealtimeGateway,
  ) {}

  /**
   * Fetches notifications for the authenticated user (sorted newest first).
   */
  async getNotifications(userId: string) {
    const notifications = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const unreadCount = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });

    return { notifications, unreadCount };
  }

  /**
   * Marks a single notification as read for the authenticated user.
   */
  async markAsRead(id: string, userId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, userId },
    });

    if (!notification) {
      throw new HttpException(
        { error: 'Notification not found.' },
        HttpStatus.NOT_FOUND,
      );
    }

    const updated = await this.prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });

    return { success: true, notification: updated };
  }

  /**
   * Marks all notifications as read for the authenticated user.
   */
  async markAllAsRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    return { success: true };
  }

  /**
   * Creates a notification in the database and emits it in real-time via Socket.io.
   */
  async sendNotification(params: SendNotificationParams) {
    const { userId, title, message } = params;

    const notification = await this.prisma.notification.create({
      data: {
        userId,
        title,
        message,
        isRead: false,
      },
    });

    this.realtimeGateway.emitNotification(userId, notification);

    return notification;
  }
}
