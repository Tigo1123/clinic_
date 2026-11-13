import { Injectable } from '@nestjs/common';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  listSchedules,
  replaceSchedule,
  setScheduleStatus,
  listExceptions,
  replaceException,
  setExceptionStatus,
  preview,
  ScheduleDomainError,
} = require('../../services/doctorSchedulingAdmin.js');
const { clinicTimeZone } = require('../../utils/clinicTime.js');

@Injectable()
export class AdminSchedulingService {
  async listSchedules(doctorId: string) {
    return listSchedules(doctorId);
  }

  async createSchedule(req: any, doctorId: string, payload: any) {
    return replaceSchedule(req, doctorId, payload);
  }

  async updateSchedule(req: any, doctorId: string, scheduleId: string, payload: any) {
    return replaceSchedule(req, doctorId, payload, scheduleId);
  }

  async setScheduleStatus(req: any, doctorId: string, scheduleId: string, active: boolean) {
    return setScheduleStatus(req, doctorId, scheduleId, active);
  }

  async listExceptions(doctorId: string, from?: string, to?: string) {
    return listExceptions(doctorId, from, to);
  }

  async replaceException(req: any, doctorId: string, date: string, payload: any) {
    return replaceException(req, doctorId, date, payload);
  }

  async setExceptionStatus(req: any, doctorId: string, date: string, active: boolean) {
    return setExceptionStatus(req, doctorId, date, active);
  }

  async preview(doctorId: string, date?: string) {
    const result = await preview(doctorId, date);
    return {
      ...result,
      clinicTimeZone: clinicTimeZone(),
    };
  }
}
