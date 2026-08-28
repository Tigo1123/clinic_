import { CLINIC_TIME_ZONE } from './clinicTime.js';

export const AUDIT_EVENT_PRESENTATION = Object.freeze({
  USER_STATUS_CHANGE: ['auditEventUserStatusChange', 'warning'],
  USER_CREATION: ['auditEventStaffCreated', 'success'],
  STAFF_PASSWORD_RESET_BY_ADMIN: ['auditEventStaffPasswordReset', 'warning'],
  MFA_ENABLED: ['auditEventMfaEnabled', 'success'],
  MFA_DISABLED: ['auditEventMfaDisabled', 'danger'],
  MFA_RECOVERY_CODES_REGENERATED: ['auditEventMfaReset', 'warning'],
  CLINICAL_SERVICE_PRICE_UPDATED: ['auditEventPriceUpdated', 'info'],
  DOCTOR_CONSULTATION_PRICE_UPDATED: ['auditEventPriceUpdated', 'info'],
  MEDICINE_SELLING_PRICE_UPDATED: ['auditEventPriceUpdated', 'info'],
  FORMULARY_MEDICINE_CREATED: ['auditEventMedicineCreated', 'success'],
  FORMULARY_METADATA_UPDATED: ['auditEventMedicineUpdated', 'info'],
  INVENTORY_BATCH_RECEIVED: ['auditEventBatchReceived', 'success'],
  LAB_RESULTS_LOGGED: ['auditEventLabResultLogged', 'info'],
  LAB_RESULTS_RELEASED_TO_PATIENT: ['auditEventLabResultReleased', 'warning'],
  LAB_SAMPLE_COLLECTED: ['auditEventLabSampleCollected', 'info'],
  APPOINTMENT_STATUS_UPDATED: ['auditEventAppointmentUpdated', 'info'],
  INVOICE_REFUND: ['auditEventInvoiceRefund', 'warning'],
  SHIFT_RECONCILIATION: ['auditEventShiftReconciliation', 'neutral']
});

export function auditEventPresentation(action = '') {
  if (action.startsWith('EMR_BREAK_THE_GLASS_BYPASS')) return { labelKey: 'auditEventEmergencyAccess', tone: 'danger' };
  const [labelKey, tone] = AUDIT_EVENT_PRESENTATION[action] || [];
  return { labelKey: labelKey || null, tone: tone || 'neutral' };
}

export function auditEventFallback(action = '') {
  return action ? action.replaceAll('_', ' ') : '—';
}

export function formatAuditDateTime(timestamp, lang) {
  const instant = new Date(timestamp);
  if (Number.isNaN(instant.getTime())) return { date: '—', time: '—', precise: '—' };
  const locale = lang === 'ar' ? 'ar' : 'en-GB';
  return {
    date: new Intl.DateTimeFormat(locale, { timeZone: CLINIC_TIME_ZONE, day: 'numeric', month: 'long', year: 'numeric' }).format(instant),
    time: new Intl.DateTimeFormat(locale, { timeZone: CLINIC_TIME_ZONE, hour: 'numeric', minute: '2-digit' }).format(instant),
    precise: new Intl.DateTimeFormat(locale, {
      timeZone: CLINIC_TIME_ZONE, dateStyle: 'full', timeStyle: 'long'
    }).format(instant)
  };
}

export function actorDisplayName(actor, lang) {
  if (!actor) return null;
  return (lang === 'ar' ? actor.displayNameAr : actor.displayNameEn)
    || actor.displayNameAr || actor.displayNameEn || null;
}

export function shortTechnicalId(value) {
  if (!value) return '—';
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}

export function auditDetailSummary(details, lang) {
  if (!details) return '—';
  try {
    const value = JSON.parse(details);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return details;
    if (typeof value.previousStatus === 'string' && typeof value.status === 'string') {
      const statuses = lang === 'ar'
        ? { ACTIVE: 'نشط', INACTIVE: 'غير نشط', PENDING: 'قيد الانتظار', COMPLETED: 'مكتمل', CANCELLED: 'ملغي' }
        : { ACTIVE: 'Active', INACTIVE: 'Inactive', PENDING: 'Pending', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };
      return `${statuses[value.previousStatus] || value.previousStatus} → ${statuses[value.status] || value.status}`;
    }
    return Object.entries(value).map(([key, item]) => `${key}: ${item}`).join(' · ') || '—';
  } catch {
    return details;
  }
}
