import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { AdminSchedulingService } from './admin-scheduling.service.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const period = z
  .object({
    dayOfWeek: z.enum([
      'SUNDAY',
      'MONDAY',
      'TUESDAY',
      'WEDNESDAY',
      'THURSDAY',
      'FRIDAY',
      'SATURDAY',
    ]),
    startTime: time,
    endTime: time,
    slotDurationMinutes: z.number().int().min(1).max(1440),
    active: z.boolean().optional(),
    breaks: z
      .array(
        z
          .object({
            startTime: time,
            endTime: time,
            active: z.boolean().optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

const scheduleSchema = z
  .object({
    effectiveFrom: z.string(),
    effectiveTo: z.string().nullable().optional(),
    active: z.boolean().optional(),
    periods: z.array(period),
  })
  .strict();

const exceptionSchema = z
  .object({
    type: z.enum(['FULL_DAY_LEAVE', 'SPECIAL_HOURS']),
    reason: z.string().trim().max(500).nullable().optional(),
    active: z.boolean().optional(),
    periods: z
      .array(
        z
          .object({
            startTime: time,
            endTime: time,
            slotDurationMinutes: z.number().int().min(1).max(1440),
            active: z.boolean().optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

const statusSchema = z.object({ active: z.boolean() }).strict();

@Controller('admin/doctors/:doctorId')
@Roles('ADMIN')
export class AdminSchedulingController {
  constructor(private readonly adminSchedulingService: AdminSchedulingService) {}

  @Get('schedules')
  @HttpCode(HttpStatus.OK)
  async listSchedules(@Param('doctorId') doctorId: string) {
    return this.adminSchedulingService.listSchedules(doctorId);
  }

  @Post('schedules')
  @HttpCode(HttpStatus.OK)
  async createSchedule(
    @Param('doctorId') doctorId: string,
    @Body(new ZodValidationPipe(scheduleSchema)) body: any,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.adminSchedulingService.createSchedule(
      { user, ip: req.ip },
      doctorId,
      body,
    );
  }

  @Put('schedules/:scheduleId')
  @HttpCode(HttpStatus.OK)
  async updateSchedule(
    @Param('doctorId') doctorId: string,
    @Param('scheduleId') scheduleId: string,
    @Body(new ZodValidationPipe(scheduleSchema)) body: any,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.adminSchedulingService.updateSchedule(
      { user, ip: req.ip },
      doctorId,
      scheduleId,
      body,
    );
  }

  @Patch('schedules/:scheduleId/status')
  @HttpCode(HttpStatus.OK)
  async setScheduleStatus(
    @Param('doctorId') doctorId: string,
    @Param('scheduleId') scheduleId: string,
    @Body(new ZodValidationPipe(statusSchema)) body: { active: boolean },
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.adminSchedulingService.setScheduleStatus(
      { user, ip: req.ip },
      doctorId,
      scheduleId,
      body.active,
    );
  }

  @Get('schedule-exceptions')
  @HttpCode(HttpStatus.OK)
  async listExceptions(
    @Param('doctorId') doctorId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.adminSchedulingService.listExceptions(doctorId, from, to);
  }

  @Put('schedule-exceptions/:date')
  @HttpCode(HttpStatus.OK)
  async replaceException(
    @Param('doctorId') doctorId: string,
    @Param('date') date: string,
    @Body(new ZodValidationPipe(exceptionSchema)) body: any,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.adminSchedulingService.replaceException(
      { user, ip: req.ip },
      doctorId,
      date,
      body,
    );
  }

  @Patch('schedule-exceptions/:date/status')
  @HttpCode(HttpStatus.OK)
  async setExceptionStatus(
    @Param('doctorId') doctorId: string,
    @Param('date') date: string,
    @Body(new ZodValidationPipe(statusSchema)) body: { active: boolean },
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.adminSchedulingService.setExceptionStatus(
      { user, ip: req.ip },
      doctorId,
      date,
      body.active,
    );
  }

  @Get('availability/preview')
  @HttpCode(HttpStatus.OK)
  async preview(
    @Param('doctorId') doctorId: string,
    @Query('date') date?: string,
  ) {
    return this.adminSchedulingService.preview(doctorId, date);
  }
}
