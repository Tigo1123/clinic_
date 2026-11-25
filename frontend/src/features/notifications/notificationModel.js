export const NOTIFICATION_EVENTS = Object.freeze({
  APPOINTMENT_BOOKED: 'APPOINTMENT_BOOKED',
  APPOINTMENT_CONFIRMED: 'APPOINTMENT_CONFIRMED',
  PATIENT_CHECKED_IN: 'PATIENT_CHECKED_IN',
  LAB_ORDERED: 'LAB_ORDERED',
  LAB_RESULT_READY: 'LAB_RESULT_READY',
  PRESCRIPTION_READY: 'PRESCRIPTION_READY',
  APPOINTMENT_CANCELLED: 'APPOINTMENT_CANCELLED',
  APPOINTMENT_RESCHEDULED: 'APPOINTMENT_RESCHEDULED',
  CONSULTATION_STARTED: 'CONSULTATION_STARTED',
  CONSULTATION_COMPLETED: 'CONSULTATION_COMPLETED',
  LAB_ORDER_PAID: 'LAB_ORDER_PAID',
  LAB_PRICING_REQUIRED: 'LAB_PRICING_REQUIRED',
  PHARMACY_PAYMENT_RECORDED: 'PHARMACY_PAYMENT_RECORDED',
  PRESCRIPTION_DISPENSED: 'PRESCRIPTION_DISPENSED',
  PHARMACY_MEDICATION_EXTERNAL: 'PHARMACY_MEDICATION_EXTERNAL',
  PHARMACY_PRICING_REQUIRED: 'PHARMACY_PRICING_REQUIRED',
  PHARMACY_INVOICE_READY: 'PHARMACY_INVOICE_READY'
});

export const NOTIFICATION_TARGET_TYPES = Object.freeze({
  APPOINTMENT: 'appointment',
  LAB_ORDER: 'labOrder',
  PRESCRIPTION: 'prescription',
  SERVICE_PRICING: 'servicePricing',
  MEDICINE_PRICING: 'medicinePricing'
});

const KNOWN_EVENTS = new Set(Object.values(NOTIFICATION_EVENTS));
const KNOWN_TARGETS = new Set(Object.values(NOTIFICATION_TARGET_TYPES));

export function isArabicLanguage(lang) {
  return String(lang || 'ar').toLowerCase().startsWith('ar');
}

export function parseNotificationPayload(rawPayload) {
  if (!rawPayload) return {};
  if (typeof rawPayload === 'object' && !Array.isArray(rawPayload)) {
    return { ...rawPayload };
  }
  if (typeof rawPayload === 'string') {
    const trimmed = rawPayload.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return {};
    }
  }
  return {};
}

export function normalizeNotification(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id != null ? String(raw.id) : '';
  if (!id) return null;

  const eventType = typeof raw.eventType === 'string' && raw.eventType.trim()
    ? raw.eventType.trim()
    : null;
  const targetType = typeof raw.targetType === 'string' && raw.targetType.trim()
    ? raw.targetType.trim()
    : null;
  const targetId = typeof raw.targetId === 'string' && raw.targetId.trim()
    ? raw.targetId.trim()
    : null;

  return {
    id,
    userId: raw.userId != null ? String(raw.userId) : null,
    title: typeof raw.title === 'string' ? raw.title : '',
    message: typeof raw.message === 'string' ? raw.message : '',
    titleAr: typeof raw.titleAr === 'string' ? raw.titleAr : '',
    titleEn: typeof raw.titleEn === 'string' ? raw.titleEn : '',
    messageAr: typeof raw.messageAr === 'string' ? raw.messageAr : '',
    messageEn: typeof raw.messageEn === 'string' ? raw.messageEn : '',
    isRead: Boolean(raw.isRead),
    createdAt: raw.createdAt || new Date().toISOString(),
    eventType,
    targetType,
    targetId,
    payload: parseNotificationPayload(raw.payload)
  };
}

function compareNewestFirst(a, b) {
  const timeA = Date.parse(a?.createdAt || '') || 0;
  const timeB = Date.parse(b?.createdAt || '') || 0;
  if (timeB !== timeA) return timeB - timeA;
  return String(b?.id || '').localeCompare(String(a?.id || ''));
}

