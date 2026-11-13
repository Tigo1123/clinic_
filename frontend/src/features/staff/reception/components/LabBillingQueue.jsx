
export default function LabBillingQueue({ lang, labBillingLoading, labBillingOrders, selectedLabBillingOrder, refreshLabBillingQueue, handleSelectLabBillingOrder }) {
  return (
    <section
      className="glass-panel"
      style={{
        padding: '1rem',
        marginBottom: '0.75rem'
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.75rem',
          marginBottom: '0.75rem'
        }}
      >
        <div>
          <strong>
            {lang === 'ar'
              ? 'فواتير المختبر'
              : 'Laboratory Bills'}
          </strong>

          <div
            style={{
              fontSize: '0.78rem',
              color: 'var(--text-secondary)',
              marginTop: '0.2rem'
            }}
          >
            {lang === 'ar'
              ? 'طلبات الفحوصات الصادرة من الطبيب'
              : 'Diagnostic orders submitted by doctors'}
          </div>
        </div>

        <button
          type="button"
          className="btn btn-secondary"
          style={{
            padding: '4px 10px',
            fontSize: '0.75rem'
          }}
          onClick={refreshLabBillingQueue}
          disabled={labBillingLoading}
        >
          {labBillingLoading
            ? (lang === 'ar'
                ? 'جاري التحديث...'
                : 'Refreshing...')
            : (lang === 'ar'
                ? 'تحديث'
                : 'Refresh')}
        </button>
      </div>

      {labBillingOrders.length === 0 ? (
        <div
          style={{
            padding: '1rem',
            textAlign: 'center',
            color: 'var(--text-secondary)',
            fontSize: '0.85rem'
          }}
        >
          {lang === 'ar'
            ? 'لا توجد طلبات مختبر تحتاج متابعة مالية حالياً.'
            : 'No laboratory orders currently require billing follow-up.'}
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem'
          }}
        >
          {labBillingOrders.map((order) => {
            const remaining =
              order.invoice?.remainingBalanceSdg ??
              order.estimatedTotalSdg ??
              0;

            const paid = order.status === 'PAID';

            return (
              <button
                key={order.id}
                type="button"
                className={`queue-card-item glass-panel ${
                  selectedLabBillingOrder?.id === order.id
                    ? 'selected'
                    : ''
                }`}
                style={{
                  width: '100%',
                  textAlign: 'start',
                  cursor: 'pointer'
                }}
                onClick={() =>
                  handleSelectLabBillingOrder(order)
                }
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    flexWrap: 'wrap'
                  }}
                >
                  <strong>
                    {lang === 'ar'
                      ? order.patient.fullNameAr
                      : order.patient.fullNameEn}
                  </strong>

                  <span
                    className={`badge ${
                      paid
                        ? 'badge-success'
                        : 'badge-warning'
                    }`}
                  >
                    {order.pricingRequired
                      ? (lang === 'ar'
                          ? 'بانتظار مراجعة المختبر'
                          : 'Lab Review Pending')
                      : paid
                        ? (lang === 'ar'
                            ? 'مدفوع'
                            : 'Paid')
                        : order.billingStatus ===
                            'PARTIALLY_PAID'
                          ? (lang === 'ar'
                              ? 'مدفوع جزئياً'
                              : 'Partially Paid')
                          : (lang === 'ar'
                              ? 'بانتظار الدفع'
                              : 'Waiting for Payment')}
                  </span>
                </div>

                <div
                  style={{
                    fontSize: '0.8rem',
                    color: 'var(--text-secondary)',
                    marginTop: '0.35rem'
                  }}
                >
                  {order.items
                    .map((item) =>
                      lang === 'ar'
                        ? item.service?.labelAr ||
                          `${item.customTestName}${item.labReviewStatus === 'EXTERNAL' ? ' — خارجي' : ''}`
                        : item.service?.labelEn ||
                          `${item.customTestName}${item.labReviewStatus === 'EXTERNAL' ? ' — External' : ''}`
                    )
                    .filter(Boolean)
                    .join(' • ')}
                </div>

                {!order.pricingRequired && (
                  <div
                    style={{
                      marginTop: '0.35rem',
                      fontWeight: '600'
                    }}
                  >
                    {paid
                      ? (lang === 'ar'
                          ? 'جاهز للمختبر'
                          : 'Ready for Laboratory')
                      : `${lang === 'ar'
                          ? 'المتبقي'
                          : 'Remaining'}: ${Number(
                          remaining
                        ).toLocaleString(
                          lang === 'ar'
                            ? 'ar'
                            : 'en'
                        )} ${
                          lang === 'ar'
                            ? 'ج.س'
                            : 'SDG'
                        }`}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
