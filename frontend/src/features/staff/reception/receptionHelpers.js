export const APPOINTMENT_STATUS_LABELS = {
  PENDING: {
    ar: 'قيد المراجعة',
    en: 'Pending'
  },
  SCHEDULED: {
    ar: 'مجدول',
    en: 'Scheduled'
  },
  CONFIRMED: {
    ar: 'مؤكد',
    en: 'Confirmed'
  },
  CHECKED_IN: {
    ar: 'بانتظار الطبيب',
    en: 'Waiting for Doctor'
  },
  IN_CONSULTATION: {
    ar: 'داخل العيادة',
    en: 'In Consultation'
  },
  WAITING_LAB: {
    ar: 'بانتظار المختبر',
    en: 'Waiting for Lab'
  },
  COMPLETED: {
    ar: 'مكتمل',
    en: 'Completed'
  },
  CANCELLED: {
    ar: 'ملغي',
    en: 'Cancelled'
  },
  NO_SHOW: {
    ar: 'لم يحضر',
    en: 'No Show'
  }
};

export function getAppointmentStatusLabel(status, lang) {
  const labels = APPOINTMENT_STATUS_LABELS[status];

  if (!labels) {
    return status?.replaceAll('_', ' ') || '-';
  }

  return lang === 'ar' ? labels.ar : labels.en;
}

export function queueRowStatusStyles(status) {
  switch (status) {
    case 'SCHEDULED':
    case 'CONFIRMED':
      return { '--queue-accent': '#9ca3af', background: 'rgba(156, 163, 175, 0.05)' };
    case 'CHECKED_IN':
      return { '--queue-accent': 'var(--warning)', background: 'rgba(245, 158, 11, 0.08)' };
    case 'IN_CONSULTATION':
      return { '--queue-accent': 'var(--primary)', background: 'rgba(20, 184, 166, 0.08)' };
    case 'COMPLETED':
      return { '--queue-accent': 'var(--success)', background: 'rgba(16, 185, 129, 0.08)' };
    default:
      return { '--queue-accent': 'var(--border-color)' };
  }
}

export const PATIENT_NAME_FIELDS = ['firstNameAr', 'fatherNameAr', 'grandfatherNameAr', 'familyNameAr', 'firstNameEn', 'fatherNameEn', 'grandfatherNameEn', 'familyNameEn'];

export function createEmptyPatientName() {
  return { firstNameAr: '', fatherNameAr: '', grandfatherNameAr: '', familyNameAr: '', firstNameEn: '', fatherNameEn: '', grandfatherNameEn: '', familyNameEn: '' };
}

// Returns the ISO date (YYYY-MM-DD) shifted by `days`, or null when the input date is invalid.
export function shiftQueueDate(isoDate, days) {
  const nextDate = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(nextDate.getTime())) return null;
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate.toISOString().slice(0, 10);
}

// Sums service fees (BigInt, integer SDG only) for the services currently added to an invoice.
export function calculateInvoiceTotals(services) {
  return {
    totalSdg: services.reduce((sum, service) => {
      const price = String(service.baseFeeSdg ?? '');
      return /^\d+$/.test(price) && Number.isSafeInteger(service.qty) ? sum + BigInt(price) * BigInt(service.qty) : sum;
    }, 0n)
  };
}
