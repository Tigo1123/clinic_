import { useState } from 'react';
import { Check, FlaskConical, Search, X } from 'lucide-react';

const categories = [
  ['LABORATORY', 'الفحوصات المخبرية', 'Laboratory tests'],
  ['RADIOLOGY', 'الأشعة', 'Radiology'],
  ['CLINICAL_PROCEDURE', 'الإجراءات الطبية', 'Clinical procedures']
];

export function SelectedClinicalOrders({ lang, services, orderedTests, serviceOrders, onRemove }) {
  const ids = [...orderedTests, ...serviceOrders];
  return ids.length > 0 && (
    <ul className="doctor-review-list">
      {ids.map((id) => {
        const service = services.find((item) => item.id === id);
        const label = (lang === 'ar' ? service?.labelAr : service?.labelEn) || (lang === 'ar' ? 'خدمة مختارة' : 'Selected service');
        return (
          <li key={id}>
            {label}{' '}
            {onRemove && <button type="button" className="btn btn-secondary" onClick={() => onRemove(id)} aria-label={lang === 'ar' ? `حذف ${label}` : `Remove ${label}`}><X size={14} aria-hidden="true" /></button>}
          </li>
        );
      })}
    </ul>
  );
}

export default function ClinicalOrderPicker({ lang, services, orderedTests, serviceOrders, onToggle, lockedOrders, isLocked, loadError, onRetry }) {
  const [search, setSearch] = useState('');
  const count = orderedTests.length + serviceOrders.length;
  const searchTerm = search.trim().toLocaleLowerCase();
  const matchingServices = services.filter((service) => (
    categories.some(([category]) => service.category === category) &&
    [service.labelAr, service.labelEn].some((label) => label?.toLocaleLowerCase().includes(searchTerm))
  ));

  return (
    <section className="doctor-lab-order-card" aria-labelledby="doctor-lab-order-title">
      <div className="doctor-lab-order-header">
        <div>
          <h4 id="doctor-lab-order-title"><FlaskConical size={17} aria-hidden="true" />{lang === 'ar' ? 'الفحوصات والإجراءات' : 'Tests and procedures'}</h4>
          {!isLocked && <p className="doctor-lab-order-desc">{lang === 'ar' ? 'اختر الفحوصات والإجراءات من قائمة العيادة.' : 'Choose tests and procedures from the clinic catalogue.'}</p>}
        </div>
        {!isLocked && <span className="doctor-lab-selected-count" aria-live="polite">{lang === 'ar' ? `المختارة: ${count}` : `Selected: ${count}`}</span>}
      </div>
      {isLocked ? (
        <>
          <p className="doctor-lab-order-desc">{lang === 'ar' ? 'تم إرسال هذه الطلبات مع الكشف ولا يمكن تغييرها هنا.' : 'These orders were submitted with the visit and are locked.'}</p>
          <ul className="doctor-review-list">
            {lockedOrders.map((item, index) => <li key={index}>{lang === 'ar' ? item.serviceNameAr : item.serviceNameEn}</li>)}
          </ul>
        </>
      ) : (
        <>
          {loadError ? (
            <div role="alert" className="patient-alert error">
              {lang === 'ar' ? 'تعذر تحميل قائمة العيادة.' : 'Could not load the clinic catalogue.'}{' '}
              <button type="button" onClick={onRetry}>{lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}</button>
            </div>
          ) : (
            <>
              <label className="doctor-lab-search">
                <Search size={16} aria-hidden="true" />
                <span className="sr-only">{lang === 'ar' ? 'البحث في قائمة العيادة' : 'Search the clinic catalogue'}</span>
                <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={lang === 'ar' ? 'ابحث عن فحص أو إجراء...' : 'Search tests or procedures...'} />
              </label>
              {categories.map(([category, labelAr, labelEn]) => {
                const matches = matchingServices.filter((service) => service.category === category);
                if (!matches.length) return null;
                return (
                  <div className="doctor-lab-subsection" key={category}>
                    <h5>{lang === 'ar' ? labelAr : labelEn}</h5>
                    <div className="doctor-lab-service-grid">
                      {matches.map((service) => {
                        const selected = (category === 'LABORATORY' ? orderedTests : serviceOrders).includes(service.id);
                        return (
                          <label className={`doctor-lab-service-option ${selected ? 'is-selected' : ''}`} key={service.id}>
                            <input type="checkbox" checked={selected} onChange={() => onToggle(service.id, category)} />
                            <span className="doctor-lab-service-copy">
                              <strong>{lang === 'ar' ? service.labelAr : service.labelEn}</strong>
                              <small>{lang === 'ar' ? service.labelEn : service.labelAr}</small>
                            </span>
                            <span className="doctor-lab-checkmark" aria-hidden="true">{selected && <Check size={14} />}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {!matchingServices.length && <p>{lang === 'ar' ? 'لا توجد خدمات مطابقة.' : 'No matching services.'}</p>}
            </>
          )}
        </>
      )}
    </section>
  );
}
