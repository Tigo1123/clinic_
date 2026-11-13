import { localizedStockState } from '../pharmacyHelpers';

export default function PharmacyAlertsBody({ lang, alertLoadError, alertMedicines, alertModel, onRetry }) {
  return (
    <>
      {alertLoadError ? (
        <div className="pharmacy-compact-empty"><p role="alert">{alertLoadError}</p><button type="button" className="btn" onClick={onRetry}>{lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}</button></div>
      ) : alertMedicines === null ? (
        <div className="pharmacy-compact-empty"><p>{lang === 'ar' ? 'جارٍ تحميل التنبيهات…' : 'Loading alerts…'}</p></div>
      ) : alertModel.totalAlertCount === 0 ? (
        <div className="pharmacy-compact-empty">
          <p>
            {lang === 'ar'
              ? 'لا توجد تنبيهات مخزون أو صلاحية حالياً.'
              : 'There are no inventory or expiry alerts at this time.'}
          </p>
        </div>
      ) : <div className="pharmacy-alert-groups">
        {[
          ['OUT_OF_STOCK', lang === 'ar' ? 'نفد المخزون' : 'Out of stock', alertModel.stockAlerts.filter((alert) => alert.state === 'OUT_OF_STOCK'), 'danger'],
          ['LOW_STOCK', lang === 'ar' ? 'مخزون منخفض' : 'Low stock', alertModel.stockAlerts.filter((alert) => alert.state === 'LOW_STOCK'), 'warning'],
          ['NEAR_EXPIRY', lang === 'ar' ? 'قريب انتهاء الصلاحية' : 'Near expiry', alertModel.nearExpiryAlerts, 'warning'],
          ['EXPIRED', lang === 'ar' ? 'منتهي الصلاحية' : 'Expired', alertModel.expiredAlerts, 'danger']
        ].filter(([, , alerts]) => alerts.length > 0).map(([state, title, alerts, tone]) => <section key={state} className="pharmacy-alert-group" aria-labelledby={`pharmacy-alert-${state}`}>
          <h3 id={`pharmacy-alert-${state}`}>{title} <span className={`badge badge-${tone}`}>{state === 'EXPIRED' ? alerts.reduce((total, alert) => total + alert.count, 0) : alerts.length}</span></h3>
          <div>{alerts.map((alert) => <article key={`${state}-${alert.medicine.id}`} className="pharmacy-alert-item"><strong>{lang === 'ar' ? alert.medicine.labelAr : alert.medicine.labelEn}</strong><span>{state === 'LOW_STOCK' ? (lang === 'ar' ? `${alert.stock.usableStock} متوفر` : `${alert.stock.usableStock} available`) : state === 'EXPIRED' ? (lang === 'ar' ? `${alert.count} دفعة منتهية` : `${alert.count} expired batch(es)`) : localizedStockState(state, lang)}</span></article>)}</div>
        </section>)}
      </div>}
    </>
  );
}
