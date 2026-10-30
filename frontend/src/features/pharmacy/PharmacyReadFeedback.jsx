import { pharmacyReadErrorMessage } from '../../services/pharmacyReads.js';
export default function PharmacyReadFeedback({ resource, lang, label }) {
  if (!resource.loading && !resource.error && !resource.hasMore) return null;
  return <div className="pharmacy-read-feedback" aria-label={label}>
    {resource.error && <p role="alert">{label}: {pharmacyReadErrorMessage(resource.error, lang)}</p>}
    {resource.loading && <p role="status">{label}: {lang === 'ar' ? 'جارٍ التحميل…' : 'Loading…'}</p>}
    {(resource.loading || resource.error) && <button type="button" className="btn btn-secondary" onClick={resource.loading ? resource.cancel : resource.reload}>{resource.loading ? (lang === 'ar' ? 'إلغاء التحميل' : 'Cancel loading') : (lang === 'ar' ? 'إعادة المحاولة' : 'Retry')}</button>}
    {resource.hasMore && <button type="button" className="btn btn-secondary" disabled={resource.loading} onClick={resource.loadMore}>{lang === 'ar' ? 'تحميل المزيد' : 'Load more'} — {label}</button>}
  </div>;
}
