import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { NotificationsService } from './notifications.service.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { markSensitiveResponse } from '../../utils/edgeSecurity.js';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async getNotifications(
    @CurrentUser() user: any,
    @Query('limit') limit?: string,
    @Query('unreadOnly') unreadOnly?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    if (typeof res?.set === 'function') markSensitiveResponse(res);
    return this.notificationsService.getNotifications(user.id, { limit, unreadOnly });
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  async markAllReadPatch(
    @CurrentUser() user: any,
    @Res({ passthrough: true }) res?: Response,
  ) {
    if (typeof res?.set === 'function') markSensitiveResponse(res);
    return this.notificationsService.markAllAsRead(user.id);
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  async markAsRead(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Res({ passthrough: true }) res?: Response,
  ) {
    if (typeof res?.set === 'function') markSensitiveResponse(res);
    return this.notificationsService.markAsRead(id, user.id);
  }
}
