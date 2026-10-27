import './clinicSetup.css';
import ClinicSetupPanel from './ClinicSetupPanel';
import { useEffect, useRef, useState } from 'react';
import { Activity, Building, CalendarDays, DollarSign, Sliders, Users } from 'lucide-react';
import { apiErrorMessage, fetchWithAuth } from '../../services/staffApi';
import RoleHero from '../../components/healthcare/RoleHero';
import AuditLogPanel from './AuditLogPanel';
import AnalyticsPanel from './AnalyticsPanel';
import ClinicProfilePanel from './ClinicProfilePanel';
import SpecialtiesPanel from './SpecialtiesPanel.jsx';
import StaffAccountsPanel from './StaffAccountsPanel.jsx';
import AdminSchedulePanel from './AdminSchedulePanel';

export default function AdminDashboard({ user, lang, t }) {
  const [activeTab, setActiveTab] = useState('profile');
  const [analyticsData, setAnalyticsData] = useState(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [analyticsError, setAnalyticsError] = useState('');
  const [pricing, setPricing] = useState(null);
  const [pricingDrafts, setPricingDrafts] = useState({});
  const [pricingLoading, setPricingLoading] = useState(false);
  const [pricingSaving, setPricingSaving] = useState({});
  const pricingSavesInFlight = useRef(new Set());

  const [specialties, setSpecialties] = useState([]);
  const [specialtyDraft, setSpecialtyDraft] = useState({ code: '', nameAr: '', nameEn: '' });
  const [specialtyError, setSpecialtyError] = useState('');
  const [specialtyFeedback, setSpecialtyFeedback] = useState(null);
  const [specialtyCreatePending, setSpecialtyCreatePending] = useState(false);
  const specialtyCreateInFlight = useRef(false);
  const specialtyDeleted = (id) => {
    setSpecialties((current) => current.filter((item) => item.id !== id));
  };
  const showSpecialtyFeedback = (feedback) => { setSpecialtyError(''); setSpecialtyFeedback(feedback); };
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  useEffect(() => {
    fetchWithAuth('/api/specialties').then((response) => response.ok ? response.json() : []).then(setSpecialties).catch(() => setSpecialties([]));
  }, []);
  const createSpecialty = async (event) => {
    event.preventDefault();
    if (specialtyCreateInFlight.current) return;
    if (![specialtyDraft.code, specialtyDraft.nameAr, specialtyDraft.nameEn].every(value => String(value || '').trim())) {
      setSpecialtyError(lang === 'ar' ? 'أدخل الرمز والاسمين قبل إضافة التخصص.' : 'Enter a code and both names before adding a specialty.');
      return;
    }
    specialtyCreateInFlight.current = true;
    setSpecialtyCreatePending(true);
    setSpecialtyError(''); setSpecialtyFeedback(null);
    try {
      const response = await fetchWithAuth('/api/specialties', { method: 'POST', body: JSON.stringify({ code: specialtyDraft.code.trim(), nameAr: specialtyDraft.nameAr.trim(), nameEn: specialtyDraft.nameEn.trim(), active: true }) });
      if (!response.ok) { setSpecialtyError(apiErrorMessage(await response.json().catch(() => ({})), lang === 'ar' ? 'تعذر إنشاء التخصص.' : 'Unable to create specialty.')); return; }
      const created = await response.json();
      setSpecialties(current => [...current, created].sort((a, b) => a.nameEn.localeCompare(b.nameEn)));
      setSpecialtyDraft({ code: '', nameAr: '', nameEn: '' });
      setSpecialtyFeedback({ type: 'success', message: lang === 'ar' ? 'تمت إضافة التخصص.' : 'Specialty added.' });
    } catch {
      setSpecialtyError(lang === 'ar' ? 'تعذر الاتصال بالخادم. يرجى المحاولة مرة أخرى.' : 'Unable to connect to the server. Please try again.');
    } finally {
      specialtyCreateInFlight.current = false;
      setSpecialtyCreatePending(false);
    }
  };
  const saveSpecialty = async (specialty) => {
    setSpecialtyError(''); setSpecialtyFeedback(null);
    try {
      const response = await fetchWithAuth(`/api/specialties/${specialty.id}`, { method: 'PATCH', body: JSON.stringify({ code: specialty.code, nameAr: specialty.nameAr, nameEn: specialty.nameEn, active: specialty.active }) });
      if (!response.ok) { setSpecialtyError(apiErrorMessage(await response.json().catch(() => ({})), lang === 'ar' ? 'تعذر حفظ التخصص.' : 'Unable to save specialty.')); return false; }
      const saved = await response.json();
      setSpecialties(current => current.map(item => item.id === saved.id ? saved : item).sort((a, b) => a.nameEn.localeCompare(b.nameEn)));
      setSpecialtyFeedback({ type: 'success', message: lang === 'ar' ? 'تم حفظ التخصص.' : 'Specialty saved.' });
      return true;
    } catch {
      setSpecialtyError(lang === 'ar' ? 'تعذر الاتصال بالخادم. يرجى المحاولة مرة أخرى.' : 'Unable to connect to the server. Please try again.');
      return false;
    }
  };

  // Fetch users & logs on tab switch
  useEffect(() => {
    if (activeTab === 'analytics') {
      setLoadingAnalytics(true);
      setAnalyticsError('');
      fetchWithAuth('/api/admin/analytics')
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch analytics`);
          return res.json();
        })
        .then((data) => {
          setAnalyticsData(data);
          setLoadingAnalytics(false);
        })
        .catch((err) => {
          console.error('Analytics fetch error:', err);
          setAnalyticsError(
            lang === 'ar'
              ? 'تعذر تحميل بيانات التحليلات والإحصائيات.'
              : err.message || 'Failed to load analytics data.'
          );
          setAnalyticsData(null);
          setLoadingAnalytics(false);
        });
    }
    if (activeTab === 'pricing') {
      setPricingLoading(true);
      fetchWithAuth('/api/admin/pricing')
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(apiErrorMessage(data, 'Failed to load pricing.'));
          return data;
        })
        .then((data) => setPricing(data))
        .catch((err) => setErrorMsg(err.message))
        .finally(() => setPricingLoading(false));
    }
  }, [activeTab, lang]);

  const saveOfficialPrice = async (kind, item) => {
    const key = `${kind}:${item.id}`;
    if (pricingSavesInFlight.current.has(key)) return;
    setSuccessMsg('');
    const currentPrice = kind === 'doctors' ? item.consultationFee : kind === 'services' ? item.baseFeeSdg : item.unitPriceSdg;
    const draft = pricingDrafts[key] || { priceSdg: currentPrice == null ? '' : String(Number(currentPrice)), status: item.status };
    const priceSdg = Number(draft.priceSdg);
    if (!Number.isSafeInteger(priceSdg) || priceSdg <= 0 || priceSdg > 1000000000) {
      setErrorMsg(lang === 'ar' ? 'أدخل سعراً صحيحاً موجباً.' : 'Enter a valid positive whole-number price.');
      return;
    }
    const statusChanged = draft.status && draft.status !== item.status;
    const confirmationMessage = statusChanged
      ? (draft.status === 'ACTIVE'
        ? (lang === 'ar'
          ? 'هل أنت متأكد من تفعيل هذه الخدمة؟ ستصبح متاحة للأطباء.'
          : 'Are you sure you want to activate this service? It will become available to doctors.')
        : (lang === 'ar'
          ? 'هل أنت متأكد من تعطيل هذه الخدمة؟ لن تظهر للأطباء كخدمة متاحة جديدة.'
          : 'Are you sure you want to deactivate this service? It will no longer appear to doctors as an available service.'))
      : (lang === 'ar' ? 'تأكيد تغيير السعر الرسمي؟' : 'Confirm this official price change?');
    if (!globalThis.confirm(confirmationMessage)) return;
    pricingSavesInFlight.current.add(key);
    setPricingSaving(current => ({ ...current, [key]: true }));
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await fetchWithAuth(`/api/admin/pricing/${kind}/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ priceSdg, status: draft.status || item.status })
      });
      const updated = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(updated, 'Failed to update pricing.'));
      setPricing((current) => ({
        ...current,
        [kind]: current[kind].map((entry) => entry.id === item.id ? updated : entry)
      }));
      setPricingDrafts((current) => ({ ...current, [key]: undefined }));
      setSuccessMsg(lang === 'ar' ? 'تم تحديث السعر الرسمي.' : 'Official price updated.');
    } catch (error) {
      setErrorMsg(error.message);
    } finally {
      pricingSavesInFlight.current.delete(key);
      setPricingSaving(current => ({ ...current, [key]: false }));
    }
  };

  return (
    <div className={`dashboard-wrapper admin-workspace ${activeTab === 'scheduling' ? 'admin-schedule-workspace' : activeTab === 'users' ? 'admin-staff-workspace' : ''}`}>
      {/* Side menu */}
      <aside className="sidebar-menu no-print-section">
        <div className="menu-items">
          <button
            className={`menu-btn ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => setActiveTab('profile')}
          >
            <Building size={18} />
            {lang === 'ar' ? 'الملف التعريفي للمنشأة' : 'Facility Profile'}
          </button>
          <button
            className={`menu-btn ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            <Users size={18} />
            {lang === 'ar' ? 'حسابات الموظفين' : 'Staff Accounts'}
          </button>
          <button
            className={`menu-btn ${activeTab === 'pricing' ? 'active' : ''}`}
            onClick={() => setActiveTab('pricing')}
          >
            <DollarSign size={18} />
            {lang === 'ar' ? 'إدارة الأسعار' : 'Pricing Management'}
          </button>
          <button className={`menu-btn ${activeTab === 'specialties' ? 'active' : ''}`} onClick={() => setActiveTab('specialties')}><Sliders size={18}/>{lang === 'ar' ? 'التخصصات' : 'Specialties'}</button>
          <button className={`menu-btn ${activeTab === 'clinic-setup' ? 'active' : ''}`} onClick={() => setActiveTab('clinic-setup')}><Sliders size={18}/>{lang === 'ar' ? 'الأطباء والكتالوجات' : 'Doctors & catalogs'}</button>
          <button className={`menu-btn ${activeTab === 'laboratory-catalog' ? 'active' : ''}`} onClick={() => setActiveTab('laboratory-catalog')}><Sliders size={18}/>{lang === 'ar' ? 'الخدمات السريرية · فحوص المختبر' : 'Clinical services · Laboratory tests'}</button>
          <button className={`menu-btn ${activeTab === 'scheduling' ? 'active' : ''}`} onClick={() => setActiveTab('scheduling')}><CalendarDays size={18}/>{lang === 'ar' ? 'جداول الأطباء' : 'Doctor schedules'}</button>
          <button
            className={`menu-btn ${activeTab === 'analytics' ? 'active' : ''}`}
            onClick={() => setActiveTab('analytics')}
          >
            <Activity size={18} />
            {lang === 'ar' ? 'التقارير والتحليلات' : 'Reports & Analytics'}
          </button>
          <button
            className={`menu-btn ${activeTab === 'logs' ? 'active' : ''}`}
            onClick={() => setActiveTab('logs')}
          >
            <Sliders size={18} />
            {lang === 'ar' ? 'سجلات تدقيق الأمان' : 'Security Audit Logs'}
          </button>
        </div>
      </aside>

      {/* Main Panel Content */}
      <div className="workspace-panel">
        {!['clinic-setup', 'laboratory-catalog', 'scheduling', 'users'].includes(activeTab) && <RoleHero role="admin" lang={lang}/>}
        {['clinic-setup', 'laboratory-catalog'].includes(activeTab) && <ClinicSetupPanel key={activeTab} initialTab={activeTab === 'laboratory-catalog' ? 'labs' : 'doctors'} lang={lang} t={t}/>}
        {activeTab === 'profile' && (
          <ClinicProfilePanel lang={lang} t={t} onNavigate={setActiveTab}/>
        )}

        {activeTab === 'users' && <StaffAccountsPanel user={user} lang={lang} specialties={specialties}/>}
        {activeTab === 'pricing' && (
          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <h3>{lang === 'ar' ? 'إدارة الأسعار الرسمية للمنشأة' : 'Facility Pricing Management'}</h3>
            <p style={{ opacity: 0.75 }}>
              {lang === 'ar'
                ? 'تُستخدم الأسعار المحفوظة هنا للفواتير الجديدة فقط، ولا تتغير الفواتير التاريخية.'
                : 'Prices saved here apply to future invoices only. Historical invoices remain unchanged.'}
            </p>
            {errorMsg && <div role="alert" className="badge badge-danger" style={{ padding: '0.6rem', marginBottom: '1rem' }}>{errorMsg}</div>}
            {successMsg && <div role="status" className="badge badge-success" style={{ padding: '0.6rem', marginBottom: '1rem' }}>{successMsg}</div>}
            {pricingLoading || !pricing ? <div className="spinner" /> : (
              <>
                <PricingTable title={lang === 'ar' ? 'رسوم الاستشارات' : 'Consultation Fees'} kind="doctors" items={pricing.doctors} lang={lang} drafts={pricingDrafts} setDrafts={setPricingDrafts} saving={pricingSaving} onSave={saveOfficialPrice} />
                <PricingTable title={lang === 'ar' ? 'الخدمات السريرية والمختبرية' : 'Clinical & Laboratory Services'} kind="services" items={pricing.services} lang={lang} drafts={pricingDrafts} setDrafts={setPricingDrafts} saving={pricingSaving} onSave={saveOfficialPrice} />
                <PricingTable title={lang === 'ar' ? 'أسعار الصيدلية' : 'Pharmacy Selling Prices'} kind="medicines" items={pricing.medicines} lang={lang} drafts={pricingDrafts} setDrafts={setPricingDrafts} saving={pricingSaving} onSave={saveOfficialPrice} />
              </>
            )}
          </div>
        )}

        {activeTab === 'specialties' && <SpecialtiesPanel lang={lang} specialties={specialties} draft={specialtyDraft} setDraft={setSpecialtyDraft} error={specialtyError} feedback={specialtyFeedback} pending={specialtyCreatePending} onCreate={createSpecialty} onSave={saveSpecialty} isAdmin={user?.role === 'ADMIN'} request={fetchWithAuth} onDeleted={specialtyDeleted} onFeedback={showSpecialtyFeedback}/>}
        {activeTab === 'scheduling' && user?.role === 'ADMIN' && <AdminSchedulePanel lang={lang} t={t} />}

        {activeTab === 'analytics' && (
          <AnalyticsPanel
            data={analyticsData}
            loading={loadingAnalytics}
            error={analyticsError}
            lang={lang}
            t={t}
            onRefresh={() => {
              setLoadingAnalytics(true);
              setAnalyticsError('');
              fetchWithAuth('/api/admin/analytics')
                .then((response) => {
                  if (!response.ok) throw new Error('ANALYTICS_LOAD_FAILED');
                  return response.json();
                })
                .then(setAnalyticsData)
                .catch(() => setAnalyticsError(t('analyticsLoadError')))
                .finally(() => setLoadingAnalytics(false));
            }}
          />
        )}

        {activeTab === 'logs' && (
          <AuditLogPanel lang={lang} t={t}/>
        )}
      </div>
    </div>
  );
}

