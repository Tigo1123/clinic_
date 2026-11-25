import {
  Injectable,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import * as actionable from '../../services/actionableNotifications.js';

export interface SendNotificationParams {
  userId: string;
  title?: string;
  message?: string;
  titleAr?: string | null;
  titleEn?: string | null;
  messageAr?: string | null;
  messageEn?: string | null;
  eventType?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  payload?: Record<string, any> | null;
  dedupeKey?: string | null;
  preferredLanguage?: string | null;
  includePatientId?: boolean;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeGateway: RealtimeGateway,
  ) {}

  private get emitFn() {
    return (userId: string, notification: any) => {
      this.realtimeGateway?.emitNotification?.(userId, notification);
    };
  }

  async getNotifications(
    userId: string,
    options: { limit?: number | string; unreadOnly?: boolean | string } = {},
  ) {
    return actionable.getUserNotifications(this.prisma, userId, options);
  }

  async markAsRead(id: string, userId: string) {
    const result = await actionable.markNotificationAsRead(this.prisma, id, userId);
    if (!result) {
      throw new HttpException(
        { error: 'Notification not found.' },
        HttpStatus.NOT_FOUND,
      );
    }
    return result;
  }

  async markAllAsRead(userId: string) {
    return actionable.markAllNotificationsAsRead(this.prisma, userId);
  }

  async sendNotification(params: SendNotificationParams) {
    return actionable.createAndEmitNotification(this.prisma, this.emitFn, params);
  }

  async notifyAppointmentBooked(params: { appointment: any; source?: string }) {
    return actionable.notifyAppointmentBooked(this.prisma, this.emitFn, params);
  }

  async notifyAppointmentConfirmed(params: { appointment: any }) {
    return actionable.notifyAppointmentConfirmed(this.prisma, this.emitFn, params);
  }

  async notifyPatientCheckedIn(params: {
    appointment: any;
    transferred?: boolean;
    emergencyOverride?: boolean;
    overrideOnlyDoctor?: boolean;
  }) {
    return actionable.notifyPatientCheckedIn(this.prisma, this.emitFn, params);
  }

  async notifyAppointmentCancelled(params: {
    appointment: any;
    previousStatus?: string | null;
    actorUserId?: string | null;
    actorRole?: string | null;
  }) {
    return actionable.notifyAppointmentCancelled(this.prisma, this.emitFn, params);
  }

  async notifyAppointmentRescheduled(params: {
    appointment: any;
    previousDoctorId?: string | null;
    previousStatus?: string | null;
    actorUserId?: string | null;
  }) {
    return actionable.notifyAppointmentRescheduled(this.prisma, this.emitFn, params);
  }

  async notifyConsultationStarted(params: { appointment: any }) {
    return actionable.notifyConsultationStarted(this.prisma, this.emitFn, params);
  }

  async notifyConsultationCompleted(params: {
    appointmentId: string;
    doctorId?: string | null;
    patientId: string;
    appointmentDate?: string | null;
  }) {
    return actionable.notifyConsultationCompleted(this.prisma, this.emitFn, params);
  }

  async notifyLabOrdered(params: {
    labOrder: any;
    appointmentId?: string | null;
    appointmentDate?: string | null;
    hasCustomTestsPendingReview?: boolean;
  }) {
    return actionable.notifyLabOrdered(this.prisma, this.emitFn, params);
  }

  async notifyLabOrderPaid(params: {
    labOrderId: string;
    appointmentId?: string | null;
    doctorId?: string | null;
    patientId?: string | null;
    appointmentDate?: string | null;
  }) {
    return actionable.notifyLabOrderPaid(this.prisma, this.emitFn, params);
  }

  async notifyLabResultReadyToDoctor(params: {
    labOrderId: string;
    appointmentId?: string | null;
    doctorId?: string | null;
    patientId?: string | null;
    appointmentDate?: string | null;
  }) {
    return actionable.notifyLabResultReadyToDoctor(this.prisma, this.emitFn, params);
  }

  async notifyLabResultReleasedToPatient(params: {
    labOrderId: string;
    appointmentId?: string | null;
    doctorId?: string | null;
    patientId?: string | null;
    appointmentDate?: string | null;
  }) {
    return actionable.notifyLabResultReleasedToPatient(this.prisma, this.emitFn, params);
  }

  async notifyLabPricingRequired(params: { labOrderId: string; serviceId: string }) {
    return actionable.notifyLabPricingRequired(this.prisma, this.emitFn, params);
  }

  async notifyPrescriptionReady(params: {
    prescription: any;
    appointmentId?: string | null;
    appointmentDate?: string | null;
    needsReview?: boolean;
  }) {
    return actionable.notifyPrescriptionReady(this.prisma, this.emitFn, params);
  }

  async notifyPharmacyPaymentRecorded(params: {
    prescriptionId: string;
    invoiceId: string;
    patientId?: string | null;
    doctorId?: string | null;
    appointmentId?: string | null;
    actorUserId?: string | null;
  }) {
    return actionable.notifyPharmacyPaymentRecorded(this.prisma, this.emitFn, params);
  }

  async notifyPrescriptionDispensed(params: {
    prescriptionId: string;
    patientId?: string | null;
    doctorId?: string | null;
    appointmentId?: string | null;
    prescriptionStatus?: string;
    totalDispensedAfter?: number;
  }) {
    return actionable.notifyPrescriptionDispensed(this.prisma, this.emitFn, params);
  }

  async notifyPharmacyMedicationExternal(params: {
    prescribedDrugId: string;
    prescriptionId: string;
    patientId?: string | null;
    doctorId?: string | null;
    appointmentId?: string | null;
  }) {
    return actionable.notifyPharmacyMedicationExternal(this.prisma, this.emitFn, params);
  }

  async notifyPharmacyPricingRequired(params: { prescriptionId: string; drugId: string }) {
    return actionable.notifyPharmacyPricingRequired(this.prisma, this.emitFn, params);
  }

  async notifyPharmacyInvoiceReady(params: {
    prescriptionId: string;
    invoiceId: string;
    patientId?: string | null;
    doctorId?: string | null;
    appointmentId?: string | null;
  }) {
    return actionable.notifyPharmacyInvoiceReady(this.prisma, this.emitFn, params);
  }
}
