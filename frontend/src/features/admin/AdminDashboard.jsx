import { useStaffPagedList } from '../../hooks/useStaffPagedList.js';
import StaffListPaging from '../../components/StaffListPaging.jsx';
import './clinicSetup.css';
import ClinicSetupPanel from './ClinicSetupPanel';
import { useEffect, useRef, useState } from 'react';
import { Activity, Building, CalendarDays, DollarSign, Sliders, Users } from 'lucide-react';
import { apiErrorMessage, fetchWithAuth } from '../../services/staffApi';
import RoleHero from '../../components/healthcare/RoleHero';
import { getStaffPasswordChecks, isStaffPasswordValid, STAFF_PASSWORD_MAX_LENGTH } from '../../utils/staffPasswordPolicy';
import { buildStaffCreationPayload } from '../../utils/staffCreationPayload';
import { filterStaffUsers, isStaffRole } from '../../utils/staffRoles';
import AuditLogPanel from './AuditLogPanel';
import AnalyticsPanel from './AnalyticsPanel';
import ClinicProfilePanel from './ClinicProfilePanel';
import SpecialtiesPanel from './SpecialtiesPanel.jsx';
import AdminSchedulePanel from './AdminSchedulePanel';
import PasswordField from '../../components/PasswordField.jsx';

