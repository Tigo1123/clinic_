import prisma from '../db.js';
import { logger } from '../utils/logger.js';

export const NOTIFICATION_CHANNEL = 'clinic_notifications_v1';
export const INVENTORY_CHANNEL = 'clinic_inventory_v1';

// New notices never embed patient names, results, diagnoses or audit details.
// Entity access remains subject to the destination API's authorization.
const titles = {
  PATIENT_REGISTERED: ['New patient registered', 'تم تسجيل مريض جديد', 'reception'],
  APPOINTMENT_BOOKED: ['New appointment', 'موعد جديد', 'appointments'],
  APPOINTMENT_CHANGED: ['Appointment updated', 'تم تحديث موعد', 'appointments'],
  PATIENT_READY: ['Patient checked in', 'تم تسجيل وصول مريض', 'appointments'],
  PRESCRIPTION_READY: ['New prescription for pharmacy', 'وصفة جديدة للصيدلية', 'prescriptions'],
  PRESCRIPTION_UPDATED: ['Prescription updated', 'تم تحديث وصفة', 'prescriptions'],
  MEDICATION_REVIEW_REQUIRED: ['Medication review required', 'مطلوب مراجعة دواء', 'prescriptions'],
  LAB_ORDER_PAID: ['Paid laboratory order ready', 'طلب مختبر مدفوع جاهز', 'laboratory'],
  LAB_RESULT_ENTRY_REQUIRED: ['Laboratory result entry required', 'مطلوب إدخال نتائج المختبر', 'laboratory'],
  LAB_RESULTS_COMPLETED: ['Laboratory results completed', 'اكتملت نتائج المختبر', 'laboratory'],
  LAB_RESULTS_RELEASED: ['Laboratory results released', 'تم إصدار نتائج المختبر', 'laboratory'],
  LAB_REVIEW_REQUIRED: ['Laboratory test review required', 'مطلوب مراجعة فحص مختبر', 'laboratory'],
  LAB_REVIEW_UPDATED: ['Laboratory test review updated', 'تم تحديث مراجعة فحص مختبر', 'laboratory'],
  LAB_BILLING_REQUIRED: ['Laboratory billing required', 'مطلوب فوترة طلب مختبر', 'billing'],
  MEDICINE_PRICING_REQUIRED: ['Medicine pricing or activation required', 'مطلوب تسعير أو تفعيل دواء', 'catalog'],
  MEDICINE_UPDATED: ['Medicine catalog updated', 'تم تحديث دليل الأدوية', 'catalog'],
  SERVICE_PRICING_REQUIRED: ['Service pricing or activation required', 'مطلوب تسعير أو تفعيل خدمة', 'catalog'],
  SERVICE_CATALOG_UPDATED: ['Service catalog updated', 'تم تحديث دليل الخدمات', 'catalog'],
  PAYMENT_REQUIRED: ['Payment action required', 'مطلوب إجراء دفع', 'billing'],
  PAYMENT_UPDATED: ['Payment status updated', 'تم تحديث حالة الدفع', 'billing'],
  INSURANCE_ACTION: ['Insurance claim updated', 'تم تحديث مطالبة تأمين', 'billing'],
  SCHEDULE_CHANGED: ['Doctor schedule updated', 'تم تحديث جدول طبيب', 'appointments'],
  STAFF_SECURITY_CHANGED: ['Staff account security updated', 'تم تحديث أمان حساب موظف', 'security'],
  STOCK_LOW: ['Medicine stock is low', 'مخزون دواء منخفض', 'inventory'],
  STOCK_OUT: ['Medicine is out of stock', 'نفد مخزون دواء', 'inventory'],
  BATCH_NEAR_EXPIRY: ['Medicine batch approaching expiry', 'دفعة دواء تقترب من انتهاء الصلاحية', 'inventory'],
  BATCH_EXPIRED: ['Medicine batch has expired', 'انتهت صلاحية دفعة دواء', 'inventory']
};

