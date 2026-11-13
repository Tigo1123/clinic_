import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpException, HttpStatus } from '@nestjs/common';

test('NestJS Phase 11: NotificationsModule and NotificationsController resolve from AppModule', async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://localhost:5433/clinic_test';
  process.env.SOCKET_REVOCATION_DATABASE_URL = 'postgresql://localhost:5433/clinic_test';
  process.env.JWT_SECRET = 'test-jwt-secret-at-least-thirty-two-characters';
  process.env.MEDICAL_ENCRYPTION_KEY = 'test-medical-key-separate-at-least-thirty-two';

  const { AppModule } = await import('../dist/app.module.js');
  const { NestFactory } = await import('@nestjs/core');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  assert.ok(app, 'ApplicationContext should be instantiated');

  const { NotificationsService } = await import('../dist/modules/notifications/notifications.service.js');
  const notificationsService = app.get(NotificationsService);
  assert.ok(notificationsService, 'NotificationsService should resolve from DI');

  const { NotificationsController } = await import('../dist/modules/notifications/notifications.controller.js');
  const notificationsController = app.get(NotificationsController);
  assert.ok(notificationsController, 'NotificationsController should resolve from DI');

  await app.close();
});

test('NotificationsService: In-app notifications fetch, mark read, and emit via RealtimeGateway', async () => {
  const { NotificationsService } = await import('../dist/modules/notifications/notifications.service.js');

  const notifications = [
    { id: 'notif-1', userId: 'user-1', title: 'Test 1', message: 'Hello', isRead: false, createdAt: new Date() },
    { id: 'notif-2', userId: 'user-1', title: 'Test 2', message: 'World', isRead: true, createdAt: new Date() },
  ];

  let emittedNotification = null;
  const mockRealtime = {
    emitNotification: (userId, payload) => {
      emittedNotification = { userId, payload };
    },
  };

  const mockPrisma = {
    notification: {
      findMany: async () => notifications,
      count: async () => 1,
      findFirst: async ({ where }) => notifications.find((n) => n.id === where.id && n.userId === where.userId) || null,
      update: async ({ where, data }) => {
        const item = notifications.find((n) => n.id === where.id);
        Object.assign(item, data);
        return item;
      },
      updateMany: async ({ where, data }) => {
        notifications.filter((n) => n.userId === where.userId && (where.isRead === undefined || n.isRead === where.isRead))
          .forEach((n) => Object.assign(n, data));
        return { count: 1 };
      },
      create: async ({ data }) => {
        const item = { id: 'notif-3', ...data, createdAt: new Date() };
        notifications.push(item);
        return item;
      },
    },
  };

  const service = new NotificationsService(mockPrisma, mockRealtime);

  // 1. Get notifications
  const list = await service.getNotifications('user-1');
  assert.equal(list.notifications.length, 2);
  assert.equal(list.unreadCount, 1);

  // 2. Mark single as read
  const readResult = await service.markAsRead('notif-1', 'user-1');
  assert.equal(readResult.success, true);
  assert.equal(readResult.notification.isRead, true);

  // 3. 404 for unknown notification
  await assert.rejects(
    async () => service.markAsRead('notif-unknown', 'user-1'),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.NOT_FOUND);
      return true;
    },
  );

  // 4. Mark all as read
  const allResult = await service.markAllAsRead('user-1');
  assert.equal(allResult.success, true);

  // 5. Send notification creates and broadcasts
  const sent = await service.sendNotification({
    userId: 'user-1',
    title: 'Lab Results Ready',
    message: 'Your laboratory report is now available.',
  });
  assert.equal(sent.title, 'Lab Results Ready');
  assert.ok(emittedNotification);
  assert.equal(emittedNotification.userId, 'user-1');
  assert.equal(emittedNotification.payload.title, 'Lab Results Ready');
});
