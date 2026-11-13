import {
  Injectable,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

export const safeSpecialtySelect = {
  id: true,
  code: true,
  nameAr: true,
  nameEn: true,
  active: true,
  createdAt: true,
  updatedAt: true,
};

const normalizeName = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

export interface CreateSpecialtyDto {
  code: string;
  nameAr: string;
  nameEn: string;
  active?: boolean;
}

export interface UpdateSpecialtyDto {
  code?: string;
  nameAr: string;
  nameEn: string;
  active?: boolean;
}

@Injectable()
export class SpecialtiesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.specialty.findMany({
      select: safeSpecialtySelect,
      orderBy: { nameEn: 'asc' },
    });
  }

  private async assertUniqueNames(tx: any, data: { nameAr: string; nameEn: string }, id?: string) {
    for (const name of [data.nameAr, data.nameEn].map(normalizeName).sort()) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'specialty-name:' + name})) IS NULL AS locked`;
    }
    const entries = await tx.specialty.findMany({
      where: id ? { id: { not: id } } : {},
      select: { nameAr: true, nameEn: true },
    });
    if (
      entries.some(
        (item: any) =>
          normalizeName(item.nameAr) === normalizeName(data.nameAr) ||
          normalizeName(item.nameEn) === normalizeName(data.nameEn),
      )
    ) {
      throw new HttpException(
        {
          code: 'SPECIALTY_NAME_EXISTS',
          message: 'A specialty with one of these names already exists.',
        },
        HttpStatus.CONFLICT,
      );
    }
  }

  async create(data: CreateSpecialtyDto, userId: string, ip?: string) {
    try {
      const specialty = await this.prisma.$transaction(async (tx: any) => {
        await this.assertUniqueNames(tx, data);
        const created = await tx.specialty.create({
          data,
          select: safeSpecialtySelect,
        });
        await tx.tenantAuditLog.create({
          data: {
            userId,
            action: 'SPECIALTY_CREATED',
            details: JSON.stringify({ specialtyId: created.id, code: created.code }),
            ipAddress: ip || 'unknown',
          },
        });
        return created;
      });
      return specialty;
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      if (error.code === 'P2002') {
        throw new HttpException(
          {
            code: 'SPECIALTY_CODE_EXISTS',
            message: 'A specialty with this code already exists.',
          },
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  async update(id: string, data: UpdateSpecialtyDto, userId: string, ip?: string) {
    try {
      const specialty = await this.prisma.$transaction(async (tx: any) => {
        const existing = await tx.specialty.findUniqueOrThrow({ where: { id } });
        if (data.nameAr !== existing.nameAr || data.nameEn !== existing.nameEn) {
          await this.assertUniqueNames(tx, data, existing.id);
        }
        const updated = await tx.specialty.update({
          where: { id },
          data,
          select: safeSpecialtySelect,
        });
        await tx.tenantAuditLog.create({
          data: {
            userId,
            action: 'SPECIALTY_UPDATED',
            details: JSON.stringify({ specialtyId: updated.id, active: updated.active }),
            ipAddress: ip || 'unknown',
          },
        });
        return updated;
      });
      return specialty;
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      if (error.code === 'P2025') {
        throw new HttpException(
          {
            code: 'SPECIALTY_NOT_FOUND',
            message: 'Specialty not found.',
          },
          HttpStatus.NOT_FOUND,
        );
      }
      if (error.code === 'P2002') {
        throw new HttpException(
          {
            code: 'SPECIALTY_CODE_EXISTS',
            message: 'A specialty with this code already exists.',
          },
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  async delete(id: string, userId: string, ip?: string) {
    const throwReferenced = () => {
      throw new HttpException(
        {
          code: 'SPECIALTY_REFERENCED',
          message:
            'This specialty cannot be deleted because it is referenced by existing data. You can deactivate it instead.',
        },
        HttpStatus.CONFLICT,
      );
    };

    try {
      const result = await this.prisma.$transaction(async (tx: any) => {
        await tx.$queryRaw`SELECT "id" FROM "Specialty" WHERE "id" = ${id} FOR UPDATE`;
        const specialty = await tx.specialty.findUnique({ where: { id } });
        if (!specialty) {
          return 'missing';
        }
        const doctor = await tx.doctor.findFirst({
          where: {
            OR: [
              { specialtyId: specialty.id },
              {
                specialtyId: null,
                OR: [
                  { specialtyEn: { equals: specialty.nameEn, mode: 'insensitive' } },
                  { specialtyAr: specialty.nameAr },
                ],
              },
            ],
          },
          select: { id: true },
        });
        if (specialty.deletionProtected || doctor) {
          return 'referenced';
        }
        await tx.specialty.delete({ where: { id: specialty.id } });
        await tx.tenantAuditLog.create({
          data: {
            userId,
            action: 'SPECIALTY_DELETED',
            details: JSON.stringify({ specialtyId: specialty.id, code: specialty.code }),
            ipAddress: ip || 'unknown',
          },
        });
        return 'deleted';
      });

      if (result === 'missing') {
        throw new HttpException(
          {
            code: 'SPECIALTY_NOT_FOUND',
            message: 'Specialty not found.',
          },
          HttpStatus.NOT_FOUND,
        );
      }
      if (result === 'referenced') {
        throwReferenced();
      }
      return;
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      if (['P2003', 'P2014', 'P2034'].includes(error.code)) {
        throwReferenced();
      }
      if (error.code === 'P2025') {
        throw new HttpException(
          {
            code: 'SPECIALTY_NOT_FOUND',
            message: 'Specialty not found.',
          },
          HttpStatus.NOT_FOUND,
        );
      }
      throw error;
    }
  }
}
