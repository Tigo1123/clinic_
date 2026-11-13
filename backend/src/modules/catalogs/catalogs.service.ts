import {
  Injectable,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { money, usdFromSdg } from '../../common/utils/money.js';

const normalize = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

export interface ServiceDto {
  id: string;
  code: string;
  labelAr: string;
  labelEn: string;
  category: string;
  status: string;
  priceSdg: string | null;
  updatedAt: Date;
}

export interface QueryServicesDto {
  search?: string;
  category?: 'CONSULTATION' | 'LABORATORY' | 'RADIOLOGY' | 'CLINICAL_PROCEDURE';
  status?: 'ACTIVE' | 'INACTIVE';
  page?: number;
  pageSize?: number;
}

export interface CreateServiceDto {
  code: string;
  labelAr: string;
  labelEn: string;
  category: 'CONSULTATION' | 'LABORATORY' | 'RADIOLOGY' | 'CLINICAL_PROCEDURE';
  priceSdg: string | number;
  status?: 'ACTIVE' | 'INACTIVE';
}

export interface UpdateServiceDto {
  code?: string;
  labelAr?: string;
  labelEn?: string;
  priceSdg?: string | number;
  status?: 'ACTIVE' | 'INACTIVE';
}

export interface UpdatePaymentMethodDto {
  labelAr?: string;
  labelEn?: string;
  active?: boolean;
}

@Injectable()
export class CatalogsService {
  constructor(private readonly prisma: PrismaService) {}

  private dto(service: any): ServiceDto {
    return {
      id: service.id,
      code: service.code,
      labelAr: service.labelAr,
      labelEn: service.labelEn,
      category: service.category,
      status: service.status,
      priceSdg: service.baseFeeSdg?.toString() ?? null,
      updatedAt: service.updatedAt,
    };
  }

  private async audit(
    tx: any,
    userId: string,
    ip: string | undefined,
    action: string,
    details: any,
  ) {
    return tx.tenantAuditLog.create({
      data: {
        userId,
        action,
        details: JSON.stringify(details),
        ipAddress: ip || 'unknown',
      },
    });
  }

  private async uniqueService(
    tx: any,
    data: { labelAr: string; labelEn: string; category: string },
    exceptId?: string,
  ) {
    const keys = [data.labelAr, data.labelEn]
      .map(normalize)
      .map(
        (value) =>
          `${data.category === 'LABORATORY' ? 'lab-service' : `catalog-service:${data.category}`}:${value}`,
      )
      .sort();

    for (const key of [...new Set(keys)]) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key})) IS NULL AS locked`;
    }

    const candidates = await tx.clinicalService.findMany({
      where: {
        category: data.category,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { labelAr: true, labelEn: true },
    });

    if (
      candidates.some(
        (item: any) =>
          normalize(item.labelAr) === normalize(data.labelAr) ||
          normalize(item.labelEn) === normalize(data.labelEn),
      )
    ) {
      throw new HttpException(
        {
          code: 'CATALOG_DUPLICATE',
          message: 'A service with one of these names already exists in this category.',
        },
        HttpStatus.CONFLICT,
      );
    }
  }

  private handleError(error: any): never {
    if (error instanceof HttpException) {
      throw error;
    }
    if (error.code === 'P2002') {
      throw new HttpException(
        {
          code: 'CATALOG_DUPLICATE',
          message: 'This catalog code or name already exists.',
        },
        HttpStatus.CONFLICT,
      );
    }
    if (error.code === 'P2025') {
      throw new HttpException(
        {
          code: 'CATALOG_NOT_FOUND',
          message: 'Catalog entry not found.',
        },
        HttpStatus.NOT_FOUND,
      );
    }
    if (error.status && error.code) {
      throw new HttpException(
        {
          code: error.code,
          message: error.message,
        },
        error.status,
      );
    }
    throw error;
  }

  async listServices(query: QueryServicesDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const search = query.search ?? '';
    const category = query.category;
    const status = query.status;

    const where: any = {
      ...(category ? { category } : {}),
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: ['code', 'labelAr', 'labelEn'].map((field) => ({
              [field]: { contains: search, mode: 'insensitive' },
            })),
          }
        : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.clinicalService.count({ where }),
      this.prisma.clinicalService.findMany({
        where,
        orderBy: [{ labelEn: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items: items.map((service: any) => this.dto(service)),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async createService(data: CreateServiceDto, userId: string, ip?: string) {
    try {
      const result = await this.prisma.$transaction(async (tx: any) => {
        await this.uniqueService(tx, data);
        const created = await tx.clinicalService.create({
          data: {
            code: data.code,
            labelAr: data.labelAr,
            labelEn: data.labelEn,
            category: data.category,
            status: data.status,
            baseFeeSdg: money(data.priceSdg),
            baseFeeUsd: usdFromSdg(data.priceSdg),
          },
        });
        await this.audit(tx, userId, ip, 'CATALOG_SERVICE_CREATED', {
          serviceId: created.id,
          code: created.code,
          category: created.category,
        });
        return created;
      });
      return this.dto(result);
    } catch (error) {
      this.handleError(error);
    }
  }

  async updateService(
    id: string,
    data: UpdateServiceDto,
    userId: string,
    ip?: string,
  ) {
    try {
      const result = await this.prisma.$transaction(async (tx: any) => {
        await tx.$queryRaw`SELECT "id" FROM "ClinicalService" WHERE "id" = ${id} FOR UPDATE`;
        const existing = await tx.clinicalService.findUniqueOrThrow({
          where: { id },
        });
        const identity = { ...existing, ...data };
        await this.uniqueService(tx, identity, existing.id);

        const currentFee = existing.baseFeeSdg ? money(existing.baseFeeSdg) : null;
        if (
          (data.status || existing.status) === 'ACTIVE' &&
          data.priceSdg === undefined &&
          (!currentFee || !currentFee.isInteger() || currentFee.lte(0))
        ) {
          throw new HttpException(
            {
              code: 'CATALOG_PRICE_REQUIRED',
              message: 'An active service requires an official whole-SDG price.',
            },
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }

        const { priceSdg, ...metadata } = data;
        const updated = await tx.clinicalService.update({
          where: { id: existing.id },
          data: {
            ...metadata,
            ...(priceSdg !== undefined
              ? {
                  baseFeeSdg: money(priceSdg),
                  baseFeeUsd: usdFromSdg(priceSdg),
                }
              : {}),
          },
        });

        await this.audit(tx, userId, ip, 'CATALOG_SERVICE_UPDATED', {
          serviceId: existing.id,
          changedFields: Object.keys(data),
          previousStatus: existing.status,
          status: updated.status,
          previousPriceSdg: existing.baseFeeSdg?.toString() ?? null,
          priceSdg: updated.baseFeeSdg?.toString() ?? null,
        });

        return updated;
      });
      return this.dto(result);
    } catch (error) {
      this.handleError(error);
    }
  }

  async listPaymentMethods() {
    return this.prisma.paymentMethod.findMany({
      orderBy: { code: 'asc' },
    });
  }

  async updatePaymentMethod(
    code: string,
    data: UpdatePaymentMethodDto,
    userId: string,
    ip?: string,
  ) {
    try {
      const result = await this.prisma.$transaction(async (tx: any) => {
        await tx.$queryRaw`SELECT "code" FROM "PaymentMethod" WHERE "code" = ${code} FOR UPDATE`;
        const updated = await tx.paymentMethod.update({
          where: { code },
          data,
        });
        await this.audit(tx, userId, ip, 'PAYMENT_METHOD_CONFIGURED', {
          code: updated.code,
          active: updated.active,
          changedFields: Object.keys(data),
        });
        return updated;
      });
      return result;
    } catch (error) {
      this.handleError(error);
    }
  }
}
