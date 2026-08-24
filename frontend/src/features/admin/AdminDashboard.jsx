import { useEffect, useState } from 'react';
import { Activity, AlertCircle, Building, Calendar, CheckCircle, DollarSign, Sliders, Stethoscope, Users } from 'lucide-react';
import { apiErrorMessage, fetchWithAuth } from '../../services/staffApi';
import RoleHero from '../../components/healthcare/RoleHero';
import { getStaffPasswordChecks, isStaffPasswordValid, STAFF_PASSWORD_MAX_LENGTH } from '../../utils/staffPasswordPolicy';
import { buildStaffCreationPayload } from '../../utils/staffCreationPayload';

export default function AdminDashboard({ lang, t }) {
  const [activeTab, setActiveTab] = useState('profile');
  const [logs, setLogs] = useState([]);
  const [users, setUsers] = useState([]);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [analyticsError, setAnalyticsError] = useState('');
  const [pricing, setPricing] = useState(null);
  const [pricingDrafts, setPricingDrafts] = useState({});
  const [pricingLoading, setPricingLoading] = useState(false);

  const [config, setConfig] = useState({
    clinicNameAr: 'نظام الشفاء الطبي',
    clinicNameEn: 'Al-Shifa Medical CMS',
    vatPercent: 15,
    stampDutySdg: 500,
    exchangeRate: 1500
  });

  // User form states
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('RECEPTIONIST');
  const [newFullNameAr, setNewFullNameAr] = useState('');
  const [newFullNameEn, setNewFullNameEn] = useState('');
  const [newSpecialtyAr, setNewSpecialtyAr] = useState('طب عام');
  const [newSpecialtyEn, setNewSpecialtyEn] = useState('General Medicine');
  const [newConsultationFee, setNewConsultationFee] = useState('20000');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const newPasswordChecks = getStaffPasswordChecks(newPassword);

  const roleLabels = {
    ADMIN: { ar: 'مدير النظام', en: 'Administrator' },
    RECEPTIONIST: { ar: 'موظف الاستقبال', en: 'Receptionist' },
    DOCTOR: { ar: 'طبيب', en: 'Doctor' },
    PHARMACIST: { ar: 'صيدلي', en: 'Pharmacist' },
    LAB_TECH: { ar: 'فني مختبر', en: 'Laboratory Technician' },
    PATIENT: { ar: 'مريض', en: 'Patient' }
  };

  const userStatusLabels = {
    ACTIVE: { ar: 'نشط', en: 'Active' },
    INACTIVE: { ar: 'غير نشط', en: 'Inactive' }
  };

  const getRoleLabel = (role) => {
    const labels = roleLabels[role];
    return labels
      ? (lang === 'ar' ? labels.ar : labels.en)
      : role?.replaceAll('_', ' ') || '-';
  };

  const getUserStatusLabel = (status) => {
    const labels = userStatusLabels[status];
    return labels
      ? (lang === 'ar' ? labels.ar : labels.en)
      : status?.replaceAll('_', ' ') || '-';
  };

  const getAuditActionLabel = (action) => {
    if (!action) return '-';

    if (action.startsWith('EMR_BREAK_THE_GLASS_BYPASS')) {
      return lang === 'ar'
        ? 'فتح طارئ للملف الطبي'
        : 'Emergency Medical Record Access';
    }

    const known = {
      LAB_RESULTS_LOGGED: {
        ar: 'تسجيل نتيجة مختبر',
        en: 'Laboratory Result Recorded'
      },
      LAB_RESULTS_RELEASED_TO_PATIENT: {
        ar: 'إتاحة نتائج المختبر للمريض',
        en: 'Laboratory Results Released to Patient'
      }
    };

    if (known[action]) {
      return lang === 'ar' ? known[action].ar : known[action].en;
    }

    return action.replaceAll('_', ' ');
  };

  // Fetch users & logs on tab switch
  useEffect(() => {
    if (activeTab === 'logs') {
      fetchWithAuth('/api/auth/audit-logs')
        .then((res) => res.ok ? res.json() : [])
        .then((data) => setLogs(Array.isArray(data) ? data : []))
        .catch((err) => {
          console.error(err);
          setLogs([]);
        });
    }
    if (activeTab === 'users') {
      fetchWithAuth('/api/auth/users')
        .then((res) => res.ok ? res.json() : [])
        .then((data) => setUsers(Array.isArray(data) ? data : []))
        .catch((err) => {
          console.error(err);
          setUsers([]);
        });
    }
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
    const currentPrice = kind === 'doctors' ? item.consultationFee : kind === 'services' ? item.baseFeeSdg : item.unitPriceSdg;
    const draft = pricingDrafts[key] || { priceSdg: currentPrice == null ? '' : String(Number(currentPrice)), status: item.status };
    const priceSdg = Number(draft.priceSdg);
    if (!Number.isSafeInteger(priceSdg) || priceSdg <= 0 || priceSdg > 1000000000) {
      setErrorMsg(lang === 'ar' ? 'أدخل سعراً صحيحاً موجباً.' : 'Enter a valid positive whole-number price.');
      return;
    }
    if (!globalThis.confirm(lang === 'ar' ? 'تأكيد تغيير السعر الرسمي؟' : 'Confirm this official price change?')) return;
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
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    if (!isStaffPasswordValid(newPassword)) {
      setErrorMsg(lang === 'ar'
        ? 'يجب أن تتكون كلمة المرور من 10 إلى 200 حرف، وتحتوي على حرف إنجليزي كبير وحرف صغير ورقم.'
        : 'Password must be 10–200 characters and include an uppercase letter, a lowercase letter, and a number.');
      return;
    }
    try {
      const res = await fetchWithAuth('/api/auth/users', {
        method: 'POST',
        body: JSON.stringify(buildStaffCreationPayload({
          username: newUsername,
          password: newPassword,
          role: newRole,
          fullNameAr: newFullNameAr,
          fullNameEn: newFullNameEn,
          specialtyAr: newSpecialtyAr,
          specialtyEn: newSpecialtyEn,
          consultationFee: newConsultationFee
        }))
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(lang === 'ar' ? 'تم إنشاء حساب الموظف بنجاح' : 'Staff account created successfully.');
        setNewUsername('');
        setNewPassword('');
        setNewFullNameAr('');
        setNewFullNameEn('');
        setNewSpecialtyAr('طب عام');
        setNewSpecialtyEn('General Medicine');
        setNewConsultationFee('20000');
        // Reload list
        fetchWithAuth('/api/auth/users')
          .then((r) => r.json())
          .then((d) => setUsers(d));
      } else {
        const validationDetails = Array.isArray(data?.error?.details)
          ? data.error.details.map((detail) => {
              if (!detail?.message) return '';
              return detail.field ? `${detail.field}: ${detail.message}` : detail.message;
            }).filter(Boolean).join(' ')
          : '';
        setErrorMsg(
          validationDetails || apiErrorMessage(
              data,
              lang === 'ar'
                ? 'تعذر إنشاء حساب الموظف.'
                : 'Failed to create the staff account.'
            )
        );
      }
    } catch (err) {
      console.error(err);
      setErrorMsg(
        lang === 'ar'
          ? 'تعذر الاتصال بالخادم. يرجى المحاولة مرة أخرى.'
          : 'Unable to connect to the server. Please try again.'
      );
    }
  };

  const handleToggleUserStatus = async (userId, currentStatus) => {
    const nextStatus = currentStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      const res = await fetchWithAuth(`/api/auth/users/${userId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: nextStatus })
      });
      if (res.ok) {
        setUsers(
          users.map((u) => (u.id === userId ? { ...u, status: nextStatus } : u))
        );
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="dashboard-wrapper">
      {/* Side menu */}
      <aside className="sidebar-menu no-print-section">
        <div className="menu-items">
          <button
            className={`menu-btn ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => setActiveTab('profile')}
          >
            <Building size={18} />
            {lang === 'ar' ? 'الملف التعريفي للعيادة' : 'Clinic Profile'}
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
        <RoleHero role="admin" lang={lang}/>
        {activeTab === 'profile' && (
          <div className="glass-panel" style={{ padding: '2rem' }}>
            <h3 style={{ marginBottom: '1.5rem' }}>{lang === 'ar' ? 'إعدادات العيادة العامة' : 'Clinic Global Settings'}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              <div className="form-group">
                <label className="form-label">{lang === 'ar' ? 'اسم العيادة (عربي)' : 'Clinic Name (Arabic)'}</label>
                <input
                  type="text"
                  className="form-input"
                  value={config.clinicNameAr}
                  readOnly
                  onChange={(e) => setConfig({ ...config, clinicNameAr: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">{lang === 'ar' ? 'اسم العيادة (إنجليزي)' : 'Clinic Name (English)'}</label>
                <input
                  type="text"
                  className="form-input"
                  value={config.clinicNameEn}
                  readOnly
                  onChange={(e) => setConfig({ ...config, clinicNameEn: e.target.value })}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.5rem', marginTop: '1.5rem' }}>
              <div className="form-group">
                <label className="form-label">{lang === 'ar' ? 'نسبة ضريبة القيمة المضافة (%)' : 'VAT Percentage (%)'}</label>
                <input
                  type="number"
                  className="form-input"
                  value={config.vatPercent}
                  readOnly
                  onChange={(e) => setConfig({ ...config, vatPercent: parseFloat(e.target.value) })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">{lang === 'ar' ? 'قيمة دمغة الشهادة (SDG)' : 'Stamp Duty (SDG)'}</label>
                <input
                  type="number"
                  className="form-input"
                  value={config.stampDutySdg}
                  readOnly
                  onChange={(e) => setConfig({ ...config, stampDutySdg: parseFloat(e.target.value) })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">{lang === 'ar' ? 'سعر صرف الدولار (1 USD = X SDG)' : 'Exchange Rate (1 USD = X SDG)'}</label>
                <input
                  type="number"
                  className="form-input"
                  value={config.exchangeRate}
                  readOnly
                  onChange={(e) => setConfig({ ...config, exchangeRate: parseFloat(e.target.value) })}
                />
              </div>
            </div>

            <div className="badge badge-info" style={{ marginTop: '2rem', padding: '.75rem' }}>
              {lang === 'ar' ? 'الإعدادات للعرض فقط حتى يتم تفعيل الحفظ الآمن.' : 'Settings are read-only until secure persistence is configured.'}
            </div>
          </div>
        )}

        {activeTab === 'users' && (
          <div style={{ display: 'grid', gridTemplateColumns: '350px 1fr', gap: '2rem' }}>
            <div className="glass-panel" style={{ padding: '1.5rem' }}>
              <h4 style={{ marginBottom: '1.5rem' }}>{lang === 'ar' ? 'إضافة موظف جديد' : 'Add New Staff'}</h4>
              {errorMsg && <div className="badge badge-danger" style={{ width: '100%', marginBottom: '1rem', padding: '0.5rem' }}>{errorMsg}</div>}
              {successMsg && <div className="badge badge-success" style={{ width: '100%', marginBottom: '1rem', padding: '0.5rem' }}>{successMsg}</div>}

              <form onSubmit={handleCreateUser} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">{t('username')}</label>
                  <input
                    type="email"
                    required
                    placeholder="staff@cms.com"
                    className="form-input"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">{t('password')}</label>
                  <input
                    type="password"
                    required
                    minLength={10}
                    maxLength={STAFF_PASSWORD_MAX_LENGTH}
                    placeholder="••••••••"
                    className="form-input"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                  <div className="password-requirements" aria-live="polite">
                    {Object.entries({
                      minimumLength: lang === 'ar' ? '10 أحرف على الأقل' : 'At least 10 characters',
                      maximumLength: lang === 'ar' ? '200 حرف على الأكثر' : 'At most 200 characters',
                      uppercase: lang === 'ar' ? 'حرف إنجليزي كبير' : 'One uppercase letter',
                      lowercase: lang === 'ar' ? 'حرف إنجليزي صغير' : 'One lowercase letter',
                      number: lang === 'ar' ? 'رقم واحد على الأقل' : 'One number'
                    }).map(([key, label]) => (
                      <span key={key} className={newPasswordChecks[key] ? 'valid' : ''}>{label}</span>
                    ))}
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">{lang === 'ar' ? 'الدور الوظيفي' : 'Role'}</label>
                  <select className="form-input" value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                    <option value="ADMIN">{getRoleLabel('ADMIN')}</option>
                    <option value="RECEPTIONIST">{getRoleLabel('RECEPTIONIST')}</option>
                    <option value="DOCTOR">{getRoleLabel('DOCTOR')}</option>
                    <option value="PHARMACIST">{getRoleLabel('PHARMACIST')}</option>
                    <option value="LAB_TECH">{getRoleLabel('LAB_TECH')}</option>
                  </select>
                </div>
                {newRole === 'DOCTOR' && (
                  <>
                    <div className="form-group">
                      <label className="form-label">{lang === 'ar' ? 'الاسم الكامل (عربي)' : 'Full Name (Arabic)'}</label>
                      <input
                        type="text"
                        required
                        placeholder={lang === 'ar' ? 'د. محمد أحمد' : 'Dr. Mohamed Ahmed'}
                        className="form-input"
                        value={newFullNameAr}
                        onChange={(e) => setNewFullNameAr(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{lang === 'ar' ? 'الاسم الكامل (إنجليزي)' : 'Full Name (English)'}</label>
                      <input
                        type="text"
                        required
                        placeholder="Dr. Mohamed Ahmed"
                        className="form-input"
                        value={newFullNameEn}
                        onChange={(e) => setNewFullNameEn(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{lang === 'ar' ? 'التخصص (عربي)' : 'Specialty (Arabic)'}</label>
                      <input
                        type="text"
                        required
                        className="form-input"
                        value={newSpecialtyAr}
                        onChange={(e) => setNewSpecialtyAr(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{lang === 'ar' ? 'التخصص (إنجليزي)' : 'Specialty (English)'}</label>
                      <input
                        type="text"
                        required
                        className="form-input"
                        value={newSpecialtyEn}
                        onChange={(e) => setNewSpecialtyEn(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{lang === 'ar' ? 'رسوم الكشف (جنيه سوداني)' : 'Consultation Fee (SDG)'}</label>
                      <input
                        type="number"
                        required
                        className="form-input"
                        value={newConsultationFee}
                        onChange={(e) => setNewConsultationFee(e.target.value)}
                      />
                    </div>
                  </>
                )}
                <button type="submit" className="btn btn-primary" style={{ marginTop: '1rem' }}>
                  {lang === 'ar' ? 'إنشاء الحساب' : 'Create Account'}
                </button>
              </form>
            </div>

            <div className="glass-panel" style={{ padding: '1.5rem' }}>
              <h4 style={{ marginBottom: '1.5rem' }}>{lang === 'ar' ? 'سجل موظفي النظام' : 'Staff Directory'}</h4>
              <div className="table-responsive">
                <table className="staff-table">
                <thead>
                  <tr>
                    <th>{t('username')}</th>
                    <th>{lang === 'ar' ? 'الدور' : 'Role'}</th>
                    <th>{lang === 'ar' ? 'الحالة' : 'Status'}</th>
                    <th>{lang === 'ar' ? 'إجراءات' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.username}</td>
                      <td>
                        <span className="badge badge-success" style={{ fontSize: '0.8rem' }}>
                          {getRoleLabel(u.role)}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${u.status === 'ACTIVE' ? 'badge-success' : 'badge-danger'}`}>
                          {getUserStatusLabel(u.status)}
                        </span>
                      </td>
                      <td>
                        <button
                          className={`btn ${u.status === 'ACTIVE' ? 'btn-danger' : 'btn-primary'}`}
                          style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                          onClick={() => handleToggleUserStatus(u.id, u.status)}
                        >
                          {u.status === 'ACTIVE' ? (lang === 'ar' ? 'تعطيل' : 'Deactivate') : (lang === 'ar' ? 'تفعيل' : 'Activate')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'pricing' && (
          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <h3>{lang === 'ar' ? 'إدارة الأسعار الرسمية للعيادة' : 'Clinic Pricing Management'}</h3>
            <p style={{ opacity: 0.75 }}>
              {lang === 'ar'
                ? 'تُستخدم الأسعار المحفوظة هنا للفواتير الجديدة فقط، ولا تتغير الفواتير التاريخية.'
                : 'Prices saved here apply to future invoices only. Historical invoices remain unchanged.'}
            </p>
            {errorMsg && <div className="badge badge-danger" style={{ padding: '0.6rem', marginBottom: '1rem' }}>{errorMsg}</div>}
            {successMsg && <div className="badge badge-success" style={{ padding: '0.6rem', marginBottom: '1rem' }}>{successMsg}</div>}
            {pricingLoading || !pricing ? <div className="spinner" /> : (
              <>
                <PricingTable title={lang === 'ar' ? 'رسوم الاستشارات' : 'Consultation Fees'} kind="doctors" items={pricing.doctors} lang={lang} drafts={pricingDrafts} setDrafts={setPricingDrafts} onSave={saveOfficialPrice} />
                <PricingTable title={lang === 'ar' ? 'الخدمات السريرية والمختبرية' : 'Clinical & Laboratory Services'} kind="services" items={pricing.services} lang={lang} drafts={pricingDrafts} setDrafts={setPricingDrafts} onSave={saveOfficialPrice} />
                <PricingTable title={lang === 'ar' ? 'أسعار الصيدلية' : 'Pharmacy Selling Prices'} kind="medicines" items={pricing.medicines} lang={lang} drafts={pricingDrafts} setDrafts={setPricingDrafts} onSave={saveOfficialPrice} />
              </>
            )}
          </div>
        )}

        {activeTab === 'analytics' && (
          <div className="glass-panel" style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div>
                <h3 style={{ margin: 0, color: 'var(--primary)' }}>
                  {lang === 'ar' ? 'لوحة تحليلات وإحصائيات العيادة' : 'Clinic Operational & Analytics Dashboard'}
                </h3>
                <p style={{ margin: 0, fontSize: '0.85rem', opacity: 0.75 }}>
                  {lang === 'ar' ? 'مؤشرات الأداء الرئيسية والتحليلات التشغيلية' : 'Real-time Key Performance Indicators & Clinical Overview'}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: '0.8rem', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                onClick={() => {
                  setLoadingAnalytics(true);
                  fetchWithAuth('/api/admin/analytics')
                    .then((r) => r.json())
                    .then((d) => {
                      setAnalyticsData(d);
                      setLoadingAnalytics(false);
                    })
                    .catch(() => setLoadingAnalytics(false));
                }}
              >
                <Activity size={14} />
                {lang === 'ar' ? 'تحديث البيانات' : 'Refresh Metrics'}
              </button>
            </div>

            {loadingAnalytics ? (
              <div style={{ textAlign: 'center', padding: '3rem' }}>
                <div className="spinner" style={{ margin: '0 auto 1rem' }}></div>
                <p>{lang === 'ar' ? 'جاري حساب ومعالجة إحصائيات النظام...' : 'Computing system operational metrics...'}</p>
              </div>
            ) : analyticsError ? (
              <div className="alert alert-error" style={{ textAlign: 'center', padding: '2rem' }}>
                <AlertCircle size={36} style={{ marginBottom: '0.5rem', color: '#ef4444' }} />
                <p>{analyticsError}</p>
              </div>
            ) : analyticsData ? (
              <div>
                {/* 1. KPI Summaries Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem', marginBottom: '2rem' }}>
                  {/* Card 1: Total Registered Patients */}
                  <div className="glass-card" style={{ padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.04)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.85rem', opacity: 0.75 }}>{lang === 'ar' ? 'إجمالي المرضى المسجلين' : 'Total Patients'}</span>
                      <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(2, 132, 199, 0.15)', color: '#0284c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Users size={20} />
                      </div>
                    </div>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: 'bold', margin: '0.5rem 0 0', color: '#0284c7' }}>
                      {analyticsData.totalPatients || 0}
                    </h2>
                  </div>

                  {/* Card 2: Monthly Visits */}
                  <div className="glass-card" style={{ padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.04)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.85rem', opacity: 0.75 }}>{lang === 'ar' ? 'زيارات هذا الشهر' : 'Monthly Visits'}</span>
                      <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(13, 148, 136, 0.15)', color: '#0d9488', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Calendar size={20} />
                      </div>
                    </div>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: 'bold', margin: '0.5rem 0 0', color: '#0d9488' }}>
                      {analyticsData.monthlyVisits || 0}
                    </h2>
                  </div>

                  {/* Card 3: Completion Rate */}
                  <div className="glass-card" style={{ padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.04)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.85rem', opacity: 0.75 }}>{lang === 'ar' ? 'نسبة الإنجاز الطبية' : 'Completion Rate'}</span>
                      <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <CheckCircle size={20} />
                      </div>
                    </div>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: 'bold', margin: '0.5rem 0 0', color: '#10b981' }}>
                      {analyticsData.completionRate || 0}%
                    </h2>
                  </div>

                  {/* Card 4: Financial Revenues */}
                  <div className="glass-card" style={{ padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.04)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.85rem', opacity: 0.75 }}>{lang === 'ar' ? 'إجمالي المحصل المالي' : 'Total Revenue'}</span>
                      <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <DollarSign size={20} />
                      </div>
                    </div>
                    <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: '0.5rem 0 0', color: '#f59e0b' }}>
                      {(analyticsData.financials?.totalRevenueSdg || 0).toLocaleString(
                        lang === 'ar' ? 'ar' : 'en'
                      )}{' '}
                      <span style={{ fontSize: '0.8rem' }}>
                        {lang === 'ar' ? 'ج.س' : 'SDG'}
                      </span>
                    </h2>
                  </div>
                </div>

                <AppointmentTrendChart data={analyticsData.appointmentTrend || []} lang={lang}/>

                {/* 2. Visual Charts & Breakdowns Section */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
                  {/* Left Column: Doctor Clinical Volume Breakdown */}
                  <div className="glass-card" style={{ padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.03)' }}>
                    <h4 style={{ margin: '0 0 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Stethoscope size={18} color="var(--primary)" />
                      {lang === 'ar' ? 'عدد الزيارات لكل طبيب' : 'Visits Breakdown per Doctor'}
                    </h4>

                    {!analyticsData.doctorVisits || analyticsData.doctorVisits.length === 0 ? (
                      <p style={{ opacity: 0.6, fontSize: '0.9rem' }}>{lang === 'ar' ? 'لا يوجد سجلات زيارات للأطباء بعد.' : 'No doctor visit logs recorded yet.'}</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {analyticsData.doctorVisits.map((doc) => {
                          const maxVisits = Math.max(...analyticsData.doctorVisits.map((d) => d.visitsCount), 1);
                          const pct = Math.round((doc.visitsCount / maxVisits) * 100);
                          return (
                            <div key={doc.doctorId || doc.fullNameEn}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.3rem' }}>
                                <strong>
                                  {lang === 'ar' ? doc.fullNameAr : doc.fullNameEn}{' '}
                                  <span style={{ fontWeight: 'normal', opacity: 0.7 }}>({lang === 'ar' ? doc.specialtyAr : doc.specialtyEn})</span>
                                </strong>
                                <span className="badge badge-info">
                                  {doc.visitsCount} {lang === 'ar' ? 'زيارة' : 'visits'}
                                </span>
                              </div>
                              <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden' }}>
                                <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg, #0284c7, #0d9488)', borderRadius: '4px', transition: 'width 0.3s ease' }}></div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Right Column: Appointment Status Distribution */}
                  <div className="glass-card" style={{ padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.03)' }}>
                    <h4 style={{ margin: '0 0 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Activity size={18} color="var(--success)" />
                      {lang === 'ar' ? 'توزيع حالات الحجوزات والمواعيد' : 'Appointment Status Distribution'}
                    </h4>

                    {analyticsData.statusBreakdown && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', fontSize: '0.85rem' }}>
                        {/* Completed */}
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                            <span>{lang === 'ar' ? 'المواعيد المكتملة' : 'Completed'}</span>
                            <span style={{ fontWeight: 'bold', color: '#10b981' }}>{analyticsData.statusBreakdown.completed}</span>
                          </div>
                          <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px' }}>
                            <div
                              style={{
                                width: `${analyticsData.totalAppointments > 0 ? Math.round((analyticsData.statusBreakdown.completed / analyticsData.totalAppointments) * 100) : 0}%`,
                                height: '100%',
                                background: '#10b981',
                                borderRadius: '3px'
                              }}
                            ></div>
                          </div>
                        </div>

                        {/* In Consultation */}
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                            <span>{lang === 'ar' ? 'قيد الكشف الطبي' : 'In Consultation'}</span>
                            <span style={{ fontWeight: 'bold', color: '#0284c7' }}>{analyticsData.statusBreakdown.inConsultation}</span>
                          </div>
                          <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px' }}>
                            <div
                              style={{
                                width: `${analyticsData.totalAppointments > 0 ? Math.round((analyticsData.statusBreakdown.inConsultation / analyticsData.totalAppointments) * 100) : 0}%`,
                                height: '100%',
                                background: '#0284c7',
                                borderRadius: '3px'
                              }}
                            ></div>
                          </div>
                        </div>

                        {/* Waiting Room */}
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                            <span>{lang === 'ar' ? 'بانتظار الطبيب' : 'Waiting for Doctor'}</span>
                            <span style={{ fontWeight: 'bold', color: '#f59e0b' }}>{analyticsData.statusBreakdown.waiting}</span>
                          </div>
                          <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px' }}>
                            <div
                              style={{
                                width: `${analyticsData.totalAppointments > 0 ? Math.round((analyticsData.statusBreakdown.waiting / analyticsData.totalAppointments) * 100) : 0}%`,
                                height: '100%',
                                background: '#f59e0b',
                                borderRadius: '3px'
                              }}
                            ></div>
                          </div>
                        </div>

                        {/* Pending Approval */}
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                            <span>{lang === 'ar' ? 'طلبات المواعيد قيد المراجعة' : 'Pending Appointment Requests'}</span>
                            <span style={{ fontWeight: 'bold', color: '#8b5cf6' }}>{analyticsData.statusBreakdown.pending}</span>
                          </div>
                          <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px' }}>
                            <div
                              style={{
                                width: `${analyticsData.totalAppointments > 0 ? Math.round((analyticsData.statusBreakdown.pending / analyticsData.totalAppointments) * 100) : 0}%`,
                                height: '100%',
                                background: '#8b5cf6',
                                borderRadius: '3px'
                              }}
                            ></div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <h4 style={{ marginBottom: '1.5rem' }}>{lang === 'ar' ? 'سجل العمليات والتدقيق الأمني' : 'System Activity Audit Log'}</h4>
            <table className="staff-table" style={{ fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th>{lang === 'ar' ? 'التاريخ والوقت' : 'Timestamp'}</th>
                  <th>{lang === 'ar' ? 'المستخدم' : 'Actor'}</th>
                  <th>{lang === 'ar' ? 'الحدث' : 'Event Action'}</th>
                  <th>{lang === 'ar' ? 'التفاصيل' : 'Details'}</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const isBypass = log.action.startsWith('EMR_BREAK_THE_GLASS_BYPASS');
                  return (
                    <tr key={log.id} style={isBypass ? { background: 'rgba(239, 68, 68, 0.08)' } : {}}>
                      <td>
                        {new Date(log.timestamp).toLocaleString(
                          lang === 'ar' ? 'ar' : 'en'
                        )}
                      </td>
                      <td>{log.userId || (lang === 'ar' ? 'النظام' : 'System')}</td>
                      <td>
                        <span className={`badge ${isBypass ? 'badge-danger' : 'badge-success'}`}>
                          {getAuditActionLabel(log.action)}
                        </span>
                      </td>
                      <td style={{ color: isBypass ? 'var(--danger)' : 'inherit' }}>{log.details}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function PricingTable({ title, kind, items, lang, drafts, setDrafts, onSave }) {
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
          <td><input aria-label={`${kind} price`} className="form-input" type="number" min="1" step="1" placeholder={lang === 'ar' ? 'غير محدد' : 'Not configured'} value={draft.priceSdg} onChange={(event) => setDrafts((current) => ({ ...current, [key]: { ...draft, priceSdg: event.target.value } }))} /></td>
          <td><select aria-label={`${kind} status`} className="form-input" value={draft.status} onChange={(event) => setDrafts((current) => ({ ...current, [key]: { ...draft, status: event.target.value } }))}><option value="ACTIVE">{lang === 'ar' ? 'نشط' : 'Active'}</option><option value="INACTIVE">{lang === 'ar' ? 'غير نشط' : 'Inactive'}</option></select></td>
          <td>{item.updatedAt ? new Date(item.updatedAt).toLocaleString(lang === 'ar' ? 'ar' : 'en') : '—'}</td>
          <td><button type="button" className="btn btn-primary" onClick={() => onSave(kind, item)}>{lang === 'ar' ? 'حفظ' : 'Save'}</button></td>
        </tr>;
      })}</tbody>
    </table>
  </section>;
}

function AppointmentTrendChart({data,lang}){
  const width=720,height=190,padding=28,max=Math.max(...data.map(item=>item.count),1);
  const points=data.map((item,index)=>`${padding+(index*(width-padding*2))/Math.max(data.length-1,1)},${height-padding-(item.count/max)*(height-padding*2)}`).join(' ');
  return <section className="glass-card analytics-trend" aria-label={lang==='ar'?'اتجاه المواعيد خلال سبعة أيام':'Seven-day appointment trend'}><div className="section-heading-row"><h4><Calendar size={18}/>{lang==='ar'?'اتجاه المواعيد — 7 أيام':'Appointments trend — 7 days'}</h4></div>{data.length?<><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={lang==='ar'?'مخطط خطي لعدد المواعيد الحقيقي يومياً':'Line chart of real daily appointment counts'} preserveAspectRatio="none"><defs><linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1479ee" stopOpacity=".25"/><stop offset="1" stopColor="#1479ee" stopOpacity="0"/></linearGradient></defs><polyline points={`${padding},${height-padding} ${points} ${width-padding},${height-padding}`} fill="url(#trend-fill)" stroke="none"/><polyline points={points} fill="none" stroke="#1479ee" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/></svg><div className="analytics-trend__labels">{data.map(item=><span key={item.date}><b>{item.count}</b><small>{new Date(`${item.date}T00:00:00`).toLocaleDateString(lang==='ar'?'ar':undefined,{weekday:'short'})}</small></span>)}</div></>:<p>{lang==='ar'?'لا تتوفر بيانات مواعيد.':'No appointment trend data is available.'}</p>}</section>;
}

/* ==========================================
   2. RECEPTIONIST DASHBOARD
   ========================================== */
