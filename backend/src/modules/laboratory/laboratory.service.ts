import {
  Injectable,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';

@Injectable()
export class LaboratoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeGateway: RealtimeGateway,
  ) {}

  async getPendingReviews() {
    return this.prisma.labOrderItem.findMany({
      where: { labReviewStatus: 'PENDING_REVIEW', serviceId: null },
      select: {
        id: true,
        customTestName: true,
        labOrder: {
          select: {
            id: true,
            orderDate: true,
            status: true,
            patient: { select: { id: true, fullNameAr: true, fullNameEn: true } },
            doctor: { select: { id: true, fullNameAr: true, fullNameEn: true } },
          },
        },
      },
      orderBy: { labOrder: { orderDate: 'asc' } },
    });
  }

  async reviewItem(id: string, body: any, user: any, ip?: string) {
    const decision = typeof body?.decision === 'string' ? body.decision.trim().toUpperCase() : '';
    const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null;
    const allowed = ['LINK_EXISTING', 'CREATE_SERVICE', 'EXTERNAL'];
    if (!allowed.includes(decision)) {
      throw new HttpException(
        { code: 'LAB_REVIEW_DECISION_INVALID', message: 'decision must be LINK_EXISTING, CREATE_SERVICE, or EXTERNAL.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const normalizeName = (value: any) => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');

    const result = await this.prisma.$transaction(async (tx: any) => {
      const item = await tx.labOrderItem.findUnique({
        where: { id },
        include: { labOrder: { select: { id: true, status: true, medicalRecord: { select: { appointmentId: true } } } } },
      });

      if (!item) {
        throw new HttpException(
          { code: 'LAB_ORDER_ITEM_NOT_FOUND', message: 'Laboratory order item was not found.' },
          HttpStatus.NOT_FOUND,
        );
      }
      if (item.labReviewStatus !== 'PENDING_REVIEW') {
        throw new HttpException(
          { code: 'LAB_TEST_ALREADY_REVIEWED', message: 'This laboratory test is no longer awaiting review.' },
          HttpStatus.CONFLICT,
        );
      }
      if (item.serviceId || !item.customTestName?.trim()) {
        throw new HttpException(
          { code: 'LAB_REVIEW_STATE_INVALID', message: 'Only unresolved custom laboratory tests can be reviewed.' },
          HttpStatus.CONFLICT,
        );
      }
      if (item.labOrder.status !== 'PENDING_BILLING') {
        throw new HttpException(
          { code: 'LAB_REVIEW_ORDER_STATE_INVALID', message: 'This laboratory order can no longer be reviewed.' },
          HttpStatus.CONFLICT,
        );
      }

      let service: any = null;
      if (decision === 'LINK_EXISTING') {
        const serviceId = typeof body?.serviceId === 'string' ? body.serviceId.trim() : '';
        if (!serviceId) {
          throw new HttpException(
            { code: 'LAB_SERVICE_ID_REQUIRED', message: 'serviceId is required when linking an existing service.' },
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        service = await tx.clinicalService.findUnique({ where: { id: serviceId } });
        if (!service || service.category !== 'LABORATORY') {
          throw new HttpException(
            { code: 'LAB_SERVICE_NOT_FOUND', message: 'The selected laboratory service was not found.' },
            HttpStatus.NOT_FOUND,
          );
        }
        const price = Number(service.baseFeeSdg);
        if (service.status !== 'ACTIVE' || !Number.isSafeInteger(price) || price <= 0 || price > 1_000_000_000) {
          throw new HttpException(
            { code: 'LAB_SERVICE_PRICE_NOT_CONFIGURED', message: 'The selected service must be active with a valid configured price.' },
            HttpStatus.CONFLICT,
          );
        }
      }

      if (decision === 'CREATE_SERVICE') {
        const form = body?.service || {};
        const labelEn = typeof form.labelEn === 'string' ? form.labelEn.trim() : '';
        const labelAr = typeof form.labelAr === 'string' ? form.labelAr.trim() : '';
        if (!labelEn || !labelAr || labelEn.length > 150 || labelAr.length > 150) {
          throw new HttpException(
            { code: 'LAB_SERVICE_LABELS_REQUIRED', message: 'Arabic and English service labels are required and must not exceed 150 characters.' },
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        if (Object.hasOwn(form, 'baseFeeSdg') || Object.hasOwn(form, 'baseFeeUsd')) {
          throw new HttpException(
            { code: 'LAB_PRICE_ADMIN_REQUIRED', message: 'Official laboratory prices must be configured by an administrator.' },
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }

        const normalizedEn = normalizeName(labelEn);
        const normalizedAr = normalizeName(labelAr);
        const existingServices = await tx.clinicalService.findMany({ where: { category: 'LABORATORY' } });
        const existing = existingServices.find(
          (candidate: any) => normalizeName(candidate.labelEn) === normalizedEn || normalizeName(candidate.labelAr) === normalizedAr,
        );
        if (existing) {
          throw new HttpException(
            { code: 'LAB_SERVICE_ALREADY_EXISTS', message: 'A laboratory service with the same normalized name already exists. Link the existing service instead.' },
            HttpStatus.CONFLICT,
          );
        }

        service = await tx.clinicalService.create({
          data: {
            labelAr,
            labelEn,
            baseFeeSdg: null,
            baseFeeUsd: null,
            category: 'LABORATORY',
            status: 'INACTIVE',
          },
        });
      }

      const nextStatus = decision === 'EXTERNAL' ? 'EXTERNAL' : 'APPROVED';
      const claimed = await tx.labOrderItem.updateMany({
        where: { id: item.id, labReviewStatus: 'PENDING_REVIEW', serviceId: null },
        data: {
          serviceId: service?.id || null,
          labReviewStatus: nextStatus,
          labReviewedAt: new Date(),
          labReviewNote: note,
        },
      });

      if (claimed.count !== 1) {
        throw new HttpException(
          { code: 'LAB_REVIEW_CONFLICT', message: 'This laboratory test was already reviewed by another lab technician.' },
          HttpStatus.CONFLICT,
        );
      }

      let returnedAppointmentId: string | null = null;
      if (decision === 'EXTERNAL') {
        const remainingClinicItems = await tx.labOrderItem.count({
          where: { labOrderId: item.labOrderId, labReviewStatus: { not: 'EXTERNAL' } },
        });
        if (remainingClinicItems === 0) {
          await tx.labOrder.update({ where: { id: item.labOrderId }, data: { status: 'COMPLETED' } });
          returnedAppointmentId = item.labOrder.medicalRecord?.appointmentId || null;
          if (returnedAppointmentId) {
            await tx.appointment.updateMany({
              where: { id: returnedAppointmentId, status: 'WAITING_LAB' },
              data: { status: 'IN_CONSULTATION' },
            });
          }
        }
      }

      await tx.tenantAuditLog.create({
        data: {
          userId: user.id,
          action: `LAB_CUSTOM_TEST_${decision}:${item.id}`,
          details: JSON.stringify({
            labOrderItemId: item.id,
            labOrderId: item.labOrderId,
            customTestName: item.customTestName,
            serviceId: service?.id || null,
            decision,
            note,
            returnedAppointmentId,
          }),
          ipAddress: ip || '127.0.0.1',
        },
      });

      const updated = await tx.labOrderItem.findUnique({
        where: { id: item.id },
        include: { service: true },
      });

      return {
        decision,
        item: updated,
        service,
        returnedAppointmentId,
      };
    });

    // Same realtime events as Express (src/routes/records.js POST /lab-order-items/:itemId/review).
    this.realtimeGateway.emitQueueUpdate(
      { type: 'LAB_REVIEW_RESOLVED', labOrderItemId: result.item.id, labOrderId: result.item.labOrderId, decision: result.decision },
      [],
    );
    if (result.returnedAppointmentId) {
      this.realtimeGateway.emitQueueUpdate(
        { type: 'LAB_RESULTS_COMPLETED', appointmentId: result.returnedAppointmentId, status: 'IN_CONSULTATION' },
        [],
      );
    }
    return result;
  }

  async getPendingOrders() {
    return this.prisma.labOrder.findMany({
      where: {
        OR: [
          { status: { in: ['PENDING_BILLING', 'PAID', 'SAMPLE_COLLECTED'] } },
          { status: 'COMPLETED', releasedToPatientAt: null },
        ],
      },
      include: {
        patient: true,
        doctor: true,
        items: { include: { service: true } },
      },
      orderBy: { orderDate: 'desc' },
    });
  }

  async getOrderHistory() {
    return this.prisma.labOrder.findMany({
      where: {
        status: 'COMPLETED',
        releasedToPatientAt: { not: null },
      },
      select: {
        id: true,
        orderDate: true,
        status: true,
        releasedToPatientAt: true,
        patient: { select: { fullNameAr: true, fullNameEn: true, fileNumber: true } },
        doctor: { select: { fullNameAr: true, fullNameEn: true } },
        items: {
          select: {
            id: true,
            customTestName: true,
            labReviewStatus: true,
            resultValue: true,
            referenceRangeMin: true,
            referenceRangeMax: true,
            isOutOfRange: true,
            resultVersion: true,
            service: { select: { labelAr: true, labelEn: true } },
          },
        },
      },
      orderBy: [{ releasedToPatientAt: 'desc' }, { orderDate: 'desc' }],
      take: 100,
    });
  }

  async collectSample(id: string, user: any, ip?: string) {
    const order = await this.prisma.labOrder.findUnique({
      where: { id },
      include: { patient: true, items: { select: { labReviewStatus: true } } },
    });

    if (!order) {
      throw new HttpException(
        { code: 'LAB_ORDER_NOT_FOUND', message: 'Laboratory order not found.' },
        HttpStatus.NOT_FOUND,
      );
    }

    if (order.items.some((item: any) => item.labReviewStatus === 'PENDING_REVIEW')) {
      throw new HttpException(
        { code: 'LAB_REVIEW_PENDING', message: 'Custom laboratory tests must be reviewed before sample collection.' },
        HttpStatus.CONFLICT,
      );
    }

    if (order.status === 'PENDING_BILLING') {
      throw new HttpException(
        { code: 'LAB_PAYMENT_REQUIRED', message: 'Laboratory work cannot start until the laboratory invoice is fully paid.' },
        HttpStatus.FORBIDDEN,
      );
    }

    if (order.status === 'SAMPLE_COLLECTED') {
      return { ...order, idempotentReplay: true };
    }

    if (order.status !== 'PAID') {
      throw new HttpException(
        { code: 'LAB_SAMPLE_COLLECTION_INVALID_STATE', message: 'Sample collection is only available for fully paid laboratory orders.' },
        HttpStatus.CONFLICT,
      );
    }

    return this.prisma.$transaction(async (tx: any) => {
      const claimed = await tx.labOrder.updateMany({
        where: { id: order.id, status: 'PAID' },
        data: { status: 'SAMPLE_COLLECTED' },
      });

      if (claimed.count !== 1) {
        throw new HttpException(
          { code: 'LAB_SAMPLE_COLLECTION_INVALID_STATE', message: 'Sample collection is only available for fully paid laboratory orders.' },
          HttpStatus.CONFLICT,
        );
      }

      await tx.tenantAuditLog.create({
        data: {
          userId: user.id,
          action: 'LAB_SAMPLE_COLLECTED',
          details: `Collected sample for lab order ${order.id}.`,
          ipAddress: ip || 'unknown',
        },
      });

      return tx.labOrder.findUnique({ where: { id: order.id }, include: { patient: true } });
    });
  }

  async logResults(id: string, body: any, user: any, ip?: string) {
    const { expectedVersion, resultValue, referenceRangeMin, referenceRangeMax, isOutOfRange, fileAttachmentPath } = body;

    const result = await this.prisma.$transaction(async (tx: any) => {
      const existingItem = await tx.labOrderItem.findUnique({
        where: { id },
        include: {
          labOrder: {
            include: {
              medicalRecord: { select: { appointmentId: true } },
            },
          },
        },
      });

      if (!existingItem) {
        throw new HttpException(
          { code: 'LAB_ORDER_ITEM_NOT_FOUND', message: 'Laboratory order item not found.' },
          HttpStatus.NOT_FOUND,
        );
      }

      if (existingItem.labOrder.status === 'PENDING_BILLING') {
        throw new HttpException(
          { code: 'LAB_PAYMENT_REQUIRED', message: 'Laboratory results cannot be entered until the laboratory invoice is fully paid.' },
          HttpStatus.FORBIDDEN,
        );
      }

      if (existingItem.labOrder.status === 'PAID') {
        throw new HttpException(
          { code: 'LAB_SAMPLE_NOT_COLLECTED', message: 'The laboratory sample must be collected before results can be entered.' },
          HttpStatus.CONFLICT,
        );
      }

      if (existingItem.labOrder.status !== 'SAMPLE_COLLECTED' || existingItem.labOrder.releasedToPatientAt != null) {
        throw new HttpException(
          { code: 'LAB_RESULT_FINALIZED', message: 'This laboratory result is finalized and can no longer be changed.' },
          HttpStatus.CONFLICT,
        );
      }

      if (existingItem.labReviewStatus === 'EXTERNAL') {
        throw new HttpException(
          { code: 'LAB_EXTERNAL_TEST', message: 'External laboratory tests do not accept clinic results.' },
          HttpStatus.CONFLICT,
        );
      }

      if (existingItem.labReviewStatus === 'PENDING_REVIEW' || !existingItem.serviceId) {
        throw new HttpException(
          { code: 'LAB_REVIEW_PENDING', message: 'This laboratory test must be reviewed before results can be entered.' },
          HttpStatus.CONFLICT,
        );
      }

      if (existingItem.resultVersion !== expectedVersion) {
        throw new HttpException(
          { code: 'LAB_RESULT_CONFLICT', message: 'This laboratory result was changed by another user. Reload the latest result before saving.' },
          HttpStatus.CONFLICT,
        );
      }

      const updated = await tx.labOrderItem.updateMany({
        where: { id, resultVersion: expectedVersion },
        data: {
          resultValue,
          referenceRangeMin: referenceRangeMin !== undefined ? Number(referenceRangeMin) : null,
          referenceRangeMax: referenceRangeMax !== undefined ? Number(referenceRangeMax) : null,
          isOutOfRange: Boolean(isOutOfRange),
          fileAttachmentPath,
          resultVersion: { increment: 1 },
        },
      });

      if (updated.count !== 1) {
        throw new HttpException(
          { code: 'LAB_RESULT_CONFLICT', message: 'This laboratory result was changed by another user. Reload the latest result before saving.' },
          HttpStatus.CONFLICT,
        );
      }

      const item = await tx.labOrderItem.findUnique({
        where: { id },
        include: { labOrder: true },
      });

      const remainingItems = await tx.labOrderItem.count({
        where: {
          labOrderId: item.labOrderId,
          labReviewStatus: { not: 'EXTERNAL' },
          resultValue: null,
        },
      });

      let returnedAppointmentId: string | null = null;
      let returnedDoctorId: string | null = null;

      if (remainingItems === 0) {
        const completed = await tx.labOrder.updateMany({
          where: {
            id: item.labOrderId,
            status: 'SAMPLE_COLLECTED',
            releasedToPatientAt: null,
          },
          data: { status: 'COMPLETED' },
        });

        if (completed.count !== 1) {
          throw new HttpException(
            { code: 'LAB_RESULT_FINALIZED', message: 'This laboratory result is finalized and can no longer be changed.' },
            HttpStatus.CONFLICT,
          );
        }

        returnedAppointmentId = existingItem.labOrder.medicalRecord?.appointmentId || null;
        if (returnedAppointmentId) {
          const returnedToDoctor = await tx.appointment.updateMany({
            where: { id: returnedAppointmentId, status: 'WAITING_LAB' },
            data: { status: 'IN_CONSULTATION' },
          });
          if (returnedToDoctor.count === 1) returnedDoctorId = existingItem.labOrder.doctorId;
        }
      }

      await tx.tenantAuditLog.create({
        data: {
          userId: user.id,
          action: 'LAB_RESULTS_LOGGED',
          details: JSON.stringify({ labOrderItemId: item.id, labOrderId: item.labOrderId, resultVersion: item.resultVersion }),
          ipAddress: ip || '127.0.0.1',
        },
      });

      return { item, returnedAppointmentId, returnedDoctorId };
    });

    if (result.returnedAppointmentId && result.returnedDoctorId) {
      this.realtimeGateway.emitQueueUpdate(
        {
          type: 'LAB_RESULTS_COMPLETED',
          appointmentId: result.returnedAppointmentId,
          doctorId: result.returnedDoctorId,
          status: 'IN_CONSULTATION',
        },
        [result.returnedDoctorId],
      );
    }

    return result.item;
  }

  async releaseResults(id: string, user: any, ip?: string) {
    return this.prisma.$transaction(async (tx: any) => {
      const order = await tx.labOrder.findUnique({ where: { id } });
      if (!order) {
        throw new HttpException(
          { code: 'LAB_ORDER_NOT_FOUND', message: 'Lab order not found.' },
          HttpStatus.NOT_FOUND,
        );
      }
      if (order.status !== 'COMPLETED') {
        throw new HttpException(
          { code: 'LAB_ORDER_NOT_COMPLETE', message: 'Only completed lab orders can be released.' },
          HttpStatus.CONFLICT,
        );
      }
      if (order.releasedToPatientAt != null) {
        return { id: order.id, releasedToPatientAt: order.releasedToPatientAt, idempotentReplay: true };
      }

      const updated = await tx.labOrder.update({
        where: { id: order.id },
        data: { releasedToPatientAt: new Date() },
      });

      await tx.tenantAuditLog.create({
        data: {
          userId: user.id,
          action: 'LAB_RESULTS_RELEASED_TO_PATIENT',
          details: `Released lab order ${order.id} to patient.`,
          ipAddress: ip || 'unknown',
        },
      });

      return {
        id: updated.id,
        releasedToPatientAt: updated.releasedToPatientAt,
        idempotentReplay: false,
      };
    });
  }
}
