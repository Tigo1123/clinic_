import { localizedStockState } from '../pharmacyHelpers';

export default function PharmacyAlertsBody({ lang, alertLoadError, alertMedicines, alertModel, onRetry }) {
  if (alertLoadError) {
    return (
      <div className="pharmacy-compact-empty ui-panel">
        <p role="alert" className="pharmacy-empty-text">{alertLoadError}</p>
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          {lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}
        </button>
      </div>
    );
  }

  if (alertMedicines === null) {
    return (
      <div className="pharmacy-compact-empty ui-panel">
        <p className="pharmacy-empty-text">{lang === 'ar' ? 'جارٍ تحميل التنبيهات…' : 'Loading alerts…'}</p>
      </div>
    );
  }

  if (alertModel.totalAlertCount === 0) {
    return (
      <div className="pharmacy-compact-empty ui-panel">
        <p className="pharmacy-empty-text">
          {lang === 'ar'
            ? 'لا توجد تنبيهات مخزون أو صلاحية حالياً.'
            : 'There are no inventory or expiry alerts at this time.'}
        </p>
      </div>
    );
  }

  const groups = [
    ['OUT_OF_STOCK', lang === 'ar' ? 'نفد المخزون' : 'Out of stock', alertModel.stockAlerts.filter((alert) => alert.state === 'OUT_OF_STOCK'), 'danger'],
    ['LOW_STOCK', lang === 'ar' ? 'مخزون منخفض' : 'Low stock', alertModel.stockAlerts.filter((alert) => alert.state === 'LOW_STOCK'), 'warning'],
    ['NEAR_EXPIRY', lang === 'ar' ? 'قريب انتهاء الصلاحية' : 'Near expiry', alertModel.nearExpiryAlerts, 'warning'],
    ['EXPIRED', lang === 'ar' ? 'منتهي الصلاحية' : 'Expired', alertModel.expiredAlerts, 'danger']
  ].filter(([, , alerts]) => alerts.length > 0);

  return (
    <div className="pharmacy-alert-groups">
      {groups.map(([state, title, alerts, tone]) => {
        const count = state === 'EXPIRED'
          ? alerts.reduce((total, alert) => total + alert.count, 0)
          : alerts.length;

        const statusToneClass = tone === 'danger' ? 'ui-status--danger' : 'ui-status--warn';

        return (
          <section key={state} className="pharmacy-alert-group ui-panel" aria-labelledby={`pharmacy-alert-${state}`}>
            <h3 id={`pharmacy-alert-${state}`} className="ui-section-label">
              <span>{title}</span>
              <span className="ui-mono" style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>{count}</span>
            </h3>
            <div className="pharmacy-alert-list">
              {alerts.map((alert) => (
                <article key={`${state}-${alert.medicine.id}`} className="pharmacy-alert-item ui-row">
                  <strong>{lang === 'ar' ? alert.medicine.labelAr : alert.medicine.labelEn}</strong>
                  <span className={`ui-status ${statusToneClass} ui-mono`}>
                    {state === 'LOW_STOCK'
                      ? (lang === 'ar' ? `${alert.stock.usableStock} متوفر` : `${alert.stock.usableStock} available`)
                      : state === 'EXPIRED'
                        ? (lang === 'ar' ? `${alert.count} دفعة منتهية` : `${alert.count} expired batch(es)`)
                        : localizedStockState(state, lang)}
                  </span>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
