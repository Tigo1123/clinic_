export default function ServiceOrderBillingOptions({ lang, orders, status, selectedOrderId, onSelect, onRetry, disabled }) {
  return (
    <section className="ui-panel reception-services-panel" aria-labelledby="reception-service-orders-title">
      <h2 id="reception-service-orders-title" className="reception-panel-title">
        {lang === 'ar' ? 'طلبات الطبيب' : 'Doctor orders'}
      </h2>
      {status === 'loading' && <p role="status">{lang === 'ar' ? 'جارٍ تحميل الطلبات...' : 'Loading orders…'}</p>}
      {status === 'error' && (
        <p role="alert">
          {lang === 'ar' ? 'تعذر تحميل الطلبات.' : 'Unable to load doctor orders.'}{' '}
          <button className="btn btn-secondary" type="button" onClick={onRetry}>{lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}</button>
        </p>
      )}
      {status === 'ready' && !orders.length && (
        <p>{lang === 'ar' ? 'لا توجد طلبات إجراءات بانتظار الدفع لهذا المريض.' : 'This patient has no procedure orders awaiting payment.'}</p>
      )}
      {status === 'ready' && orders.length > 0 && (
        <ul className="reception-services-list">
          {orders.map((order) => (
            <li key={order.id} className="reception-service-row">
              <div>
                <strong>{order.items.map((item) => lang === 'ar' ? item.labelAr : item.labelEn).join(lang === 'ar' ? '، ' : ', ')}</strong>
                <div>{lang === 'ar' ? order.doctor.fullNameAr : order.doctor.fullNameEn}</div>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={disabled}
                onClick={() => onSelect(order)}
              >
                {selectedOrderId === order.id
                  ? (lang === 'ar' ? 'تحديث الطلب' : 'Refresh order')
                  : (lang === 'ar' ? 'فتح الطلب' : 'Open order')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
