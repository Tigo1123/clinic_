import { logger } from '../utils/logger.js';

export const NOTIFICATION_EVENTS = Object.freeze({
  APPOINTMENT_BOOKED: 'APPOINTMENT_BOOKED',
  APPOINTMENT_CONFIRMED: 'APPOINTMENT_CONFIRMED',
  APPOINTMENT_CANCELLED: 'APPOINTMENT_CANCELLED',
  APPOINTMENT_RESCHEDULED: 'APPOINTMENT_RESCHEDULED',
  PATIENT_CHECKED_IN: 'PATIENT_CHECKED_IN',
  CONSULTATION_STARTED: 'CONSULTATION_STARTED',
  CONSULTATION_COMPLETED: 'CONSULTATION_COMPLETED',
  LAB_ORDERED: 'LAB_ORDERED',
  LAB_ORDER_PAID: 'LAB_ORDER_PAID',
  LAB_RESULT_READY: 'LAB_RESULT_READY',
  LAB_PRICING_REQUIRED: 'LAB_PRICING_REQUIRED',
  PRESCRIPTION_READY: 'PRESCRIPTION_READY',
  PHARMACY_PAYMENT_RECORDED: 'PHARMACY_PAYMENT_RECORDED',
  PRESCRIPTION_DISPENSED: 'PRESCRIPTION_DISPENSED',
  PHARMACY_MEDICATION_EXTERNAL: 'PHARMACY_MEDICATION_EXTERNAL',
  PHARMACY_PRICING_REQUIRED: 'PHARMACY_PRICING_REQUIRED',
  PHARMACY_INVOICE_READY: 'PHARMACY_INVOICE_READY',
});

export const NOTIFICATION_TARGET_TYPES = Object.freeze({
  APPOINTMENT: 'appointment',
  LAB_ORDER: 'labOrder',
  PRESCRIPTION: 'prescription',
  SERVICE_PRICING: 'servicePricing',
  MEDICINE_PRICING: 'medicinePricing',
});

const STAFF_ROLES = new Set(['ADMIN', 'RECEPTIONIST', 'DOCTOR', 'LAB_TECH', 'PHARMACIST']);

const SAFE_PAYLOAD_KEYS = new Set([
  'appointmentId',
  'doctorId',
  'appointmentDate',
  'appointmentTime',
  'patientId',
  'labOrderId',
  'prescriptionId',
  'invoiceId',
  'status',
  'source',
  'hasCustomTestsPendingReview',
  'needsReview',
  'releasedToPatient',
  'transferred',
  'emergencyOverride',
]);

export function normalizeLanguage(language) {
  return language === 'en' ? 'en' : 'ar';
}

export function sanitizeNotificationPayload(rawPayload, { includePatientId = false } = {}) {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    return null;
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(rawPayload)) {
    if (!SAFE_PAYLOAD_KEYS.has(key)) continue;
    if (key === 'patientId' && !includePatientId) continue;
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) sanitized[key] = trimmed;
    } else if (typeof value === 'boolean') {
      sanitized[key] = value;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      sanitized[key] = value;
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

export function serializeNotification(row, preferredLanguage = null) {
  if (!row) return null;
  const lang = preferredLanguage ? normalizeLanguage(preferredLanguage) : null;
  const title = lang
    ? (lang === 'en' ? (row.titleEn ?? row.title) : (row.titleAr ?? row.title))
    : row.title;
  const message = lang
    ? (lang === 'en' ? (row.messageEn ?? row.message) : (row.messageAr ?? row.message))
    : row.message;

  return {
    id: row.id,
    userId: row.userId,
    title,
    message,
    titleAr: row.titleAr ?? null,
    titleEn: row.titleEn ?? null,
    messageAr: row.messageAr ?? null,
    messageEn: row.messageEn ?? null,
    isRead: Boolean(row.isRead),
    createdAt: row.createdAt,
    eventType: row.eventType ?? null,
    targetType: row.targetType ?? null,
    targetId: row.targetId ?? null,
    payload: row.payload ?? null,
  };
}

export async function getUserNotifications(db, userId, options = {}) {
  const rawLimit = Number(options?.limit);
  const take = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.trunc(rawLimit), 100) : 50;
  const unreadOnly = options?.unreadOnly === true || options?.unreadOnly === 'true' || options?.unreadOnly === '1';
  const where = unreadOnly ? { userId, isRead: false } : { userId };

  const [rows, unreadCount, userRecord] = await Promise.all([
    db.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
    }),
    db.notification.count({
      where: { userId, isRead: false },
    }),
    db.user?.findUnique
      ? db.user.findUnique({
          where: { id: userId },
          select: { preferredLanguage: true },
        })
      : Promise.resolve(null),
  ]);

  const preferredLanguage = userRecord?.preferredLanguage ?? null;
  return {
    notifications: rows.map((row) => serializeNotification(row, preferredLanguage)),
    unreadCount,
  };
}

export async function markNotificationAsRead(db, id, userId) {
  const notification = await db.notification.findFirst({
    where: { id, userId },
  });

  if (!notification) {
    return null;
  }

  const updated = notification.isRead
    ? notification
    : await db.notification.update({
        where: { id },
        data: { isRead: true },
      });

  const [unreadCount, userRecord] = await Promise.all([
    db.notification.count({
      where: { userId, isRead: false },
    }),
    db.user?.findUnique
      ? db.user.findUnique({
          where: { id: userId },
          select: { preferredLanguage: true },
        })
      : Promise.resolve(null),
  ]);

  return {
    success: true,
    notification: serializeNotification(updated, userRecord?.preferredLanguage ?? null),
    unreadCount,
  };
}

export async function markAllNotificationsAsRead(db, userId) {
  const result = await db.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });

  const unreadCount = await db.notification.count({
    where: { userId, isRead: false },
  });

  return {
    success: true,
    updatedCount: result?.count ?? 0,
    unreadCount,
  };
}

export async function createAndEmitNotification(db, emit, params) {
  const {
    userId,
    title,
    message,
    titleAr = null,
    titleEn = null,
    messageAr = null,
    messageEn = null,
    eventType = null,
    targetType = null,
    targetId = null,
    payload = null,
    dedupeKey = null,
    preferredLanguage = null,
    includePatientId = false,
  } = params;

  let resolvedLanguage = preferredLanguage;
  if (!resolvedLanguage && (titleAr || titleEn || messageAr || messageEn) && db.user?.findUnique) {
    const userRecord = await db.user.findUnique({
      where: { id: userId },
      select: { preferredLanguage: true },
    });
    resolvedLanguage = userRecord?.preferredLanguage ?? 'ar';
  }

  const lang = resolvedLanguage ? normalizeLanguage(resolvedLanguage) : null;
  const resolvedTitle = title ?? (lang === 'en' ? (titleEn ?? titleAr ?? '') : (titleAr ?? titleEn ?? ''));
  const resolvedMessage = message ?? (lang === 'en' ? (messageEn ?? messageAr ?? '') : (messageAr ?? messageEn ?? ''));
  const sanitizedPayload = sanitizeNotificationPayload(payload, { includePatientId });

  const data = {
    userId,
    title: resolvedTitle,
    message: resolvedMessage,
    isRead: false,
    ...(titleAr !== null ? { titleAr } : {}),
    ...(titleEn !== null ? { titleEn } : {}),
    ...(messageAr !== null ? { messageAr } : {}),
    ...(messageEn !== null ? { messageEn } : {}),
    ...(eventType !== null ? { eventType } : {}),
    ...(targetType !== null ? { targetType } : {}),
    ...(targetId !== null ? { targetId } : {}),
    ...(sanitizedPayload !== null ? { payload: sanitizedPayload } : {}),
    ...(dedupeKey !== null ? { dedupeKey } : {}),
  };

  let created;
  try {
    created = await db.notification.create({ data });
  } catch (error) {
    if (dedupeKey && error?.code === 'P2002') {
      return null;
    }
    throw error;
  }

  const serialized = serializeNotification(created, resolvedLanguage);
  if (typeof emit === 'function') {
    emit(userId, serialized);
  }
  return serialized;
}

