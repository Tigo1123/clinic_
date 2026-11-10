/**
 * Shared paging action for pharmacist lists. Existing records stay visible
 * while the next page is loaded, and failures are handled by PharmacyReadFeedback.
 */
export default function PharmacyLoadMore({ resource, lang }) {
  if (!resource.hasMore) return null;
  const isArabic = lang === 'ar';
  return (
    <button
      type="button"
      className="btn btn-secondary"
      onClick={resource.loadMore}
      disabled={resource.loading}
      aria-label={isArabic ? 'تحميل المزيد من سجلات الصيدلية' : 'Load more pharmacy records'}
    >
      {resource.loading
        ? (isArabic ? 'جارٍ التحميل...' : 'Loading...')
        : (isArabic ? 'تحميل المزيد' : 'Load more')}
    </button>
  );
}
