import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  imports: [PrismaModule, RealtimeModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