function canDeliverNotifications(db) {
  return Boolean(db?.notification?.create && db?.user?.findMany);
}

async function resolveStaffRecipientsByRoles(db, roles, { excludeUserId = null } = {}) {
  if (!Array.isArray(roles) || roles.length === 0 || !db?.user?.findMany) return [];
  return db.user.findMany({
    where: {
      role: { in: roles },
      status: 'ACTIVE',
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    },
    select: { id: true, role: true, preferredLanguage: true },
  });
}

async function resolveDoctorRecipient(db, doctorId, { excludeUserId = null } = {}) {
  if (!doctorId || !db?.doctor?.findUnique) return null;
  const doctor = await db.doctor.findUnique({
    where: { id: doctorId },
    select: {
      id: true,
      fullNameAr: true,
      fullNameEn: true,
      user: {
        select: { id: true, role: true, status: true, preferredLanguage: true },
      },
    },
  });
  if (!doctor?.user || doctor.user.status !== 'ACTIVE' || doctor.user.role !== 'DOCTOR') {
    return null;
  }
  if (excludeUserId && doctor.user.id === excludeUserId) {
    return null;
  }
  return {
    user: doctor.user,
    doctorNameAr: doctor.fullNameAr,
    doctorNameEn: doctor.fullNameEn,
  };
}

async function resolvePatientRecipient(db, patientId, { excludeUserId = null } = {}) {
  if (!patientId || !db?.patient?.findUnique) return null;
  const patient = await db.patient.findUnique({
    where: { id: patientId },
    select: {
      id: true,
      userId: true,
      user: {
        select: { id: true, role: true, status: true, preferredLanguage: true },
      },
    },
  });
  if (!patient?.userId || !patient?.user || patient.user.status !== 'ACTIVE' || patient.user.role !== 'PATIENT') {
    return null;
  }
  if (excludeUserId && patient.user.id === excludeUserId) {
    return null;
  }
  return patient.user;
}

async function resolveDoctorNames(db, doctorId, fallbackDoctor = null) {
  if (fallbackDoctor?.fullNameAr && fallbackDoctor?.fullNameEn) {
    return { fullNameAr: fallbackDoctor.fullNameAr, fullNameEn: fallbackDoctor.fullNameEn };
  }
  if (doctorId && db?.doctor?.findUnique) {
    const doc = await db.doctor.findUnique({
      where: { id: doctorId },
      select: { fullNameAr: true, fullNameEn: true },
    });
    if (doc) return doc;
  }
  return { fullNameAr: 'الطبيب', fullNameEn: 'the doctor' };
}

async function deliverToRecipientMap(db, emit, recipientsByUserId, buildMessage) {
  const delivered = [];
  for (const recipient of recipientsByUserId.values()) {
    const spec = buildMessage(recipient);
    if (!spec) continue;
    const includePatientId = STAFF_ROLES.has(recipient.role);
    try {
      const created = await createAndEmitNotification(db, emit, {
        userId: recipient.id,
        preferredLanguage: recipient.preferredLanguage,
        includePatientId,
        ...spec,
      });
      if (created) delivered.push(created);
    } catch (error) {
      logger.warn('notification.recipient_delivery_failed', {
        userId: recipient.id,
        eventType: spec.eventType,
        error,
      });
    }
  }
  return delivered;
}

function addRecipient(map, user) {
  if (user?.id && !map.has(user.id)) {
    map.set(user.id, user);
  }
}

export async function notifyAppointmentBooked(db, emit, { appointment, source = 'PUBLIC' } = {}) {
  if (!canDeliverNotifications(db) || !appointment?.id) return [];
  try {
    const [staffUsers, patientUser, doctorNames] = await Promise.all([
      resolveStaffRecipientsByRoles(db, ['RECEPTIONIST', 'ADMIN']),
      resolvePatientRecipient(db, appointment.patientId),
      resolveDoctorNames(db, appointment.doctorId, appointment.doctor),
    ]);

    const recipients = new Map();
    for (const user of staffUsers) addRecipient(recipients, user);
    if (patientUser) addRecipient(recipients, patientUser);

    return await deliverToRecipientMap(db, emit, recipients, (recipient) => {
      const basePayload = {
        appointmentId: appointment.id,
        doctorId: appointment.doctorId,
        appointmentDate: appointment.appointmentDate,
        appointmentTime: appointment.appointmentTime,
        patientId: appointment.patientId,
        status: appointment.status || 'PENDING',
        source,
      };
      const dedupeKey = `${NOTIFICATION_EVENTS.APPOINTMENT_BOOKED}:${appointment.id}`;

      if (recipient.role === 'PATIENT') {
        return {
          eventType: NOTIFICATION_EVENTS.APPOINTMENT_BOOKED,
          targetType: NOTIFICATION_TARGET_TYPES.APPOINTMENT,
          targetId: appointment.id,
          payload: basePayload,
          dedupeKey,
          titleAr: 'تم استلام طلب الموعد',
          titleEn: 'Appointment Request Received',
          messageAr: `تم استلام طلب موعدك مع ${doctorNames.fullNameAr} بتاريخ ${appointment.appointmentDate} الساعة ${appointment.appointmentTime} وهو بانتظار التأكيد.`,
          messageEn: `Your appointment request with ${doctorNames.fullNameEn} on ${appointment.appointmentDate} at ${appointment.appointmentTime} has been received and is awaiting confirmation.`,
        };
      }

      return {
        eventType: NOTIFICATION_EVENTS.APPOINTMENT_BOOKED,
        targetType: NOTIFICATION_TARGET_TYPES.APPOINTMENT,
        targetId: appointment.id,
        payload: basePayload,
        dedupeKey,
        titleAr: 'طلب موعد جديد بانتظار التأكيد',
        titleEn: 'New Appointment Request',
        messageAr: `تم استلام طلب موعد جديد مع ${doctorNames.fullNameAr} بتاريخ ${appointment.appointmentDate} الساعة ${appointment.appointmentTime}.`,
        messageEn: `A new appointment request with ${doctorNames.fullNameEn} for ${appointment.appointmentDate} at ${appointment.appointmentTime} is awaiting confirmation.`,
      };
    });
  } catch (error) {
    logger.warn('notification.appointment_booked_failed', { appointmentId: appointment?.id, error });
    return [];
  }
}

