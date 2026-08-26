const LABELS = {
  PENDING: ['قيد المراجعة', 'Pending review'],
  CONFIRMED: ['تم التأكيد', 'Confirmed'],
  SCHEDULED: ['تم التأكيد', 'Confirmed'],
  CANCELLED: ['تم الإلغاء', 'Cancelled'],
  CHECKED_IN: ['تم تسجيل الحضور', 'Checked in'],
  IN_CONSULTATION: ['داخل الاستشارة', 'In consultation'],
  WAITING_LAB: ['بانتظار المختبر', 'Waiting for laboratory'],
  COMPLETED: ['مكتمل', 'Completed'],
  NO_SHOW: ['لم يحضر', 'No show']
};

export function localizedAppointmentStatus(status, language = 'en') {
  const labels = LABELS[status];
  if (!labels) return String(status || 'UNKNOWN').replaceAll('_', ' ');
  return labels[language?.startsWith('ar') ? 0 : 1];
}

export function hasPendingAppointments(appointments) {
  return Array.isArray(appointments) && appointments.some((appointment) => appointment.status === 'PENDING');
}