function mergeNormalizedItem(existing, incoming) {
  return {
    ...existing,
    ...incoming,
    title: incoming.title || existing.title,
    message: incoming.message || existing.message,
    titleAr: incoming.titleAr || existing.titleAr,
    titleEn: incoming.titleEn || existing.titleEn,
    messageAr: incoming.messageAr || existing.messageAr,
    messageEn: incoming.messageEn || existing.messageEn,
    eventType: incoming.eventType ?? existing.eventType,
    targetType: incoming.targetType ?? existing.targetType,
    targetId: incoming.targetId ?? existing.targetId,
    payload: { ...(existing.payload || {}), ...(incoming.payload || {}) },
    isRead: existing.isRead || incoming.isRead
  };
}

export function dedupeNotifications(items) {
  const byId = new Map();
  for (const raw of Array.isArray(items) ? items : []) {
    const normalized = normalizeNotification(raw);
    if (!normalized) continue;
    const existing = byId.get(normalized.id);
    if (existing) {
      byId.set(normalized.id, mergeNormalizedItem(existing, normalized));
    } else {
      byId.set(normalized.id, normalized);
    }
  }
  return Array.from(byId.values()).sort(compareNewestFirst);
}

export function applyIncomingSocketNotification(state, rawNotification) {
  const incoming = normalizeNotification(rawNotification);
  if (!incoming) return state;

  const list = Array.isArray(state?.notifications) ? state.notifications : [];
  const existingIndex = list.findIndex((item) => item.id === incoming.id);
  const currentUnread = Number.isFinite(state?.unreadCount) ? state.unreadCount : 0;

  if (existingIndex >= 0) {
    const existing = list[existingIndex];
    const merged = mergeNormalizedItem(existing, incoming);
    const nextList = [...list];
    nextList[existingIndex] = merged;
    nextList.sort(compareNewestFirst);

    let delta = 0;
    if (!existing.isRead && merged.isRead) delta = -1;

    return {
      notifications: nextList,
      unreadCount: Math.max(0, currentUnread + delta)
    };
  }

  return {
    notifications: [incoming, ...list].sort(compareNewestFirst),
    unreadCount: Math.max(0, currentUnread + (incoming.isRead ? 0 : 1))
  };
}

export function reconcileNotificationsSnapshot(serverData, inFlightSocketItems = [], previous = {}) {
  const serverList = dedupeNotifications(serverData?.notifications || []);
  const serverIds = new Set(serverList.map((item) => item.id));
  const extraSocketItems = dedupeNotifications(inFlightSocketItems)
    .filter((item) => !serverIds.has(item.id));
  const merged = dedupeNotifications([...serverList, ...inFlightSocketItems]);
  const knownRead = new Set(previous.notifications?.filter((item) => item.isRead).map((item) => item.id));
  const unreadBaseline = [...serverList, ...extraSocketItems];
  const baselineUnreadIds = new Set(unreadBaseline.filter((item) => !item.isRead).map((item) => item.id));
  const notifications = merged.map((item) => knownRead.has(item.id) ? { ...item, isRead: true } : item);
  const staleUnread = notifications.filter((item) => item.isRead && baselineUnreadIds.has(item.id)).length;
  const serverUnread = Number.isFinite(serverData?.unreadCount)
    ? serverData.unreadCount
    : serverList.filter((item) => !item.isRead).length;
  const extraUnread = extraSocketItems.filter((item) => !item.isRead).length;
  return { notifications, unreadCount: Math.max(0, serverUnread + extraUnread - staleUnread) };
}

export function applyMarkNotificationRead(state, id) {
  const list = Array.isArray(state?.notifications) ? state.notifications : [];
  const currentUnread = Number.isFinite(state?.unreadCount) ? state.unreadCount : 0;
  let decremented = false;

  const nextList = list.map((item) => {
    if (item.id !== id) return item;
    if (!item.isRead) decremented = true;
    return { ...item, isRead: true };
  });

  return {
    notifications: nextList,
    unreadCount: decremented ? Math.max(0, currentUnread - 1) : currentUnread
  };
}

export function applyMarkAllNotificationsRead(state) {
  const list = Array.isArray(state?.notifications) ? state.notifications : [];
  return {
    notifications: list.map((item) => (item.isRead ? item : { ...item, isRead: true })),
    unreadCount: 0
  };
}

