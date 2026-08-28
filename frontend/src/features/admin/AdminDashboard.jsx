import { useEffect, useState } from 'react';
import { Activity, Building, DollarSign, Sliders, Users } from 'lucide-react';
import { apiErrorMessage, fetchWithAuth } from '../../services/staffApi';
import RoleHero from '../../components/healthcare/RoleHero';
import { getStaffPasswordChecks, isStaffPasswordValid, STAFF_PASSWORD_MAX_LENGTH } from '../../utils/staffPasswordPolicy';
import { buildStaffCreationPayload } from '../../utils/staffCreationPayload';
import { filterStaffUsers, isStaffRole } from '../../utils/staffRoles';
import AuditLogPanel from './AuditLogPanel';
import AnalyticsPanel from './AnalyticsPanel';

export default function AdminDashboard({ user, lang, t }) {
  const [activeTab, setActiveTab] = useState('profile');
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
  const [resetTarget, setResetTarget] = useState(null);
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [resetAdminPassword, setResetAdminPassword] = useState('');
  const [resetMfaCode, setResetMfaCode] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetPending, setResetPending] = useState(false);
  const newPasswordChecks = getStaffPasswordChecks(newPassword);
  const resetPasswordChecks = getStaffPasswordChecks(resetNewPassword);

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

  // Fetch users & logs on tab switch
  useEffect(() => {
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

  const closePasswordReset = (force = false) => {
    if (resetPending && !force) return;
    setResetTarget(null);
    setResetNewPassword('');
    setResetConfirmPassword('');
    setResetAdminPassword('');
    setResetMfaCode('');
    setResetError('');
  };

  const handlePasswordReset = async (event) => {
    event.preventDefault();
    if (!resetTarget || resetPending) return;
    setResetError('');
    if (!isStaffPasswordValid(resetNewPassword)) {
      setResetError(lang === 'ar'
        ? 'يجب أن تتكون كلمة المرور الجديدة من 10 إلى 200 حرف، وتحتوي على حرف كبير وحرف صغير ورقم.'
        : 'New password must be 10–200 characters and include an uppercase letter, a lowercase letter, and a number.');
      return;
    }
    if (resetNewPassword !== resetConfirmPassword) {
      setResetError(lang === 'ar' ? 'كلمتا المرور الجديدتان غير متطابقتين.' : 'New passwords do not match.');
      return;
    }

    setResetPending(true);
    try {
      const response = await fetchWithAuth(`/api/auth/users/${resetTarget.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({
          newPassword: resetNewPassword,
          currentAdminPassword: resetAdminPassword,
          ...(user?.mfaEnabled ? { mfaCode: resetMfaCode } : {})
        })
      });
      const data = await response.json();
      if (!response.ok) {
        const details = Array.isArray(data?.error?.details)
          ? data.error.details.map((detail) => detail?.message).filter(Boolean).join(' ')
          : '';
        setResetError(details || apiErrorMessage(data, lang === 'ar' ? 'تعذر إعادة تعيين كلمة المرور.' : 'Failed to reset staff password.'));
        setResetAdminPassword('');
        setResetMfaCode('');
        return;
      }
      closePasswordReset(true);
      setSuccessMsg(lang === 'ar' ? 'تمت إعادة تعيين كلمة مرور الموظف.' : 'Staff password reset successfully.');
    } catch {
      setResetError(lang === 'ar' ? 'تعذر الاتصال بالخادم. يرجى المحاولة مرة أخرى.' : 'Unable to connect to the server. Please try again.');
      setResetAdminPassword('');
      setResetMfaCode('');
    } finally {
      setResetPending(false);
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
                    autoComplete="new-password"
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
                  {filterStaffUsers(users).map((u) => (
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
                        {isStaffRole(u.role) && <>
                        <button
                          className={`btn ${u.status === 'ACTIVE' ? 'btn-danger' : 'btn-primary'}`}
                          style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                          onClick={() => handleToggleUserStatus(u.id, u.status)}
                        >
                          {u.status === 'ACTIVE' ? (lang === 'ar' ? 'تعطيل' : 'Deactivate') : (lang === 'ar' ? 'تفعيل' : 'Activate')}
                        </button>
                        {u.id !== user?.id && <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '4px 8px', fontSize: '0.8rem', marginInlineStart: '0.4rem' }}
                          onClick={() => {
                            setResetTarget(u);
                            setResetError('');
                          }}
                        >
                          {lang === 'ar' ? 'إعادة تعيين كلمة المرور' : 'Reset Password'}
                        </button>}
                        </>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                </table>
              </div>
            </div>
            {resetTarget && <div className="modal-overlay" role="presentation">
              <div className="modal-content-panel" role="dialog" aria-modal="true" aria-labelledby="staff-password-reset-title" style={{ width: 'min(520px, 100%)', padding: '1.5rem' }}>
                <h3 id="staff-password-reset-title">{lang === 'ar' ? 'إعادة تعيين كلمة مرور الموظف' : 'Reset Staff Password'}</h3>
                <p>{resetTarget.username} — {getRoleLabel(resetTarget.role)}</p>
                {resetError && <div role="alert" className="badge badge-danger" style={{ width: '100%', marginBottom: '1rem', padding: '0.5rem' }}>{resetError}</div>}
                <form onSubmit={handlePasswordReset} style={{ display: 'grid', gap: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="staff-reset-new-password">{lang === 'ar' ? 'كلمة المرور الجديدة' : 'New Password'}</label>
                    <input id="staff-reset-new-password" className="form-input" type="password" autoComplete="new-password" required minLength={10} maxLength={STAFF_PASSWORD_MAX_LENGTH} value={resetNewPassword} onChange={(event) => setResetNewPassword(event.target.value)} />
                    <div className="password-requirements" aria-live="polite">
                      {Object.entries({
                        minimumLength: lang === 'ar' ? '10 أحرف على الأقل' : 'At least 10 characters',
                        maximumLength: lang === 'ar' ? '200 حرف على الأكثر' : 'At most 200 characters',
                        uppercase: lang === 'ar' ? 'حرف إنجليزي كبير' : 'One uppercase letter',
                        lowercase: lang === 'ar' ? 'حرف إنجليزي صغير' : 'One lowercase letter',
                        number: lang === 'ar' ? 'رقم واحد على الأقل' : 'One number'
                      }).map(([key, label]) => <span key={key} className={resetPasswordChecks[key] ? 'valid' : ''}>{label}</span>)}
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="staff-reset-confirm-password">{lang === 'ar' ? 'تأكيد كلمة المرور الجديدة' : 'Confirm New Password'}</label>
                    <input id="staff-reset-confirm-password" className="form-input" type="password" autoComplete="new-password" required value={resetConfirmPassword} onChange={(event) => setResetConfirmPassword(event.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="staff-reset-admin-password">{lang === 'ar' ? 'كلمة مرور المدير الحالية' : 'Current Admin Password'}</label>
                    <input id="staff-reset-admin-password" className="form-input" type="password" autoComplete="current-password" required value={resetAdminPassword} onChange={(event) => setResetAdminPassword(event.target.value)} />
                  </div>
                  {user?.mfaEnabled && <div className="form-group">
                    <label className="form-label" htmlFor="staff-reset-mfa-code">{lang === 'ar' ? 'رمز المصادقة' : 'Authenticator Code'}</label>
                    <input id="staff-reset-mfa-code" className="form-input" type="text" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" value={resetMfaCode} onChange={(event) => setResetMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))} />
                  </div>}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
                    <button type="button" className="btn btn-secondary" disabled={resetPending} onClick={closePasswordReset}>{lang === 'ar' ? 'إلغاء' : 'Cancel'}</button>
                    <button type="submit" className="btn btn-primary" disabled={resetPending}>{resetPending ? (lang === 'ar' ? 'جارٍ الحفظ…' : 'Saving…') : (lang === 'ar' ? 'إعادة التعيين' : 'Reset Password')}</button>
                  </div>
                </form>
              </div>
            </div>}
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

/* ==========================================
   2. RECEPTIONIST DASHBOARD
   ========================================== */
