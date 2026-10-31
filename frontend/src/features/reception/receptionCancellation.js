export class CancellationError extends Error {
  constructor(status, code) { super(code || 'CANCELLATION_FAILED'); this.status = status; this.code = code; }
}

export async function cancelReceptionAppointment(request, appointmentId) {
  const response = await request(`/api/appointments/${encodeURIComponent(appointmentId)}/status`, {
    method: 'PUT', body: JSON.stringify({ status: 'CANCELLED' })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new CancellationError(response.status, payload?.error?.code || payload?.code);
  if (payload?.id !== appointmentId || payload?.status !== 'CANCELLED') throw new CancellationError(0, 'CANCELLATION_RESPONSE_INVALID');
  return payload;
}

export function cancellationErrorMessage(error, lang) {
  const index = lang === 'ar' ? 0 : 1;
  const status = ['APPOINTMENT_STATE_CONFLICT', 'ILLEGAL_APPOINTMENT_STATUS_TRANSITION'].includes(error?.code) ? 409
    : error?.code === 'APPOINTMENT_NOT_FOUND' ? 404 : error?.status;
  const messages = {
    400: ['تعذر إلغاء الموعد بالبيانات الحالية. حدّث القائمة وحاول مرة أخرى.', 'Unable to cancel this appointment with the current data. Refresh the list and retry.'],
    401: ['انتهت الجلسة. سجّل الدخول مجدداً.', 'Your session has expired. Please sign in again.'],
    403: ['ليس لديك صلاحية لإلغاء هذا الموعد.', 'You do not have permission to cancel this appointment.'],
    404: ['لم يعد هذا الموعد متاحاً. تم طلب تحديث القائمة.', 'This appointment is no longer available. The list is being refreshed.'],
    409: ['تغيّرت حالة الموعد ولم يتم تأكيد إلغائه. راجع القائمة المحدّثة قبل المحاولة مجدداً.', 'The appointment changed and cancellation was not confirmed. Review the refreshed list before retrying.'],
    422: ['تعذر التحقق من بيانات الإلغاء. حدّث القائمة وحاول مرة أخرى.', 'The cancellation details could not be validated. Refresh the list and retry.'],
    429: ['عدد المحاولات كبير. انتظر قليلاً ثم حاول مجدداً.', 'Too many attempts. Please wait and retry.']
  };
  if (messages[status]) return messages[status][index];
  if (status >= 500) return ['تعذر إلغاء الموعد الآن. حاول مرة أخرى.', 'Unable to cancel the appointment right now. Please retry.'][index];
  return ['تعذر تأكيد نتيجة الإلغاء. تحقق من الاتصال وراجع القائمة المحدّثة قبل المحاولة مجدداً.', 'The cancellation could not be confirmed. Check your connection and review the refreshed list before retrying.'][index];
}

// CANCELLED is terminal. A delayed GET/replica snapshot must not restore a
// committed cancellation to either the pending approvals or active queue.
export function createCancellationFence() {
  const committed = new Set();
  return { record(id) { committed.add(id); }, reconcile(_previous, rows) { return rows.filter(row => !committed.has(row.id)); } };
}