function PricingTable({ title, kind, items, lang, drafts, setDrafts, saving = {}, onSave }) {
  const priceField = kind === 'doctors' ? 'consultationFee' : kind === 'services' ? 'baseFeeSdg' : 'unitPriceSdg';
  return <section style={{ marginTop: '1.5rem', overflowX: 'auto' }}>
    <h4>{title}</h4>
    <table className="staff-table">
      <thead><tr><th>{lang === 'ar' ? 'الاسم' : 'Name'}</th><th>{lang === 'ar' ? 'الفئة' : 'Category'}</th><th>{lang === 'ar' ? 'السعر الحالي' : 'Current Price'}</th><th>{lang === 'ar' ? 'الحالة' : 'Status'}</th><th>{lang === 'ar' ? 'آخر تحديث' : 'Last Updated'}</th><th>{lang === 'ar' ? 'إجراء' : 'Action'}</th></tr></thead>
      <tbody>{items.map((item) => {
        const key = `${kind}:${item.id}`;
        const currentPrice = item[priceField];
        const draft = drafts[key] || { priceSdg: currentPrice == null ? '' : String(Number(currentPrice)), status: item.status };
        return <tr key={item.id}>
          <td>{lang === 'ar' ? (item.fullNameAr || item.labelAr) : (item.fullNameEn || item.labelEn)}</td>
          <td>{item.category || item.specialtyEn || item.dosageForm || '—'}</td>
          <td><input aria-label={`${kind} price`} className="form-input" type="number" min="1" step="1" disabled={saving[key]} placeholder={lang === 'ar' ? 'غير محدد' : 'Not configured'} value={draft.priceSdg} onChange={(event) => {
            const priceSdg = event.target.value;
            setDrafts(current => ({ ...current, [key]: { ...draft, ...current[key], priceSdg } }));
          }} /></td>
          <td><select aria-label={`${kind} status`} className="form-input" value={draft.status} disabled={saving[key]} onChange={(event) => {
            const status = event.target.value;
            setDrafts(current => ({ ...current, [key]: { ...draft, ...current[key], status } }));
          }}><option value="ACTIVE">{lang === 'ar' ? 'نشط' : 'Active'}</option><option value="INACTIVE">{lang === 'ar' ? 'غير نشط' : 'Inactive'}</option></select></td>
          <td>{item.updatedAt ? new Date(item.updatedAt).toLocaleString(lang === 'ar' ? 'ar' : 'en') : '—'}</td>
          <td><button type="button" className="btn btn-primary" disabled={saving[key]} aria-busy={Boolean(saving[key])} onClick={() => onSave(kind, item)}>{saving[key] ? (lang === 'ar' ? 'جارٍ الحفظ…' : 'Saving…') : (lang === 'ar' ? 'حفظ' : 'Save')}</button></td>
        </tr>;
      })}</tbody>
    </table>
  </section>;
}

/* ==========================================
   2. RECEPTIONIST DASHBOARD
   ========================================== */