export default function AdminDashboard({ user, lang, t }) {
  const [activeTab, setActiveTab] = useState('profile');
  const userList = useStaffPagedList('/api/auth/users');
  const { data: users, setData: setUsers } = userList;
  const [analyticsData, setAnalyticsData] = useState(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [analyticsError, setAnalyticsError] = useState('');
  const [pricing, setPricing] = useState(null);
  const [pricingDrafts, setPricingDrafts] = useState({});
  const [pricingLoading, setPricingLoading] = useState(false);

  // User form states
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('RECEPTIONIST');
  const [newFullNameAr, setNewFullNameAr] = useState('');
  const [newFullNameEn, setNewFullNameEn] = useState('');
  const [specialties, setSpecialties] = useState([]);
  const [newSpecialtyId, setNewSpecialtyId] = useState('');
  const [specialtyDraft, setSpecialtyDraft] = useState({ code: '', nameAr: '', nameEn: '' });
  const [specialtyError, setSpecialtyError] = useState('');
  const [specialtyFeedback, setSpecialtyFeedback] = useState(null);
  const [specialtyCreatePending, setSpecialtyCreatePending] = useState(false);
  const specialtyCreateInFlight = useRef(false);
  const specialtyDeleted = (id) => {
    setSpecialties((current) => current.filter((item) => item.id !== id));
    setNewSpecialtyId((current) => current === id ? '' : current);
  };
  const showSpecialtyFeedback = (feedback) => { setSpecialtyError(''); setSpecialtyFeedback(feedback); };
  const [newConsultationFee, setNewConsultationFee] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [resetTarget, setResetTarget] = useState(null);
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [resetAdminPassword, setResetAdminPassword] = useState('');
  const [resetMfaCode, setResetMfaCode] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetPending, setResetPending] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [revokeError, setRevokeError] = useState('');
  const [revokePending, setRevokePending] = useState(false);
  const newPasswordChecks = getStaffPasswordChecks(newPassword);
  const resetPasswordChecks = getStaffPasswordChecks(resetNewPassword);
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
          specialtyId: newSpecialtyId,
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
        setNewSpecialtyId('');
        setNewConsultationFee('');
        await userList.reload();
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

  const closeSessionRevocation = (force = false) => {
    if (revokePending && !force) return;
    setRevokeTarget(null);
    setRevokeError('');
  };

  const handleSessionRevocation = async () => {
    if (!revokeTarget || revokePending) return;
    setRevokePending(true);
    setRevokeError('');
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const response = await fetchWithAuth(`/api/auth/users/${revokeTarget.id}/revoke-sessions`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) {
        setRevokeError(apiErrorMessage(data, lang === 'ar' ? 'تعذر إنهاء الجلسات.' : 'Failed to sign out the user.'));
        return;
      }
      closeSessionRevocation(true);
      setSuccessMsg(lang === 'ar' ? 'تم إنهاء جميع جلسات المستخدم النشطة.' : 'All active sessions for this user have been ended.');
    } catch {
      setRevokeError(lang === 'ar' ? 'تعذر الاتصال بالخادم. يرجى المحاولة مرة أخرى.' : 'Unable to connect to the server. Please try again.');
    } finally {
      setRevokePending(false);
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
    <div className="dashboard-wrapper admin-workspace">
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
        {activeTab !== 'clinic-setup' && <RoleHero role="admin" lang={lang}/>}
        {activeTab === 'clinic-setup' && <ClinicSetupPanel lang={lang} t={t}/>}
        {activeTab === 'profile' && (
          <ClinicProfilePanel lang={lang} t={t} onNavigate={setActiveTab}/>
        )}

        {activeTab === 'users' && <StaffListPaging list={userList} lang={lang} label={lang === 'ar' ? 'الموظفون' : 'Staff accounts'} />}
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
                  <PasswordField label={t('password')} required autoComplete="new-password" minLength={10} maxLength={STAFF_PASSWORD_MAX_LENGTH} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} helperText={t('passwordRequirementsSummary')} />
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
                    <div className="form-group"><label className="form-label">{lang === 'ar' ? 'التخصص' : 'Specialty'}</label><select required className="form-input" value={newSpecialtyId} onChange={(e) => setNewSpecialtyId(e.target.value)}><option value="">{lang === 'ar' ? 'اختر التخصص' : 'Select specialty'}</option>{specialties.filter((specialty) => specialty.active).map((specialty) => <option key={specialty.id} value={specialty.id}>{lang === 'ar' ? specialty.nameAr : specialty.nameEn}</option>)}</select></div>
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
                        {u.id !== user?.id && u.status === 'ACTIVE' && <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '4px 8px', fontSize: '0.8rem', marginInlineStart: '0.4rem' }}
                          onClick={() => { setRevokeTarget(u); setRevokeError(''); }}
                        >
                          {lang === 'ar' ? 'إنهاء الجلسات' : 'Sign out of all devices'}
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
                    <PasswordField id="staff-reset-new-password" label={lang === 'ar' ? 'كلمة المرور الجديدة' : 'New Password'} autoComplete="new-password" required minLength={10} maxLength={STAFF_PASSWORD_MAX_LENGTH} value={resetNewPassword} onChange={(event) => setResetNewPassword(event.target.value)} helperText={t('passwordRequirementsSummary')} />
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
                    <PasswordField id="staff-reset-confirm-password" label={lang === 'ar' ? 'تأكيد كلمة المرور الجديدة' : 'Confirm New Password'} autoComplete="new-password" required value={resetConfirmPassword} onChange={(event) => setResetConfirmPassword(event.target.value)} error={Boolean(resetConfirmPassword && resetNewPassword !== resetConfirmPassword)} helperText={resetConfirmPassword && resetNewPassword !== resetConfirmPassword ? t('passwordsDoNotMatch') : undefined} />
                  </div>
                  <div className="form-group">
                    <PasswordField id="staff-reset-admin-password" label={lang === 'ar' ? 'كلمة مرور المدير الحالية' : 'Current Admin Password'} autoComplete="current-password" required value={resetAdminPassword} onChange={(event) => setResetAdminPassword(event.target.value)} />
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
            {revokeTarget && <div className="modal-overlay" role="presentation">
              <div className="modal-content-panel" role="dialog" aria-modal="true" aria-labelledby="staff-session-revocation-title" style={{ width: 'min(520px, 100%)', padding: '1.5rem' }}>
                <h3 id="staff-session-revocation-title">{lang === 'ar' ? 'إنهاء جلسات المستخدم' : 'Sign out user from all devices'}</h3>
                <p>{revokeTarget.username} — {getRoleLabel(revokeTarget.role)}</p>
                <p style={{ opacity: 0.8 }}>
                  {lang === 'ar'
                    ? 'سيتم إنهاء الجلسات النشطة فقط. لن يتم تعطيل الحساب أو تغيير كلمة المرور أو الدور.'
                    : 'This ends active sessions only. It does not deactivate the account, reset the password, or change the role.'}
                </p>
                {revokeError && <div role="alert" className="badge badge-danger" style={{ width: '100%', marginBottom: '1rem', padding: '0.5rem' }}>{revokeError}</div>}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
                  <button type="button" className="btn btn-secondary" disabled={revokePending} onClick={closeSessionRevocation}>{lang === 'ar' ? 'إلغاء' : 'Cancel'}</button>
                  <button type="button" className="btn btn-danger" disabled={revokePending} onClick={handleSessionRevocation}>{revokePending ? (lang === 'ar' ? 'جارٍ الإنهاء…' : 'Signing out…') : (lang === 'ar' ? 'إنهاء جميع الجلسات' : 'Sign out all devices')}</button>
                </div>
              </div>
            </div>}
          </div>
        )}

        {activeTab === 'pricing' && (
          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <h3>{lang === 'ar' ? 'إدارة الأسعار الرسمية للمنشأة' : 'Facility Pricing Management'}</h3>
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
