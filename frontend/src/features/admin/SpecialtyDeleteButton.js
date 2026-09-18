import { createElement, useRef, useState } from 'react';

const messages = {
  en: {
    label: 'Delete', pending: 'Deleting…',
    confirm: 'Permanently delete this specialty? This cannot be undone.',
    success: 'Specialty deleted.',
    401: 'Your session has expired. Please sign in again.',
    403: 'Only an administrator can delete specialties.',
    404: 'This specialty no longer exists. Reload the specialties list.',
    409: 'This specialty cannot be deleted because it is referenced by existing data. You can deactivate it instead.',
    failure: 'Unable to delete the specialty. Please try again.'
  },
  ar: {
    label: 'حذف', pending: 'جارٍ الحذف…',
    confirm: 'هل تريد حذف هذا التخصص نهائياً؟ لا يمكن التراجع عن هذا الإجراء.',
    success: 'تم حذف التخصص.',
    401: 'انتهت جلستك. يرجى تسجيل الدخول مرة أخرى.',
    403: 'يمكن لمدير النظام فقط حذف التخصصات.',
    404: 'هذا التخصص لم يعد موجوداً. يرجى إعادة تحميل قائمة التخصصات.',
    409: 'لا يمكن حذف هذا التخصص لأنه مرتبط ببيانات موجودة. يمكنك تعطيله بدلاً من حذفه.',
    failure: 'تعذر حذف التخصص. يرجى المحاولة مرة أخرى.'
  }
};

export default function SpecialtyDeleteButton({ specialty, lang, request, onDeleted, onFeedback, disabled = false }) {
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const text = messages[lang === 'ar' ? 'ar' : 'en'];
  const remove = async () => {
    if (disabled || inFlight.current) return;
    if (!globalThis.confirm(`${text.confirm}\n${lang === 'ar' ? specialty.nameAr : specialty.nameEn}`)) return;
    inFlight.current = true;
    setPending(true);
    onFeedback(null);
    try {
      const response = await request(`/api/specialties/${encodeURIComponent(specialty.id)}`, { method: 'DELETE' });
      if (!response.ok) {
        onFeedback({ type: 'error', message: text[response.status] || text.failure });
        return;
      }
      onDeleted(specialty.id);
      onFeedback({ type: 'success', message: text.success });
    } catch {
      onFeedback({ type: 'error', message: text.failure });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };
  return createElement('button', { type: 'button', className: 'btn btn-danger', disabled: disabled || pending, 'aria-busy': pending, onClick: remove }, pending ? text.pending : text.label);
}
