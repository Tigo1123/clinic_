import { FlaskConical, RefreshCw } from 'lucide-react';

export default function LabBillingQueue({
  lang,
  labBillingLoading,
  labBillingOrders,
  selectedLabBillingOrder,
  refreshLabBillingQueue,
  handleSelectLabBillingOrder
}) {
  return (
    <div className="reception-view-container">
      <header className="reception-view-header">
        <div className="reception-view-header-start">
          <h1 className="ui-page-title">{lang === 'ar' ? 'فواتير المختبر' : 'Lab billing'}</h1>
          <span className="reception-header-subtitle">
            {lang === 'ar'
              ? 'طلبات الفحوصات الصادرة من الطبيب'
              : 'Diagnostic orders submitted by doctors'}
          </span>
        </div>
        <button
          type="button"
          className="btn btn-secondary reception-refresh-btn"
          onClick={refreshLabBillingQueue}
          disabled={labBillingLoading}
        >
          <RefreshCw size={14} className={labBillingLoading ? 'spin' : ''} aria-hidden="true" />
          <span>
            {labBillingLoading
              ? (lang === 'ar' ? 'جاري التحديث...' : 'Refreshing...')
              : (lang === 'ar' ? 'تحديث' : 'Refresh')}
          </span>
        </button>
      </header>

      <div className="ui-panel reception-lab-panel">
        <div className="reception-lab-panel-header">
          <div className="reception-lab-title-wrap">
            <FlaskConical size={18} aria-hidden="true" />
            <h2 className="reception-panel-title">
              {lang === 'ar' ? 'طلبات بانتظار التحصيل' : 'Orders Awaiting Payment'}
            </h2>
          </div>
          <span className="reception-panel-count">
            {labBillingOrders.length} {lang === 'ar' ? 'طلبات' : 'orders'}
          </span>
        </div>

        {labBillingOrders.length === 0 ? (
          <div className="reception-panel-empty">
            <span>
              {lang === 'ar'
                ? 'لا توجد طلبات مختبر تحتاج متابعة مالية حالياً.'
                : 'No laboratory orders currently require billing follow-up.'}
            </span>
          </div>
        ) : (
          <div className="reception-lab-list">
            {labBillingOrders.map((order) => {
              const remaining =
                order.invoice?.remainingBalanceSdg ??
                order.estimatedTotalSdg ??
                0;
              const paid = order.status === 'PAID';
              const isSelected = selectedLabBillingOrder?.id === order.id;

              let statusClass = 'ui-status--warn';
              let statusLabel = lang === 'ar' ? 'بانتظار الدفع' : 'Waiting for Payment';

              if (order.pricingRequired) {
                statusClass = 'ui-status--warn';
                statusLabel = lang === 'ar' ? 'بانتظار مراجعة المختبر' : 'Lab Review Pending';
              } else if (paid) {
                statusClass = 'ui-status--ok';
                statusLabel = lang === 'ar' ? 'مدفوع' : 'Paid';
              } else if (order.billingStatus === 'PARTIALLY_PAID') {
                statusClass = 'ui-status--warn';
                statusLabel = lang === 'ar' ? 'مدفوع جزئياً' : 'Partially Paid';
              }

              const patientName = lang === 'ar'
                ? order.patient?.fullNameAr || order.patient?.fullNameEn || '—'
                : order.patient?.fullNameEn || order.patient?.fullNameAr || '—';

              const testsSummary = order.items
                .map((item) =>
                  lang === 'ar'
                    ? item.service?.labelAr ||
                      `${item.customTestName}${item.labReviewStatus === 'EXTERNAL' ? ' — خارجي' : ''}`
                    : item.service?.labelEn ||
                      `${item.customTestName}${item.labReviewStatus === 'EXTERNAL' ? ' — External' : ''}`
                )
                .filter(Boolean)
                .join(' • ');

              return (
                <article
                  key={order.id}
                  className={`reception-lab-row ${isSelected ? 'is-selected' : ''}`}
                >
                  <div className="reception-lab-patient">
                    <strong>{patientName}</strong>
                    <span className="ui-mono" dir="ltr">{order.patient?.fileNumber || '—'}</span>
                  </div>

                  <div className="reception-lab-tests" title={testsSummary}>
                    {testsSummary || (lang === 'ar' ? 'فحوصات مختبر' : 'Laboratory tests')}
                  </div>

                  <span className={`ui-status ${statusClass} reception-lab-status`}>
                    {statusLabel}
                  </span>

                  <span className="ui-mono reception-lab-amount" dir="ltr">
                    {!order.pricingRequired && !paid && `${Number(remaining).toLocaleString(lang === 'ar' ? 'ar' : 'en')} ${lang === 'ar' ? 'ج.س' : 'SDG'}`}
                    {paid && <span className="reception-lab-ready-text">{lang === 'ar' ? 'جاهز للمختبر' : 'Ready for Laboratory'}</span>}
                  </span>

                  <div className="reception-lab-action">
                    <button
                      type="button"
                      className="btn btn-secondary reception-lab-action-btn"
                      onClick={() => handleSelectLabBillingOrder(order)}
                    >
                      {paid
                        ? (lang === 'ar' ? 'عرض الفاتورة' : 'View Invoice')
                        : order.billingStatus === 'PARTIALLY_PAID'
                          ? (lang === 'ar' ? 'إكمال دفع المختبر' : 'Continue Laboratory Payment')
                          : (lang === 'ar' ? 'دفع رسوم المختبر' : 'Pay Laboratory')}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