export function notificationDto(row) {
  const localized = titles[row.type];
  // Legacy/custom rows have no structured translations. Never use their
  // persisted (often English-only) free text as the Arabic copy.
  const fallbackEn = row.title || 'Operational update';
  const fallbackAr = 'تحديث تشغيلي';
  return {
    id: row.id, type: row.type, entityType: row.entityType, entityId: row.entityId,
    isRead: row.isRead, createdAt: row.createdAt,
    title: localized?.[0] || fallbackEn, message: 'Open the relevant workspace to review this update.',
    titleEn: localized?.[0] || fallbackEn, titleAr: localized?.[1] || fallbackAr,
    messageEn: 'Open the relevant workspace to review this update.',
    messageAr: 'افتح مساحة العمل المعنية لمراجعة هذا التحديث.',
    topic: localized?.[2] || null
  };
}

export class NotificationDelivery {
  constructor(io, { prismaClient = prisma, onInventoryChanged = () => {} } = {}) {
    this.io = io; this.prisma = prismaClient; this.onInventoryChanged = onInventoryChanged;
    this.pending = new Map(); this.inventoryChanged = false; this.scheduled = null; this.flushing = false;
  }

  receive(channel, payload) {
    if (channel === INVENTORY_CHANNEL) {
      if (typeof payload !== 'string' || !/^[\w-]{1,100}$/.test(payload)) return;
      this.inventoryChanged = true;
    } else if (channel === NOTIFICATION_CHANNEL) {
      let event;
      try { event = JSON.parse(payload); } catch { return; }
      if (!event || typeof event.id !== 'string' || event.id.length > 100 || !['created', 'read'].includes(event.change)) return;
      if (this.pending.get(event.id) !== 'created') this.pending.set(event.id, event.change);
    } else return;
    if (!this.scheduled && !this.flushing) this.scheduled = setImmediate(() => {
      this.scheduled = null;
      this.flush().catch(error => logger.error('notification.delivery_failed', { error }));
    });
  }

  async flush() {
    this.flushing = true;
    try {
      while (this.pending.size || this.inventoryChanged) {
        if (this.inventoryChanged) {
          this.inventoryChanged = false;
          // Local rooms: each API instance receives the same PG commit signal.
          this.io.local.to('role_PHARMACIST').to('role_ADMIN').emit('workflowUpdated', { topic: 'inventory' });
          this.onInventoryChanged();
        }
        const events = new Map([...this.pending].slice(0, 200));
        for (const id of events.keys()) this.pending.delete(id);
        if (!events.size) continue;
        const rows = await this.prisma.notification.findMany({ where: { id: { in: [...events.keys()] } }, select: { id: true, userId: true, type: true, createdAt: true, isRead: true } });
        const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map(row => row.userId))] }, status: 'ACTIVE' }, select: { id: true } });
        const active = new Set(users.map(user => user.id)); const sent = new Set();
        for (const row of rows) {
          if (!active.has(row.userId)) continue;
          const target = this.io.local.to(`user_${row.userId}`);
          const event = events.get(row.id) === 'created' ? 'notification' : 'notifications:changed';
          const key = `${row.userId}:${event}`;
          if (event === 'notification') {
            // Keep the existing creation payload usable by already-open clients.
            // All text is static and safe; new clients still refetch the API.
            target.emit(event, {
              id: row.id, type: row.type, title: titles[row.type]?.[0] || 'Operational update',
              message: 'Open the relevant workspace to review this update.',
              createdAt: row.createdAt, isRead: row.isRead
            });
          } else if (!sent.has(key)) { target.emit(event, { id: row.id }); sent.add(key); }
          const topic = events.get(row.id) === 'created' && titles[row.type]?.[2];
          if (topic && !sent.has(`${row.userId}:${topic}`)) {
            target.emit('workflowUpdated', { topic }); sent.add(`${row.userId}:${topic}`);
          }
        }
      }
    } finally { this.flushing = false; }
  }

  stop() {
    if (this.scheduled) clearImmediate(this.scheduled);
    this.scheduled = null; this.pending.clear(); this.inventoryChanged = false;
  }

  recover() {
    // A short PG listener outage can leave transports connected. Reconcile
    // their views after LISTEN and authVersion reconciliation are ready again.
    for (const socket of this.io.of('/').sockets.values()) {
      if (!socket.user?.id) continue;
      socket.emit('notifications:changed', {});
      socket.emit('workflowUpdated', { topic: 'reconnected' });
    }
  }
}
