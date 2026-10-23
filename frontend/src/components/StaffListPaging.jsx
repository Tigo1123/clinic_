export default function StaffListPaging({ list, lang = 'en', label }) {
  return <div className="staff-list-paging" aria-label={label}>
    {list.error && <p role="alert">{lang === 'ar' ? 'تعذر تحميل القائمة.' : list.error} <button type="button" className="btn btn-secondary" onClick={list.reload} disabled={list.loading}>{lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}</button></p>}
    {list.loading && <p role="status">{lang === 'ar' ? 'جارٍ التحميل…' : 'Loading…'}</p>}
    {list.hasMore && <button type="button" className="btn btn-secondary" onClick={list.loadMore} disabled={list.loading}>{lang === 'ar' ? 'تحميل المزيد' : 'Load more'}{label ? ` — ${label}` : ''}</button>}
  </div>;
}
