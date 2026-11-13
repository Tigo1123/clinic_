import {
  Controller,
  Get,
  Patch,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async getNotifications(@CurrentUser() user: any) {
    return this.notificationsService.getNotifications(user.id);
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  async markAsRead(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.notificationsService.markAsRead(id, user.id);
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  async markAllReadPatch(@CurrentUser() user: any) {
    return this.notificationsService.markAllAsRead(user.id);
  }
}