function inferTargetType(eventType) {
  switch (eventType) {
    case NOTIFICATION_EVENTS.APPOINTMENT_BOOKED:
    case NOTIFICATION_EVENTS.APPOINTMENT_CONFIRMED:
    case NOTIFICATION_EVENTS.PATIENT_CHECKED_IN:
    case NOTIFICATION_EVENTS.APPOINTMENT_CANCELLED:
    case NOTIFICATION_EVENTS.APPOINTMENT_RESCHEDULED:
    case NOTIFICATION_EVENTS.CONSULTATION_STARTED:
    case NOTIFICATION_EVENTS.CONSULTATION_COMPLETED:
      return NOTIFICATION_TARGET_TYPES.APPOINTMENT;
    case NOTIFICATION_EVENTS.LAB_ORDERED:
    case NOTIFICATION_EVENTS.LAB_ORDER_PAID:
    case NOTIFICATION_EVENTS.LAB_RESULT_READY:
      return NOTIFICATION_TARGET_TYPES.LAB_ORDER;
    case NOTIFICATION_EVENTS.PRESCRIPTION_READY:
    case NOTIFICATION_EVENTS.PHARMACY_PAYMENT_RECORDED:
    case NOTIFICATION_EVENTS.PRESCRIPTION_DISPENSED:
    case NOTIFICATION_EVENTS.PHARMACY_MEDICATION_EXTERNAL:
    case NOTIFICATION_EVENTS.PHARMACY_INVOICE_READY:
      return NOTIFICATION_TARGET_TYPES.PRESCRIPTION;
    default:
      return null;
  }
}

