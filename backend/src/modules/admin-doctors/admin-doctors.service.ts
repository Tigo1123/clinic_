import {
  Injectable,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { lockDoctorLifecycle, synchronizeDoctorAccount } from '../../services/doctorLifecycle.js';

export const doctorSelect = {
  id: true,
  userId: true,
  fullNameAr: true,
  fullNameEn: true,
  specialtyAr: true,
  specialtyEn: true,
  specialtyId: true,
  specialty: {
    select: { id: true, code: true, nameAr: true, nameEn: true, active: true },
  },
  consultationFee: true,
  status: true,
  schedules: { select: { id: true, active: true } },
  weeklySchedule: true,
  updatedAt: true,
  user: { select: { id: true, username: true, status: true } },
};

export const toDoctorDto = (doctor: any) => ({
  id: doctor.id,
  userId: doctor.userId,
  fullNameAr: doctor.fullNameAr,
  fullNameEn: doctor.fullNameEn,
  specialtyAr: doctor.specialtyAr,
  specialtyEn: doctor.specialtyEn,
  specialtyId: doctor.specialtyId,
  specialty: doctor.specialty || null,
  consultationFee: Number(doctor.consultationFee),
  status: doctor.status,
  hasSchedule: Boolean(
    doctor.schedules?.length
      ? doctor.schedules.some((schedule: any) => schedule.active)
      : (() => {
          try {
            return JSON.parse(doctor.weeklySchedule || '[]').length > 0;
          } catch {
            return false;
          }
        })(),
  ),
  updatedAt: doctor.updatedAt,
  account: doctor.user
    ? {
        id: doctor.user.id,
        username: doctor.user.username,
        status: doctor.user.status,
      }
    : null,
});

export interface UpdateDoctorDto {
  fullNameAr?: string;
  fullNameEn?: string;
  specialtyId?: string | null;
  consultationFee?: number;
  status?: 'ACTIVE' | 'INACTIVE';
}

@Injectable()
export class AdminDoctorsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const doctors = await this.prisma.doctor.findMany({
      select: doctorSelect,
      orderBy: { fullNameEn: 'asc' },
    });
    return doctors.map(toDoctorDto);
  }

  async findOne(id: string) {
    const doctor = await this.prisma.doctor.findUnique({
      where: { id },
      select: doctorSelect,
    });
    if (!doctor) {
      throw new HttpException(
        { code: 'DOCTOR_NOT_FOUND', message: 'Doctor not found.' },
        HttpStatus.NOT_FOUND,
      );
    }
    return toDoctorDto(doctor);
  }

  async update(id: string, body: UpdateDoctorDto, userId: string, ip?: string) {
    try {
      const doctor = await this.prisma.$transaction(async (tx: any) => {
        await lockDoctorLifecycle(tx, id);
        const existing = await tx.doctor.findUnique({
          where: { id },
          include: { specialty: true },
        });
        if (!existing) {
          throw new HttpException(
            { code: 'DOCTOR_NOT_FOUND', message: 'Doctor not found.' },
            HttpStatus.NOT_FOUND,
          );
        }

        let specialty = existing.specialty;
        if (body.specialtyId !== undefined && body.specialtyId !== existing.specialtyId) {
          specialty = body.specialtyId
            ? await tx.specialty.findFirst({
                where: { id: body.specialtyId, active: true },
              })
            : null;
          if (body.specialtyId && !specialty) {
            throw new HttpException(
              {
                code: 'SPECIALTY_INACTIVE_OR_NOT_FOUND',
                message: 'Selected specialty is unavailable.',
              },
              HttpStatus.UNPROCESSABLE_ENTITY,
            );
          }
        }

        const data: any = {
          ...(body.fullNameAr !== undefined ? { fullNameAr: body.fullNameAr } : {}),
          ...(body.fullNameEn !== undefined ? { fullNameEn: body.fullNameEn } : {}),
          ...(body.consultationFee !== undefined
            ? { consultationFee: body.consultationFee }
            : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.specialtyId !== undefined
            ? {
                specialtyId: body.specialtyId,
                specialtyAr: specialty?.nameAr || existing.specialtyAr,
                specialtyEn: specialty?.nameEn || existing.specialtyEn,
              }
            : {}),
        };

        if (body.status) {
          await synchronizeDoctorAccount(tx, existing.userId, body.status);
        }

        const updated = await tx.doctor.update({
          where: { id: existing.id },
          data,
          select: doctorSelect,
        });

        await tx.tenantAuditLog.create({
          data: {
            userId,
            action: 'DOCTOR_PROFILE_UPDATED',
            details: JSON.stringify({
              doctorId: updated.id,
              changedFields: Object.keys(data),
              status: updated.status,
              specialtyId: updated.specialtyId,
            }),
            ipAddress: ip || 'unknown',
          },
        });

        return updated;
      });

      return toDoctorDto(doctor);
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      if (error.status && error.code) {
        throw new HttpException(
          { code: error.code, message: error.message },
          error.status,
        );
      }
      throw error;
    }
  }
}