export async function notifyAppointmentConfirmed(db, emit, { appointment } = {}) {
  if (!canDeliverNotifications(db) || !appointment?.id) return [];
  try {
    const [patientUser, doctorNames] = await Promise.all([
      resolvePatientRecipient(db, appointment.patientId),
      resolveDoctorNames(db, appointment.doctorId, appointment.doctor),
    ]);
    if (!patientUser) return [];

    const recipients = new Map([[patientUser.id, patientUser]]);
    return await deliverToRecipientMap(db, emit, recipients, () => ({
      eventType: NOTIFICATION_EVENTS.APPOINTMENT_CONFIRMED,
      targetType: NOTIFICATION_TARGET_TYPES.APPOINTMENT,
      targetId: appointment.id,
      payload: {
        appointmentId: appointment.id,
        doctorId: appointment.doctorId,
        appointmentDate: appointment.appointmentDate,
        appointmentTime: appointment.appointmentTime,
        status: 'CONFIRMED',
      },
      dedupeKey: `${NOTIFICATION_EVENTS.APPOINTMENT_CONFIRMED}:${appointment.id}:${appointment.appointmentDate}:${appointment.appointmentTime}`,
      titleAr: 'تم تأكيد الموعد',
      titleEn: 'Appointment Confirmed',
      messageAr: `تم تأكيد موعدك مع ${doctorNames.fullNameAr} بتاريخ ${appointment.appointmentDate} الساعة ${appointment.appointmentTime}.`,
      messageEn: `Your appointment with ${doctorNames.fullNameEn} on ${appointment.appointmentDate} at ${appointment.appointmentTime} has been confirmed.`,
    }));
  } catch (error) {
    logger.warn('notification.appointment_confirmed_failed', { appointmentId: appointment?.id, error });
    return [];
  }
}

export async function notifyPatientCheckedIn(
  db,
  emit,
  { appointment, transferred = false, emergencyOverride = false, overrideOnlyDoctor = false } = {},
) {
  if (!canDeliverNotifications(db) || !appointment?.id) return [];
  try {
    const [doctorResolved, patientUser] = await Promise.all([
      resolveDoctorRecipient(db, appointment.doctorId),
      overrideOnlyDoctor ? Promise.resolve(null) : resolvePatientRecipient(db, appointment.patientId),
    ]);

    const recipients = new Map();
    if (doctorResolved?.user) addRecipient(recipients, doctorResolved.user);
    if (patientUser) addRecipient(recipients, patientUser);
    if (recipients.size === 0) return [];

    const doctorNames = doctorResolved
      ? { fullNameAr: doctorResolved.doctorNameAr, fullNameEn: doctorResolved.doctorNameEn }
      : await resolveDoctorNames(db, appointment.doctorId, appointment.doctor);

    const baseDedupe = `${NOTIFICATION_EVENTS.PATIENT_CHECKED_IN}:${appointment.id}:${appointment.doctorId}`;
    const dedupeKey = emergencyOverride && overrideOnlyDoctor ? `${baseDedupe}:override` : baseDedupe;

    return await deliverToRecipientMap(db, emit, recipients, (recipient) => {
      const payload = {
        appointmentId: appointment.id,
        doctorId: appointment.doctorId,
        appointmentDate: appointment.appointmentDate,
        appointmentTime: appointment.appointmentTime,
        patientId: appointment.patientId,
        status: 'CHECKED_IN',
        ...(transferred ? { transferred: true } : {}),
        ...(emergencyOverride ? { emergencyOverride: true } : {}),
      };

      if (recipient.role === 'PATIENT') {
        return {
          eventType: NOTIFICATION_EVENTS.PATIENT_CHECKED_IN,
          targetType: NOTIFICATION_TARGET_TYPES.APPOINTMENT,
          targetId: appointment.id,
          payload,
          dedupeKey,
          titleAr: transferred ? 'تم تحويل موعدك' : 'تم تسجيل حضورك',
          titleEn: transferred ? 'Appointment Transferred' : 'Checked In',
          messageAr: transferred
            ? `تم تحويل موعدك إلى ${doctorNames.fullNameAr} بتاريخ ${appointment.appointmentDate}.`
            : `تم تسجيل حضورك لموعدك مع ${doctorNames.fullNameAr}. يرجى الانتظار حتى يتم استدعاؤك.`,
          messageEn: transferred
            ? `Your checked-in appointment has been transferred to ${doctorNames.fullNameEn} on ${appointment.appointmentDate}.`
            : `You are checked in for your appointment with ${doctorNames.fullNameEn}. Please wait until you are called.`,
        };
      }

      return {
        eventType: NOTIFICATION_EVENTS.PATIENT_CHECKED_IN,
        targetType: NOTIFICATION_TARGET_TYPES.APPOINTMENT,
        targetId: appointment.id,
        payload,
        dedupeKey,
        titleAr: emergencyOverride
          ? 'حالة طارئة في قائمة الانتظار'
          : transferred
          ? 'تم تحويل مريض إلى قائمتك'
          : 'وصول مريض إلى قائمة الانتظار',
        titleEn: emergencyOverride
          ? 'Emergency Queue Priority'
          : transferred
          ? 'Patient Transferred to Queue'
          : 'Patient Checked In',
        messageAr: emergencyOverride
          ? `تمت إضافة حالة طارئة مسجلة الحضور إلى قائمة انتظارك بتاريخ ${appointment.appointmentDate} الساعة ${appointment.appointmentTime}.`
          : transferred
          ? `تم تحويل مريض مسجل الحضور إلى قائمة انتظارك بتاريخ ${appointment.appointmentDate} الساعة ${appointment.appointmentTime}.`
          : `تم تسجيل حضور مريض لموعد بتاريخ ${appointment.appointmentDate} الساعة ${appointment.appointmentTime}.`,
        messageEn: emergencyOverride
          ? `An emergency priority check-in has been added to your queue for ${appointment.appointmentDate} at ${appointment.appointmentTime}.`
          : transferred
          ? `A checked-in patient has been transferred to your queue for ${appointment.appointmentDate} at ${appointment.appointmentTime}.`
          : `A patient has checked in for the appointment on ${appointment.appointmentDate} at ${appointment.appointmentTime}.`,
      };
    });
  } catch (error) {
    logger.warn('notification.patient_checked_in_failed', { appointmentId: appointment?.id, error });
    return [];
  }
}