export function resolveNotificationIntent(rawNotification, { role = null, doctorId = null } = {}) {
  const item = normalizeNotification(rawNotification);
  if (!item) {
    return { kind: 'mark_only', targetType: null, targetId: null, eventType: null, context: {} };
  }

  const p = item.payload || {};
  const eventType = item.eventType;
  const targetType = role === 'PATIENT' && eventType === NOTIFICATION_EVENTS.LAB_ORDERED
    ? NOTIFICATION_TARGET_TYPES.APPOINTMENT
    : item.targetType || inferTargetType(eventType);

  const appointmentId = (targetType === NOTIFICATION_TARGET_TYPES.APPOINTMENT && (!item.targetType || item.targetType === targetType) ? item.targetId : null) || p.appointmentId || null;
  const labOrderId = (targetType === NOTIFICATION_TARGET_TYPES.LAB_ORDER ? item.targetId : null) || p.labOrderId || null;
  const prescriptionId = (targetType === NOTIFICATION_TARGET_TYPES.PRESCRIPTION ? item.targetId : null) || p.prescriptionId || null;
  const resolvedTargetId = item.targetId || appointmentId || labOrderId || prescriptionId || null;

  const context = {
    appointmentId,
    doctorId: p.doctorId || null,
    appointmentDate: p.appointmentDate || null,
    appointmentTime: p.appointmentTime || null,
    patientId: p.patientId || null,
    labOrderId,
    prescriptionId,
    labOrderItemId: p.labOrderItemId || null,
    prescribedDrugId: p.prescribedDrugId || null
  };

  // Legacy text-only rows without structured target or recognized event remain readable and mark-as-read only.
  if (!eventType && (!targetType || !KNOWN_TARGETS.has(targetType)) && !resolvedTargetId) {
    return { kind: 'mark_only', targetType: null, targetId: null, eventType: null, context };
  }

  if (eventType && !KNOWN_EVENTS.has(eventType) && !resolvedTargetId) {
    return { kind: 'mark_only', targetType, targetId: null, eventType, context };
  }

  if (role === 'PATIENT') {
    if (targetType === NOTIFICATION_TARGET_TYPES.APPOINTMENT) {
      if (!appointmentId) return { kind: 'missing_target', targetType, targetId: null, eventType, context };
      return {
        kind: 'navigate',
        route: `/patient/appointments/${encodeURIComponent(appointmentId)}`,
        targetType,
        targetId: appointmentId,
        eventType,
        context
      };
    }
    if (targetType === NOTIFICATION_TARGET_TYPES.LAB_ORDER) {
      if (eventType !== NOTIFICATION_EVENTS.LAB_RESULT_READY || p.releasedToPatient !== true) {
        return { kind: 'mark_only', targetType, targetId: labOrderId, eventType, context };
      }
      if (!labOrderId) return { kind: 'missing_target', targetType, targetId: null, eventType, context };
      return {
        kind: 'navigate',
        route: `/patient/lab-results?orderId=${encodeURIComponent(labOrderId)}`,
        targetType,
        targetId: labOrderId,
        eventType,
        context
      };
    }
    if (targetType === NOTIFICATION_TARGET_TYPES.PRESCRIPTION) {
      if (!prescriptionId) return { kind: 'missing_target', targetType, targetId: null, eventType, context };
      return {
        kind: 'navigate',
        route: `/patient/prescriptions?prescriptionId=${encodeURIComponent(prescriptionId)}`,
        targetType,
        targetId: prescriptionId,
        eventType,
        context
      };
    }
    return { kind: 'mark_only', targetType, targetId: resolvedTargetId, eventType, context };
  }

  if (role === 'RECEPTIONIST') {
    if (targetType === NOTIFICATION_TARGET_TYPES.APPOINTMENT) {
      if (!appointmentId && !context.patientId) {
        return { kind: 'missing_target', targetType, targetId: null, eventType, context };
      }
      return { kind: 'drilldown', targetType, targetId: appointmentId, eventType, context };
    }
    if (targetType === NOTIFICATION_TARGET_TYPES.LAB_ORDER) {
      if (eventType === NOTIFICATION_EVENTS.LAB_RESULT_READY) {
        return { kind: 'restricted', reason: 'ROLE_CLINICAL_RESTRICTED', targetType, targetId: labOrderId, eventType, context };
      }
      if (!labOrderId) return { kind: 'missing_target', targetType, targetId: null, eventType, context };
      return { kind: 'drilldown', targetType, targetId: labOrderId, eventType, context };
    }
    if (targetType === NOTIFICATION_TARGET_TYPES.PRESCRIPTION) {
      return { kind: 'restricted', reason: 'ROLE_CLINICAL_RESTRICTED', targetType, targetId: prescriptionId, eventType, context };
    }
    return { kind: 'mark_only', targetType, targetId: resolvedTargetId, eventType, context };
  }

  if (role === 'DOCTOR') {
    if (context.doctorId && doctorId && context.doctorId !== doctorId) {
      return { kind: 'restricted', reason: 'OTHER_DOCTOR_RECORD', targetType, targetId: resolvedTargetId, eventType, context };
    }
    if (targetType === NOTIFICATION_TARGET_TYPES.APPOINTMENT) {
      if (!appointmentId && !context.patientId) {
        return { kind: 'missing_target', targetType, targetId: null, eventType, context };
      }
      return { kind: 'drilldown', targetType, targetId: appointmentId, eventType, context };
    }
    if (targetType === NOTIFICATION_TARGET_TYPES.LAB_ORDER) {
      if (!appointmentId && !context.patientId && !labOrderId) {
        return { kind: 'missing_target', targetType, targetId: null, eventType, context };
      }
      if (!appointmentId && !context.patientId) {
        return { kind: 'missing_target', targetType, targetId: labOrderId, eventType, context };
      }
      return { kind: 'drilldown', targetType, targetId: labOrderId, eventType, context };
    }
    if (targetType === NOTIFICATION_TARGET_TYPES.PRESCRIPTION) {
      if (!appointmentId && !context.patientId) {
        return { kind: 'missing_target', targetType, targetId: prescriptionId, eventType, context };
      }
      return { kind: 'drilldown', targetType, targetId: prescriptionId, eventType, context };
    }
    return { kind: 'mark_only', targetType, targetId: resolvedTargetId, eventType, context };
  }

  if (role === 'LAB_TECH') {
    if (targetType === NOTIFICATION_TARGET_TYPES.LAB_ORDER) {
      if (!labOrderId && !context.labOrderItemId) {
        return { kind: 'missing_target', targetType, targetId: null, eventType, context };
      }
      return { kind: 'drilldown', targetType, targetId: labOrderId, eventType, context };
    }
    if (targetType) {
      return { kind: 'restricted', reason: 'ROLE_SCOPE_RESTRICTED', targetType, targetId: resolvedTargetId, eventType, context };
    }
    return { kind: 'mark_only', targetType, targetId: resolvedTargetId, eventType, context };
  }

  if (role === 'PHARMACIST') {
    if (targetType === NOTIFICATION_TARGET_TYPES.PRESCRIPTION) {
      if (!prescriptionId && !context.prescribedDrugId) {
        return { kind: 'missing_target', targetType, targetId: null, eventType, context };
      }
      return { kind: 'drilldown', targetType, targetId: prescriptionId, eventType, context };
    }
    if (targetType) {
      return { kind: 'restricted', reason: 'ROLE_SCOPE_RESTRICTED', targetType, targetId: resolvedTargetId, eventType, context };
    }
    return { kind: 'mark_only', targetType, targetId: resolvedTargetId, eventType, context };
  }

  if (role === 'ADMIN') {
    if (targetType === NOTIFICATION_TARGET_TYPES.SERVICE_PRICING || targetType === NOTIFICATION_TARGET_TYPES.MEDICINE_PRICING) {
      if (!item.targetId) return { kind: 'missing_target', targetType, targetId: null, eventType, context };
      return { kind: 'drilldown', targetType, targetId: item.targetId, eventType, context };
    }
    if (targetType === NOTIFICATION_TARGET_TYPES.APPOINTMENT) {
      if (!appointmentId && !context.patientId) {
        return { kind: 'missing_target', targetType, targetId: null, eventType, context };
      }
      return { kind: 'drilldown', targetType, targetId: appointmentId, eventType, context };
    }
    if (targetType === NOTIFICATION_TARGET_TYPES.LAB_ORDER || targetType === NOTIFICATION_TARGET_TYPES.PRESCRIPTION) {
      return { kind: 'restricted', reason: 'ADMIN_CLINICAL_RESTRICTED', targetType, targetId: resolvedTargetId, eventType, context };
    }
    return { kind: 'mark_only', targetType, targetId: resolvedTargetId, eventType, context };
  }

  return { kind: 'mark_only', targetType, targetId: resolvedTargetId, eventType, context };
}