export async function notifyAppointmentCancelled(
  db,
  emit,
  { appointment, previousStatus = /** @type {string | null} */ (null), actorUserId = /** @type {string | null} */ (null), actorRole = /** @type {string | null} */ (null) } = {},
) {
  if (!canDeliverNotifications(db) || !appointment?.id) return [];
  try {
    const recipients = new Map();
    const shouldNotifyDoctor = ['SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'IN_CONSULTATION', 'WAITING_LAB'].includes(previousStatus);

    if (actorRole === 'PATIENT') {
      const staff = await resolveStaffRecipientsByRoles(db, ['RECEPTIONIST', 'ADMIN'], { excludeUserId: actorUserId });
      for (const user of staff) addRecipient(recipients, user);
      if (shouldNotifyDoctor) {
        const doc = await resolveDoctorRecipient(db, appointment.doctorId, { excludeUserId: actorUserId });
        if (doc?.user) addRecipient(recipients, doc.user);
      }
    } else {
      const patientUser = await resolvePatientRecipient(db, appointment.patientId, { excludeUserId: actorUserId });
      if (patientUser) addRecipient(recipients, patientUser);
      if (shouldNotifyDoctor) {
        const doc = await resolveDoctorRecipient(db, appointment.doctorId, { excludeUserId: actorUserId });
        if (doc?.user) addRecipient(recipients, doc.user);
      }
    }

    if (recipients.size === 0) return [];
    const doctorNames = await resolveDoctorNames(db, appointment.doctorId, appointment.doctor);
    const dedupeKey = `${NOTIFICATION_EVENTS.APPOINTMENT_CANCELLED}:${appointment.id}`;

    return await deliverToRecipientMap(db, emit, recipients, (recipient) => {
      const payload = {
        appointmentId: appointment.id,
        doctorId: appointment.doctorId,
        appointmentDate: appointment.appointmentDate,
        appointmentTime: appointment.appointmentTime,
        patientId: appointment.patientId,
        status: 'CANCELLED',
      };

      if (recipient.role === 'PATIENT') {
        return {
          eventType: NOTIFICATION_EVENTS.APPOINTMENT_CANCELLED,
          targetType: NOTIFICATION_TARGET_TYPES.APPOINTMENT,
          targetId: appointment.id,
          payload,
          dedupeKey,
          titleAr: 'تم إلغاء الموعد',
          titleEn: 'Appointment Cancelled',
          messageAr: `تم إلغاء موعدك مع ${doctorNames.fullNameAr} بتاريخ ${appointment.appointmentDate} الساعة ${appointment.appointmentTime}.`,
          messageEn: `Your appointment with ${doctorNames.fullNameEn} on ${appointment.appointmentDate} at ${appointment.appointmentTime} has been cancelled.`,
        };
      }

      return {
        eventType: NOTIFICATION_EVENTS.APPOINTMENT_CANCELLED,
        targetType: NOTIFICATION_TARGET_TYPES.APPOINTMENT,
        targetId: appointment.id,
        payload,
        dedupeKey,
        titleAr: 'تم إلغاء موعد',
        titleEn: 'Appointment Cancelled',
        messageAr: `تم إلغاء الموعد مع ${doctorNames.fullNameAr} بتاريخ ${appointment.appointmentDate} الساعة ${appointment.appointmentTime}.`,
        messageEn: `An appointment with ${doctorNames.fullNameEn} on ${appointment.appointmentDate} at ${appointment.appointmentTime} was cancelled.`,
      };
    });
  } catch (error) {
    logger.warn('notification.appointment_cancelled_failed', { appointmentId: appointment?.id, error });
    return [];
  }
}

export async function notifyAppointmentRescheduled(
  db,
  emit,
  { appointment, previousDoctorId = /** @type {string | null} */ (null), previousStatus = /** @type {string | null} */ (null), actorUserId = /** @type {string | null} */ (null) } = {},
) {
  if (!canDeliverNotifications(db) || !appointment?.id) return [];
  try {
    const recipients = new Map();
    const staff = await resolveStaffRecipientsByRoles(db, ['RECEPTIONIST', 'ADMIN'], { excludeUserId: actorUserId });
    for (const user of staff) addRecipient(recipients, user);

    if (['SCHEDULED', 'CONFIRMED'].includes(previousStatus) && previousDoctorId) {
      const doc = await resolveDoctorRecipient(db, previousDoctorId, { excludeUserId: actorUserId });
      if (doc?.user) addRecipient(recipients, doc.user);
    }

    if (recipients.size === 0) return [];
    const doctorNames = await resolveDoctorNames(db, appointment.doctorId, appointment.doctor);
    const dedupeKey = `${NOTIFICATION_EVENTS.APPOINTMENT_RESCHEDULED}:${appointment.id}:${appointment.appointmentDate}:${appointment.appointmentTime}`;

    return await deliverToRecipientMap(db, emit, recipients, () => ({
      eventType: NOTIFICATION_EVENTS.APPOINTMENT_RESCHEDULED,
      targetType: NOTIFICATION_TARGET_TYPES.APPOINTMENT,
      targetId: appointment.id,
      payload: {
        appointmentId: appointment.id,
        doctorId: appointment.doctorId,
        appointmentDate: appointment.appointmentDate,
        appointmentTime: appointment.appointmentTime,
        patientId: appointment.patientId,
        status: appointment.status || 'PENDING',
      },
      dedupeKey,
      titleAr: 'تمت إعادة جدولة موعد',
      titleEn: 'Appointment Rescheduled',
      messageAr: `طلب المريض إعادة جدولة موعد مع ${doctorNames.fullNameAr} إلى ${appointment.appointmentDate} الساعة ${appointment.appointmentTime} وبانتظار التأكيد.`,
      messageEn: `An appointment with ${doctorNames.fullNameEn} was rescheduled to ${appointment.appointmentDate} at ${appointment.appointmentTime} and awaits confirmation.`,
    }));
  } catch (error) {
    logger.warn('notification.appointment_rescheduled_failed', { appointmentId: appointment?.id, error });
    return [];
  }
}

export async function notifyConsultationStarted(db, emit, { appointment } = {}) {
  if (!canDeliverNotifications(db) || !appointment?.id) return [];
  try {
    const [patientUser, doctorNames] = await Promise.all([
      resolvePatientRecipient(db, appointment.patientId),
      resolveDoctorNames(db, appointment.doctorId, appointment.doctor),
    ]);
    if (!patientUser) return [];

    return await deliverToRecipientMap(db, emit, new Map([[patientUser.id, patientUser]]), () => ({
      eventType: NOTIFICATION_EVENTS.CONSULTATION_STARTED,
      targetType: NOTIFICATION_TARGET_TYPES.APPOINTMENT,
      targetId: appointment.id,
      payload: {
        appointmentId: appointment.id,
        doctorId: appointment.doctorId,
        appointmentDate: appointment.appointmentDate,
        appointmentTime: appointment.appointmentTime,
        status: 'IN_CONSULTATION',
      },
      dedupeKey: `${NOTIFICATION_EVENTS.CONSULTATION_STARTED}:${appointment.id}`,
      titleAr: 'حان دورك للاستشارة',
      titleEn: 'Your Consultation Is Starting',
      messageAr: `حان دورك! يرجى التوجه إلى عيادة ${doctorNames.fullNameAr}.`,
      messageEn: `It is your turn! Please proceed to ${doctorNames.fullNameEn}'s consultation room.`,
    }));
  } catch (error) {
    logger.warn('notification.consultation_started_failed', { appointmentId: appointment?.id, error });
    return [];
  }
}

export async function notifyConsultationCompleted(db, emit, { appointmentId, doctorId, patientId, appointmentDate = /** @type {string | null} */ (null) } = {}) {
  if (!canDeliverNotifications(db) || !appointmentId || !patientId) return [];
  try {
    const [patientUser, doctorNames] = await Promise.all([
      resolvePatientRecipient(db, patientId),
      resolveDoctorNames(db, doctorId),
    ]);
    if (!patientUser) return [];

    return await deliverToRecipientMap(db, emit, new Map([[patientUser.id, patientUser]]), () => ({
      eventType: NOTIFICATION_EVENTS.CONSULTATION_COMPLETED,
      targetType: NOTIFICATION_TARGET_TYPES.APPOINTMENT,
      targetId: appointmentId,
      payload: {
        appointmentId,
        doctorId,
        appointmentDate,
        status: 'COMPLETED',
      },
      dedupeKey: `${NOTIFICATION_EVENTS.CONSULTATION_COMPLETED}:${appointmentId}`,
      titleAr: 'اكتملت الزيارة الطبية',
      titleEn: 'Visit Completed',
      messageAr: `اكتملت زيارتك مع ${doctorNames.fullNameAr}. يمكنك مراجعة ملخص الزيارة من بوابتك.`,
      messageEn: `Your visit with ${doctorNames.fullNameEn} is complete. You can view your visit details in your portal.`,
    }));
  } catch (error) {
    logger.warn('notification.consultation_completed_failed', { appointmentId, error });
    return [];
  }
}

export async function notifyLabOrdered(
  db,
  emit,
  { labOrder, appointmentId = /** @type {string | null} */ (null), appointmentDate = /** @type {string | null} */ (null), hasCustomTestsPendingReview = false } = {},
) {
  if (!canDeliverNotifications(db) || !labOrder?.id) return [];
  try {
    const [labTechs, frontDesk, patientUser, doctorNames] = await Promise.all([
      resolveStaffRecipientsByRoles(db, ['LAB_TECH']),
      resolveStaffRecipientsByRoles(db, ['RECEPTIONIST']),
      resolvePatientRecipient(db, labOrder.patientId),
      resolveDoctorNames(db, labOrder.doctorId),
    ]);

    const recipients = new Map();
    for (const user of labTechs) addRecipient(recipients, user);
    for (const user of frontDesk) addRecipient(recipients, user);
    if (patientUser) addRecipient(recipients, patientUser);
    if (recipients.size === 0) return [];

    const dedupeKey = `${NOTIFICATION_EVENTS.LAB_ORDERED}:${labOrder.id}`;
    return await deliverToRecipientMap(db, emit, recipients, (recipient) => {
      const payload = {
        labOrderId: labOrder.id,
        appointmentId,
        doctorId: labOrder.doctorId,
        appointmentDate,
        patientId: labOrder.patientId,
        status: labOrder.status || 'PENDING_BILLING',
        ...(hasCustomTestsPendingReview ? { hasCustomTestsPendingReview: true } : {}),
      };

      if (recipient.role === 'LAB_TECH') {
        return {
          eventType: NOTIFICATION_EVENTS.LAB_ORDERED,
          targetType: NOTIFICATION_TARGET_TYPES.LAB_ORDER,
          targetId: labOrder.id,
          payload,
          dedupeKey,
          titleAr: 'طلب فحص مخبري جديد',
          titleEn: 'New Laboratory Order',
          messageAr: hasCustomTestsPendingReview
            ? `تم إرسال طلب فحص مخبري جديد من ${doctorNames.fullNameAr} يتضمن فحوصات بانتظار مراجعة المختبر.`
            : `تم إرسال طلب فحص مخبري جديد من ${doctorNames.fullNameAr}.`,
          messageEn: hasCustomTestsPendingReview
            ? `A new laboratory order from ${doctorNames.fullNameEn} includes custom tests awaiting laboratory review.`
            : `A new laboratory order has been submitted by ${doctorNames.fullNameEn}.`,
        };
      }

      if (recipient.role === 'PATIENT') {
        return {
          eventType: NOTIFICATION_EVENTS.LAB_ORDERED,
          targetType: NOTIFICATION_TARGET_TYPES.APPOINTMENT,
          targetId: appointmentId,
          payload: { appointmentId },
          dedupeKey,
          titleAr: 'تم طلب فحوصات مخبرية',
          titleEn: 'Laboratory Tests Ordered',
          messageAr: `طلب ${doctorNames.fullNameAr} إجراء فحوصات مخبرية لزيارتك. يرجى مراجعة الاستقبال لإتمام الإجراءات.`,
          messageEn: `${doctorNames.fullNameEn} ordered laboratory tests for your visit. Please proceed to reception.`,
        };
      }

      return {
        eventType: NOTIFICATION_EVENTS.LAB_ORDERED,
        targetType: NOTIFICATION_TARGET_TYPES.LAB_ORDER,
        targetId: labOrder.id,
        payload,
        dedupeKey,
        titleAr: 'طلب فحص مخبري بانتظار الفوترة',
        titleEn: 'Laboratory Order Pending Billing',
        messageAr: `يوجد طلب فحص مخبري جديد صادر من ${doctorNames.fullNameAr} بانتظار المراجعة والفوترة.`,
        messageEn: `A new laboratory order from ${doctorNames.fullNameEn} is awaiting billing.`,
      };
    });
  } catch (error) {
    logger.warn('notification.lab_ordered_failed', { labOrderId: labOrder?.id, error });
    return [];
  }
}

export async function notifyLabOrderPaid(db, emit, { labOrderId, appointmentId = /** @type {string | null} */ (null), doctorId = /** @type {string | null} */ (null), patientId = /** @type {string | null} */ (null), appointmentDate = /** @type {string | null} */ (null) } = {}) {
  if (!canDeliverNotifications(db) || !labOrderId) return [];
  try {
    let resolvedDoctorId = doctorId;
    let resolvedPatientId = patientId;
    let resolvedAppointmentId = appointmentId;
    if ((!resolvedDoctorId || !resolvedPatientId) && db.labOrder?.findUnique) {
      const order = await db.labOrder.findUnique({
        where: { id: labOrderId },
        select: { doctorId: true, patientId: true, medicalRecord: { select: { appointmentId: true } } },
      });
      resolvedDoctorId = resolvedDoctorId || order?.doctorId || null;
      resolvedPatientId = resolvedPatientId || order?.patientId || null;
      resolvedAppointmentId = resolvedAppointmentId || order?.medicalRecord?.appointmentId || null;
    }

    const labTechs = await resolveStaffRecipientsByRoles(db, ['LAB_TECH']);
    if (!labTechs.length) return [];

    const recipients = new Map(labTechs.map((user) => [user.id, user]));
    const dedupeKey = `${NOTIFICATION_EVENTS.LAB_ORDER_PAID}:${labOrderId}`;
    return await deliverToRecipientMap(db, emit, recipients, () => ({
      eventType: NOTIFICATION_EVENTS.LAB_ORDER_PAID,
      targetType: NOTIFICATION_TARGET_TYPES.LAB_ORDER,
      targetId: labOrderId,
      payload: {
        labOrderId,
        appointmentId: resolvedAppointmentId,
        doctorId: resolvedDoctorId,
        patientId: resolvedPatientId,
        appointmentDate,
        status: 'PAID',
      },
      dedupeKey,
      titleAr: 'تم سداد رسوم الفحص المخبري',
      titleEn: 'Laboratory Order Paid',
      messageAr: 'تم سداد فاتورة طلب الفحص المخبري وأصبح جاهزاً لسحب العينة.',
      messageEn: 'A laboratory order invoice has been paid and is ready for sample collection.',
    }));
  } catch (error) {
    logger.warn('notification.lab_order_paid_failed', { labOrderId, error });
    return [];
  }
}

export async function notifyLabResultReadyToDoctor(
  db,
  emit,
  { labOrderId, appointmentId = /** @type {string | null} */ (null), doctorId = /** @type {string | null} */ (null), patientId = /** @type {string | null} */ (null), appointmentDate = /** @type {string | null} */ (null) } = {},
) {
  if (!canDeliverNotifications(db) || !labOrderId) return [];
  try {
    let resolvedDoctorId = doctorId;
    let resolvedPatientId = patientId;
    let resolvedAppointmentId = appointmentId;
    let resolvedAppointmentDate = appointmentDate;
    if ((!resolvedDoctorId || !resolvedPatientId) && db.labOrder?.findUnique) {
      const order = await db.labOrder.findUnique({
        where: { id: labOrderId },
        select: { doctorId: true, patientId: true, medicalRecord: { select: { appointmentId: true, appointment: { select: { appointmentDate: true } } } } },
      });
      resolvedDoctorId = resolvedDoctorId || order?.doctorId || null;
      resolvedPatientId = resolvedPatientId || order?.patientId || null;
      resolvedAppointmentId = resolvedAppointmentId || order?.medicalRecord?.appointmentId || null;
      resolvedAppointmentDate = resolvedAppointmentDate || order?.medicalRecord?.appointment?.appointmentDate || null;
    }

    const doctorResolved = await resolveDoctorRecipient(db, resolvedDoctorId);
    if (!doctorResolved?.user) return [];

    const recipients = new Map([[doctorResolved.user.id, doctorResolved.user]]);
    return await deliverToRecipientMap(db, emit, recipients, () => ({
      eventType: NOTIFICATION_EVENTS.LAB_RESULT_READY,
      targetType: NOTIFICATION_TARGET_TYPES.LAB_ORDER,
      targetId: labOrderId,
      payload: {
        labOrderId,
        appointmentId: resolvedAppointmentId,
        doctorId: resolvedDoctorId,
        patientId: resolvedPatientId,
        appointmentDate: resolvedAppointmentDate,
        status: 'COMPLETED',
        releasedToPatient: false,
      },
      dedupeKey: `${NOTIFICATION_EVENTS.LAB_RESULT_READY}:${labOrderId}`,
      titleAr: 'نتائج الفحوصات المخبرية جاهزة',
      titleEn: 'Laboratory Results Ready',
      messageAr: 'اكتملت نتائج الفحوصات المخبرية وأصبحت جاهزة للمراجعة وإكمال الاستشارة.',
      messageEn: 'Laboratory results are complete and ready for clinical review.',
    }));
  } catch (error) {
    logger.warn('notification.lab_result_ready_doctor_failed', { labOrderId, error });
    return [];
  }
}

export async function notifyLabResultReleasedToPatient(
  db,
  emit,
  { labOrderId, appointmentId = /** @type {string | null} */ (null), doctorId = /** @type {string | null} */ (null), patientId = /** @type {string | null} */ (null), appointmentDate = /** @type {string | null} */ (null) } = {},
) {
  if (!canDeliverNotifications(db) || !labOrderId) return [];
  try {
    let resolvedDoctorId = doctorId;
    let resolvedPatientId = patientId;
    let resolvedAppointmentId = appointmentId;
    if ((!resolvedDoctorId || !resolvedPatientId) && db.labOrder?.findUnique) {
      const order = await db.labOrder.findUnique({
        where: { id: labOrderId },
        select: { doctorId: true, patientId: true, medicalRecord: { select: { appointmentId: true } } },
      });
      resolvedDoctorId = resolvedDoctorId || order?.doctorId || null;
      resolvedPatientId = resolvedPatientId || order?.patientId || null;
      resolvedAppointmentId = resolvedAppointmentId || order?.medicalRecord?.appointmentId || null;
    }

    const patientUser = await resolvePatientRecipient(db, resolvedPatientId);
    if (!patientUser) return [];

    const recipients = new Map([[patientUser.id, patientUser]]);
    return await deliverToRecipientMap(db, emit, recipients, () => ({
      eventType: NOTIFICATION_EVENTS.LAB_RESULT_READY,
      targetType: NOTIFICATION_TARGET_TYPES.LAB_ORDER,
      targetId: labOrderId,
      payload: {
        labOrderId,
        appointmentId: resolvedAppointmentId,
        doctorId: resolvedDoctorId,
        appointmentDate,
        status: 'COMPLETED',
        releasedToPatient: true,
      },
      dedupeKey: `${NOTIFICATION_EVENTS.LAB_RESULT_READY}:${labOrderId}`,
      titleAr: 'نتائج الفحوصات المخبرية متاحة',
      titleEn: 'Laboratory Results Available',
      messageAr: 'تم اعتماد وإتاحة نتائج فحوصاتك المخبرية. يمكنك عرضها الآن في بوابة المريض.',
      messageEn: 'Your laboratory results have been released and are now available to view.',
    }));
  } catch (error) {
    logger.warn('notification.lab_result_released_patient_failed', { labOrderId, error });
    return [];
  }
}

export async function notifyLabPricingRequired(db, emit, { labOrderId, serviceId } = {}) {
  if (!canDeliverNotifications(db) || !labOrderId || !serviceId) return [];
  try {
    const admins = await resolveStaffRecipientsByRoles(db, ['ADMIN']);
    if (!admins.length) return [];

    const recipients = new Map(admins.map((user) => [user.id, user]));
    return await deliverToRecipientMap(db, emit, recipients, () => ({
      eventType: NOTIFICATION_EVENTS.LAB_PRICING_REQUIRED,
      targetType: NOTIFICATION_TARGET_TYPES.SERVICE_PRICING,
      targetId: serviceId,
      dedupeKey: `${NOTIFICATION_EVENTS.LAB_PRICING_REQUIRED}:${serviceId}`,
      titleAr: 'خدمة مخبرية جديدة بانتظار التسعير',
      titleEn: 'Laboratory Service Pricing Required',
      messageAr: 'أضاف المختبر خدمة مخبرية جديدة غير مفعلة وتحتاج إلى تسعير وتفعيل من الإدارة.',
      messageEn: 'A newly created laboratory service requires administrator pricing and activation.',
    }));
  } catch (error) {
    logger.warn('notification.lab_pricing_required_failed', { labOrderId, serviceId, error });
    return [];
  }
}

export async function notifyPrescriptionReady(
  db,
  emit,
  { prescription, appointmentId = /** @type {string | null} */ (null), appointmentDate = /** @type {string | null} */ (null), needsReview = false } = {},
) {
  if (!canDeliverNotifications(db) || !prescription?.id) return [];
  try {
    const [pharmacists, patientUser, doctorNames] = await Promise.all([
      resolveStaffRecipientsByRoles(db, ['PHARMACIST']),
      resolvePatientRecipient(db, prescription.patientId),
      resolveDoctorNames(db, prescription.doctorId),
    ]);

    const recipients = new Map();
    for (const user of pharmacists) addRecipient(recipients, user);
    if (patientUser) addRecipient(recipients, patientUser);
    if (recipients.size === 0) return [];

    const dedupeKey = `${NOTIFICATION_EVENTS.PRESCRIPTION_READY}:${prescription.id}`;
    return await deliverToRecipientMap(db, emit, recipients, (recipient) => {
      const payload = {
        prescriptionId: prescription.id,
        appointmentId,
        doctorId: prescription.doctorId,
        appointmentDate,
        patientId: prescription.patientId,
        status: prescription.status || 'ACTIVE',
        ...(needsReview ? { needsReview: true } : {}),
      };

      if (recipient.role === 'PATIENT') {
        return {
          eventType: NOTIFICATION_EVENTS.PRESCRIPTION_READY,
          targetType: NOTIFICATION_TARGET_TYPES.PRESCRIPTION,
          targetId: prescription.id,
          payload,
          dedupeKey,
          titleAr: 'تم إصدار وصفة طبية جديدة',
          titleEn: 'New Prescription Issued',
          messageAr: `أصدر ${doctorNames.fullNameAr} وصفة طبية جديدة لك. يرجى مراجعة الصيدلية.`,
          messageEn: `${doctorNames.fullNameEn} has issued a new prescription for you. Please check with the pharmacy.`,
        };
      }

      return {
        eventType: NOTIFICATION_EVENTS.PRESCRIPTION_READY,
        targetType: NOTIFICATION_TARGET_TYPES.PRESCRIPTION,
        targetId: prescription.id,
        payload,
        dedupeKey,
        titleAr: needsReview ? 'وصفة طبية بانتظار مراجعة الصيدلي' : 'وصفة طبية جديدة جاهزة للصيدلية',
        titleEn: needsReview ? 'Prescription Pending Pharmacy Review' : 'New Prescription Ready',
        messageAr: needsReview
          ? `تم استلام وصفة طبية جديدة من ${doctorNames.fullNameAr} تتضمن أدوية تحتاج مراجعة صيدلانية.`
          : `تم استلام وصفة طبية جديدة من ${doctorNames.fullNameAr} وجاهزة للمتابعة الصيدلانية.`,
        messageEn: needsReview
          ? `A new prescription from ${doctorNames.fullNameEn} contains items awaiting pharmacy review.`
          : `A new prescription from ${doctorNames.fullNameEn} is ready for pharmacy processing.`,
      };
    });
  } catch (error) {
    logger.warn('notification.prescription_ready_failed', { prescriptionId: prescription?.id, error });
    return [];
  }
}

export async function notifyPharmacyPaymentRecorded(
  db,
  emit,
  { prescriptionId, invoiceId, patientId = /** @type {string | null} */ (null), doctorId = /** @type {string | null} */ (null), appointmentId = /** @type {string | null} */ (null), actorUserId = /** @type {string | null} */ (null) } = {},
) {
  if (!canDeliverNotifications(db) || !prescriptionId) return [];
  try {
    let resolvedPatientId = patientId;
    let resolvedDoctorId = doctorId;
    let resolvedAppointmentId = appointmentId;
    if ((!resolvedPatientId || !resolvedDoctorId) && db.prescription?.findUnique) {
      const rx = await db.prescription.findUnique({
        where: { id: prescriptionId },
        select: { patientId: true, doctorId: true, medicalRecord: { select: { appointmentId: true } } },
      });
      resolvedPatientId = resolvedPatientId || rx?.patientId || null;
      resolvedDoctorId = resolvedDoctorId || rx?.doctorId || null;
      resolvedAppointmentId = resolvedAppointmentId || rx?.medicalRecord?.appointmentId || null;
    }

    const [patientUser, otherPharmacists] = await Promise.all([
      resolvePatientRecipient(db, resolvedPatientId),
      resolveStaffRecipientsByRoles(db, ['PHARMACIST'], { excludeUserId: actorUserId }),
    ]);

    const recipients = new Map();
    if (patientUser) addRecipient(recipients, patientUser);
    for (const user of otherPharmacists) addRecipient(recipients, user);
    if (recipients.size === 0) return [];

    const dedupeKey = `${NOTIFICATION_EVENTS.PHARMACY_PAYMENT_RECORDED}:${prescriptionId}:${invoiceId || 'paid'}`;
    return await deliverToRecipientMap(db, emit, recipients, (recipient) => {
      const payload = {
        prescriptionId,
        invoiceId,
        appointmentId: resolvedAppointmentId,
        doctorId: resolvedDoctorId,
        patientId: resolvedPatientId,
        status: 'PAID',
      };

      if (recipient.role === 'PATIENT') {
        return {
          eventType: NOTIFICATION_EVENTS.PHARMACY_PAYMENT_RECORDED,
          targetType: NOTIFICATION_TARGET_TYPES.PRESCRIPTION,
          targetId: prescriptionId,
          payload,
          dedupeKey,
          titleAr: 'تم سداد فاتورة الصيدلية',
          titleEn: 'Pharmacy Payment Confirmed',
          messageAr: 'تم تأكيد سداد فاتورة وصفتك الطبية وهي جاهزة للصرف في الصيدلية.',
          messageEn: 'Payment for your prescription has been confirmed and is ready for dispensing at the pharmacy.',
        };
      }

      return {
        eventType: NOTIFICATION_EVENTS.PHARMACY_PAYMENT_RECORDED,
        targetType: NOTIFICATION_TARGET_TYPES.PRESCRIPTION,
        targetId: prescriptionId,
        payload,
        dedupeKey,
        titleAr: 'فاتورة صيدلية مدفوعة وجاهزة للصرف',
        titleEn: 'Pharmacy Invoice Paid',
        messageAr: 'تم سداد فاتورة الوصفة الطبية وأصبحت جاهزة للصرف.',
        messageEn: 'A pharmacy invoice has been paid and is ready for dispensing.',
      };
    });
  } catch (error) {
    logger.warn('notification.pharmacy_payment_failed', { prescriptionId, error });
    return [];
  }
}

export async function notifyPrescriptionDispensed(
  db,
  emit,
  { prescriptionId, patientId = /** @type {string | null} */ (null), doctorId = /** @type {string | null} */ (null), appointmentId = /** @type {string | null} */ (null), prescriptionStatus = 'FILLED', totalDispensedAfter = 0 } = {},
) {
  if (!canDeliverNotifications(db) || !prescriptionId) return [];
  try {
    let resolvedPatientId = patientId;
    let resolvedDoctorId = doctorId;
    let resolvedAppointmentId = appointmentId;
    if ((!resolvedPatientId || !resolvedDoctorId) && db.prescription?.findUnique) {
      const rx = await db.prescription.findUnique({
        where: { id: prescriptionId },
        select: { patientId: true, doctorId: true, medicalRecord: { select: { appointmentId: true } } },
      });
      resolvedPatientId = resolvedPatientId || rx?.patientId || null;
      resolvedDoctorId = resolvedDoctorId || rx?.doctorId || null;
      resolvedAppointmentId = resolvedAppointmentId || rx?.medicalRecord?.appointmentId || null;
    }

    const patientUser = await resolvePatientRecipient(db, resolvedPatientId);
    if (!patientUser) return [];

    const isPartial = prescriptionStatus === 'PARTIALLY_FILLED';
    return await deliverToRecipientMap(db, emit, new Map([[patientUser.id, patientUser]]), () => ({
      eventType: NOTIFICATION_EVENTS.PRESCRIPTION_DISPENSED,
      targetType: NOTIFICATION_TARGET_TYPES.PRESCRIPTION,
      targetId: prescriptionId,
      payload: {
        prescriptionId,
        appointmentId: resolvedAppointmentId,
        doctorId: resolvedDoctorId,
        status: prescriptionStatus,
      },
      dedupeKey: `${NOTIFICATION_EVENTS.PRESCRIPTION_DISPENSED}:${prescriptionId}:${prescriptionStatus}:${totalDispensedAfter}`,
      titleAr: isPartial ? 'تم صرف جزء من الوصفة الطبية' : 'تم صرف الوصفة الطبية',
      titleEn: isPartial ? 'Prescription Partially Dispensed' : 'Prescription Dispensed',
      messageAr: isPartial
        ? 'تم صرف جزء من أدويتك من الصيدلية. يرجى مراجعة تفاصيل الوصفة في بوابتك.'
        : 'تم صرف وصفتك الطبية بالكامل من الصيدلية.',
      messageEn: isPartial
        ? 'Part of your prescription has been dispensed by the pharmacy. Check your portal for details.'
        : 'Your prescription has been completely dispensed by the pharmacy.',
    }));
  } catch (error) {
    logger.warn('notification.prescription_dispensed_failed', { prescriptionId, error });
    return [];
  }
}

export async function notifyPharmacyMedicationExternal(
  db,
  emit,
  { prescribedDrugId, prescriptionId, patientId = /** @type {string | null} */ (null), doctorId = /** @type {string | null} */ (null), appointmentId = /** @type {string | null} */ (null), appointmentDate = /** @type {string | null} */ (null) } = {},
) {
  if (!canDeliverNotifications(db) || !prescriptionId || !prescribedDrugId) return [];
  try {
    let resolvedPatientId = patientId;
    let resolvedDoctorId = doctorId;
    let resolvedAppointmentId = appointmentId;
    let resolvedAppointmentDate = appointmentDate;
    if ((!resolvedPatientId || !resolvedDoctorId) && db.prescription?.findUnique) {
      const rx = await db.prescription.findUnique({
        where: { id: prescriptionId },
        select: { patientId: true, doctorId: true, medicalRecord: { select: { appointmentId: true, appointment: { select: { appointmentDate: true } } } } },
      });
      resolvedPatientId = resolvedPatientId || rx?.patientId || null;
      resolvedDoctorId = resolvedDoctorId || rx?.doctorId || null;
      resolvedAppointmentId = resolvedAppointmentId || rx?.medicalRecord?.appointmentId || null;
      resolvedAppointmentDate = resolvedAppointmentDate || rx?.medicalRecord?.appointment?.appointmentDate || null;
    }

    const [doctorResolved, patientUser] = await Promise.all([
      resolveDoctorRecipient(db, resolvedDoctorId),
      resolvePatientRecipient(db, resolvedPatientId),
    ]);

    const recipients = new Map();
    if (doctorResolved?.user) addRecipient(recipients, doctorResolved.user);
    if (patientUser) addRecipient(recipients, patientUser);
    if (recipients.size === 0) return [];

    const dedupeKey = `${NOTIFICATION_EVENTS.PHARMACY_MEDICATION_EXTERNAL}:${prescribedDrugId}`;
    return await deliverToRecipientMap(db, emit, recipients, (recipient) => {
      const payload = {
        prescriptionId,
        appointmentId: resolvedAppointmentId,
        appointmentDate: resolvedAppointmentDate,
        doctorId: resolvedDoctorId,
        patientId: resolvedPatientId,
        status: 'EXTERNAL',
      };

      if (recipient.role === 'PATIENT') {
        return {
          eventType: NOTIFICATION_EVENTS.PHARMACY_MEDICATION_EXTERNAL,
          targetType: NOTIFICATION_TARGET_TYPES.PRESCRIPTION,
          targetId: prescriptionId,
          payload,
          dedupeKey,
          titleAr: 'تحديث حول توفر دواء في الصيدلية',
          titleEn: 'Prescription Medication Update',
          messageAr: 'أحد الأدوية في وصفتك غير متوفر في صيدلية العيادة ويمكن شراؤه من خارج العيادة.',
          messageEn: 'An item in your prescription is unavailable at the clinic pharmacy and marked for external purchase.',
        };
      }

      return {
        eventType: NOTIFICATION_EVENTS.PHARMACY_MEDICATION_EXTERNAL,
        targetType: NOTIFICATION_TARGET_TYPES.PRESCRIPTION,
        targetId: prescriptionId,
        payload,
        dedupeKey,
        titleAr: 'تحويل دواء للشراء الخارجي',
        titleEn: 'Medication Marked External',
        messageAr: 'قامت الصيدلية بتحديث أحد بنود الوصفة الطبية للشراء الخارجي لعدم توفره.',
        messageEn: 'Pharmacy marked a prescribed medication item as external.',
      };
    });
  } catch (error) {
    logger.warn('notification.pharmacy_external_failed', { prescriptionId, prescribedDrugId, error });
    return [];
  }
}

export async function notifyPharmacyPricingRequired(db, emit, { prescriptionId, drugId } = {}) {
  if (!canDeliverNotifications(db) || !prescriptionId || !drugId) return [];
  try {
    const admins = await resolveStaffRecipientsByRoles(db, ['ADMIN']);
    if (!admins.length) return [];

    const recipients = new Map(admins.map((user) => [user.id, user]));
    return await deliverToRecipientMap(db, emit, recipients, () => ({
      eventType: NOTIFICATION_EVENTS.PHARMACY_PRICING_REQUIRED,
      targetType: NOTIFICATION_TARGET_TYPES.MEDICINE_PRICING,
      targetId: drugId,
      dedupeKey: `${NOTIFICATION_EVENTS.PHARMACY_PRICING_REQUIRED}:${drugId}`,
      titleAr: 'دواء جديد بانتظار التسعير والتفعيل',
      titleEn: 'Medicine Pricing Required',
      messageAr: 'أضاف الصيدلي دواءً جديداً إلى الدليل ويحتاج إلى تسعير وتفعيل من الإدارة.',
      messageEn: 'A newly added formulary medicine requires administrator pricing and activation.',
    }));
  } catch (error) {
    logger.warn('notification.pharmacy_pricing_required_failed', { prescriptionId, drugId, error });
    return [];
  }
}

export async function notifyPharmacyInvoiceReady(
  db,
  emit,
  { prescriptionId, invoiceId, patientId = /** @type {string | null} */ (null), doctorId = /** @type {string | null} */ (null), appointmentId = /** @type {string | null} */ (null) } = {},
) {
  if (!canDeliverNotifications(db) || !prescriptionId || !invoiceId) return [];
  try {
    let resolvedPatientId = patientId;
    let resolvedDoctorId = doctorId;
    let resolvedAppointmentId = appointmentId;
    if ((!resolvedPatientId || !resolvedDoctorId) && db.prescription?.findUnique) {
      const rx = await db.prescription.findUnique({
        where: { id: prescriptionId },
        select: { patientId: true, doctorId: true, medicalRecord: { select: { appointmentId: true } } },
      });
      resolvedPatientId = resolvedPatientId || rx?.patientId || null;
      resolvedDoctorId = resolvedDoctorId || rx?.doctorId || null;
      resolvedAppointmentId = resolvedAppointmentId || rx?.medicalRecord?.appointmentId || null;
    }

    const [pharmacists, patientUser] = await Promise.all([
      resolveStaffRecipientsByRoles(db, ['PHARMACIST']),
      resolvePatientRecipient(db, resolvedPatientId),
    ]);

    const recipients = new Map();
    for (const user of pharmacists) addRecipient(recipients, user);
    if (patientUser) addRecipient(recipients, patientUser);
    if (recipients.size === 0) return [];

    const dedupeKey = `${NOTIFICATION_EVENTS.PHARMACY_INVOICE_READY}:${invoiceId}`;
    return await deliverToRecipientMap(db, emit, recipients, (recipient) => {
      const payload = {
        prescriptionId,
        invoiceId,
        appointmentId: resolvedAppointmentId,
        doctorId: resolvedDoctorId,
        patientId: resolvedPatientId,
        status: 'UNPAID',
      };

      if (recipient.role === 'PATIENT') {
        return {
          eventType: NOTIFICATION_EVENTS.PHARMACY_INVOICE_READY,
          targetType: NOTIFICATION_TARGET_TYPES.PRESCRIPTION,
          targetId: prescriptionId,
          payload,
          dedupeKey,
          titleAr: 'فاتورة الصيدلية جاهزة للسداد',
          titleEn: 'Pharmacy Invoice Ready',
          messageAr: 'تم تسعير وصفتك الطبية وأصبحت فاتورة الصيدلية جاهزة للسداد والصرف.',
          messageEn: 'Your prescription has been priced and the pharmacy invoice is ready for payment.',
        };
      }

      return {
        eventType: NOTIFICATION_EVENTS.PHARMACY_INVOICE_READY,
        targetType: NOTIFICATION_TARGET_TYPES.PRESCRIPTION,
        targetId: prescriptionId,
        payload,
        dedupeKey,
        titleAr: 'فاتورة صيدلية جاهزة للتحصيل',
        titleEn: 'Pharmacy Invoice Ready',
        messageAr: 'أصبحت فاتورة الوصفة الطبية جاهزة للتحصيل في الصيدلية بعد تفعيل تسعيرة الدواء.',
        messageEn: 'A prescription pharmacy invoice has been generated and is ready for payment.',
      };
    });
  } catch (error) {
    logger.warn('notification.pharmacy_invoice_ready_failed', { prescriptionId, invoiceId, error });
    return [];
  }
}