export function formatNotificationPresentation(rawNotification, lang = 'ar', role = null, doctorId = null) {
  const item = normalizeNotification(rawNotification);
  const isAr = isArabicLanguage(lang);
  if (!item) {
    return {
      title: isAr ? 'إشعار' : 'Notification',
      message: '',
      actionLabel: null,
      isLegacy: true,
      intent: { kind: 'mark_only', targetType: null, targetId: null, eventType: null, context: {} }
    };
  }

  const intent = resolveNotificationIntent(item, { role, doctorId });
  const canOpen = intent.kind === 'navigate' || intent.kind === 'drilldown';
  const title = (isAr ? item.titleAr : item.titleEn) || item.title || (isAr ? item.titleEn : item.titleAr);
  const message = (isAr ? item.messageAr : item.messageEn) || item.message || (isAr ? item.messageEn : item.messageAr);
  const actionLabels = {
    appointment: ['فتح الموعد', 'Open appointment'],
    labOrder: role === 'RECEPTIONIST' ? ['فتح فوترة المختبر', 'Open lab billing'] : ['فتح طلب المختبر', 'Open lab order'],
    prescription: ['فتح الوصفة', 'Open prescription'],
    servicePricing: ['فتح تسعير الخدمة', 'Open service pricing'],
    medicinePricing: ['فتح تسعير الدواء', 'Open medicine pricing']
  };
  return {
    title: title || (isAr ? 'إشعار' : 'Notification'),
    message,
    actionLabel: canOpen ? actionLabels[intent.targetType]?.[isAr ? 0 : 1] ?? null : null,
    isLegacy: !item.eventType && !item.targetType,
    intent
  };
}

export function notificationFeedbackCopy(reason, lang = 'ar') {
  const isAr = isArabicLanguage(lang);
  switch (reason) {
    case 'OTHER_DOCTOR_RECORD':
      return isAr
        ? 'هذا السجل يخص طبيباً آخر ولا يمكن فتحه من حسابك.'
        : 'This record belongs to another doctor and cannot be opened from your account.';
    case 'ROLE_CLINICAL_RESTRICTED':
    case 'ADMIN_CLINICAL_RESTRICTED':
      return isAr
        ? 'البيانات السريرية مقصورة على الطاقم الطبي المختص للحفاظ على خصوصية المريض.'
        : 'Clinical details are restricted to authorized medical staff to protect patient privacy.';
    case 'ROLE_SCOPE_RESTRICTED':
      return isAr
        ? 'هذا السجل غير متاح ضمن مساحة عمل دورك الحالي.'
        : 'This record is outside the workspace for your current role.';
    default:
      return isAr
        ? 'المرجع المرتبط بهذا الإشعار غير متوفر أو لم يعد نشطاً.'
        : 'The record referenced by this notification is unavailable or no longer active.';
  }
}
