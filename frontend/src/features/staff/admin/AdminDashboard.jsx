import './clinicSetup.css';
import './adminDashboard.css';
import ClinicSetupPanel from './ClinicSetupPanel';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Building,
  CalendarDays,
  DollarSign,
  Plus,
  ShieldCheck,
  Sliders,
  Stethoscope,
  UserPlus,
  Users,
  X
} from 'lucide-react';
import { useStaffNav } from '../staffShellContext';
import { apiErrorMessage, fetchWithAuth } from '../../../services/staff/staffApi';
import { getStaffPasswordChecks, isStaffPasswordValid, STAFF_PASSWORD_MAX_LENGTH } from './staffPasswordPolicy';
import { buildStaffCreationPayload } from './staffCreationPayload';
import { filterStaffUsers, isStaffRole } from './staffRoles';
import AuditLogPanel from './AuditLogPanel';
import ClinicProfilePanel from './ClinicProfilePanel';
import SpecialtyRow from './SpecialtyRow';
import AdminSchedulePanel from './AdminSchedulePanel';
import PasswordField from '../../../components/PasswordField.jsx';

// recharts (via AnalyticsPanel) is large; load it only when the analytics tab is opened.
const AnalyticsPanel = lazy(() => import('./AnalyticsPanel'));

export default function AdminDashboard({ user, lang, t, initialTab = 'profile' }) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [users, setUsers] = useState([]);
  const [usersLoadError, setUsersLoadError] = useState(false);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [analyticsError, setAnalyticsError] = useState('');
  const [pricing, setPricing] = useState(null);
  const [pricingDrafts, setPricingDrafts] = useState({});
  const [pricingLoading, setPricingLoading] = useState(false);

  // Filters for staff directory
  const [searchStaff, setSearchStaff] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [showAddStaffModal, setShowAddStaffModal] = useState(false);
  const [manageTarget, setManageTarget] = useState(null);
  const [manageError, setManageError] = useState('');
  const [statusUpdatePending, setStatusUpdatePending] = useState(false);
  const [specialtiesLoadError, setSpecialtiesLoadError] = useState(false);
  const [creatingSpecialty, setCreatingSpecialty] = useState(false);
  const [savingSpecialtyId, setSavingSpecialtyId] = useState(null);
  const [showAddSpecialtyModal, setShowAddSpecialtyModal] = useState(false);

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

  const navItems = useMemo(() => [
    { id: 'profile', label: lang === 'ar' ? 'الملف التعريفي للمنشأة' : 'Facility profile', icon: Building },
    { id: 'users', label: lang === 'ar' ? 'حسابات الموظفين' : 'Staff accounts', icon: Users },
    { id: 'pricing', label: lang === 'ar' ? 'إدارة الأسعار' : 'Pricing Management', icon: DollarSign },
    { id: 'specialties', label: lang === 'ar' ? 'التخصصات' : 'Specialties', icon: Stethoscope },
    ...(user?.role === 'ADMIN' ? [{ id: 'scheduling', label: lang === 'ar' ? 'جداول الأطباء' : 'Doctor schedules', icon: CalendarDays }] : []),
    { id: 'analytics', label: lang === 'ar' ? 'التقارير' : 'Reports', icon: Activity },
    { id: 'logs', label: lang === 'ar' ? 'سجل العمليات' : 'Audit log', icon: ShieldCheck },
    { id: 'clinic-setup', label: lang === 'ar' ? 'الأطباء والكتالوجات' : 'Doctors & catalogs', icon: Sliders }
  ], [lang, user?.role]);

  useStaffNav({
    items: navItems,
    activeId: activeTab,
    onSelect: setActiveTab,
    roleLabel: lang === 'ar' ? 'إدارة النظام' : 'Administration'
  });

  const reloadSpecialties = useCallback(async () => {
    try {
      const response = await fetchWithAuth('/api/specialties');
      if (!response.ok) throw new Error('Specialties load failed');
      const data = await response.json().catch(() => []);
      setSpecialties(Array.isArray(data) ? data : []);
      setSpecialtiesLoadError(false);
    } catch (err) {
      console.error(err);
      setSpecialtiesLoadError(true);
    }
  }, []);

  useEffect(() => {
    reloadSpecialties();
  }, [reloadSpecialties]);

  const createSpecialty = async (event) => {
    event.preventDefault();
    if (creatingSpecialty) return;
    setCreatingSpecialty(true);
    setSpecialtyError('');
    setSpecialtyFeedback(null);
    try {
      const response = await fetchWithAuth('/api/specialties', {
        method: 'POST',
        body: JSON.stringify({ ...specialtyDraft, active: true })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSpecialtyError(
          apiErrorMessage(
            data,
            lang === 'ar' ? 'تعذر إنشاء التخصص.' : 'Unable to create specialty.'
          )
        );
        return;
      }
      setSpecialtyDraft({ code: '', nameAr: '', nameEn: '' });
      setShowAddSpecialtyModal(false);
      await reloadSpecialties();
    } catch (err) {
      console.error(err);
      setSpecialtyError(
        lang === 'ar'
          ? 'حدث خطأ أثناء الاتصال بالخادم.'
          : 'A network error occurred while connecting to the server.'
      );
    } finally {
      setCreatingSpecialty(false);
    }
  };

  const saveSpecialty = async (specialty) => {
    if (savingSpecialtyId) return;
    setSavingSpecialtyId(specialty.id);
    setSpecialtyError('');
    setSpecialtyFeedback(null);
    try {
      const response = await fetchWithAuth(`/api/specialties/${specialty.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          code: specialty.code,
          nameAr: specialty.nameAr,
          nameEn: specialty.nameEn,
          active: specialty.active
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSpecialtyError(
          apiErrorMessage(
            data,
            lang === 'ar' ? 'تعذر حفظ التخصص.' : 'Unable to save specialty.'
          )
        );
        return;
      }
      await reloadSpecialties();
    } catch (err) {
      console.error(err);
      setSpecialtyError(
        lang === 'ar'
          ? 'حدث خطأ أثناء الاتصال بالخادم.'
          : 'A network error occurred while connecting to the server.'
      );
    } finally {
      setSavingSpecialtyId(null);
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

  const fetchUsers = useCallback(() => {
    fetchWithAuth('/api/auth/users')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load users');
        return res.json();
      })
      .then((data) => {
        setUsersLoadError(false);
        setUsers(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        setUsersLoadError(true);
      });
  }, []);

  // Fetch users & logs on tab switch
  useEffect(() => {
    if (activeTab === 'users') {
      fetchUsers();
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
  }, [activeTab, lang, fetchUsers]);

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
      const updated = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(
          apiErrorMessage(
            updated,
            lang === 'ar' ? 'تعذر تحديث السعر الرسمي.' : 'Could not update the official price.'
          )
        );
        return;
      }
      setPricing((current) => ({
        ...current,
        [kind]: current[kind].map((entry) => entry.id === item.id ? updated : entry)
      }));
      setPricingDrafts((current) => ({ ...current, [key]: undefined }));
      setSuccessMsg(lang === 'ar' ? 'تم تحديث السعر الرسمي.' : 'Official price updated.');
    } catch {
      setErrorMsg(lang === 'ar' ? 'حدث خطأ أثناء حفظ السعر.' : 'Error saving price.');
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
        setShowAddStaffModal(false);
        // Reload list
        fetchUsers();
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
    if (statusUpdatePending) return;
    const nextStatus = currentStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    setStatusUpdatePending(true);
    setManageError('');
    try {
      const res = await fetchWithAuth(`/api/auth/users/${userId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: nextStatus })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setUsers(
          users.map((u) => (u.id === userId ? { ...u, status: nextStatus } : u))
        );
        setManageTarget((prev) => (prev && prev.id === userId ? { ...prev, status: nextStatus } : prev));
      } else {
        setManageError(
          apiErrorMessage(
            data,
            lang === 'ar' ? 'تعذر تغيير حالة المستخدم.' : 'Failed to update user status.'
          )
        );
      }
    } catch (err) {
      console.error(err);
      setManageError(
        lang === 'ar' ? 'تعذر الاتصال بالخادم. حاول مرة أخرى.' : 'Could not reach server. Please try again.'
      );
    } finally {
      setStatusUpdatePending(false);
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

  const staffList = filterStaffUsers(users);
  const totalStaffCount = staffList.length;
  const activeStaffCount = staffList.filter((u) => u.status === 'ACTIVE').length;

  const filteredStaff = staffList.filter((u) => {
    if (roleFilter && u.role !== roleFilter) return false;
    if (!searchStaff) return true;
    const q = searchStaff.toLowerCase();
    return (
      (u.username && u.username.toLowerCase().includes(q)) ||
      (u.fullNameAr && u.fullNameAr.toLowerCase().includes(q)) ||
      (u.fullNameEn && u.fullNameEn.toLowerCase().includes(q))
    );
  });

  return (
    <div className="admin-workspace">
      {activeTab === 'clinic-setup' && (
        <div className="admin-main">
          <ClinicSetupPanel lang={lang} t={t}/>
        </div>
      )}
      {activeTab === 'profile' && (
        <div className="admin-main">
          <ClinicProfilePanel lang={lang} t={t}/>
        </div>
      )}

      {activeTab === 'users' && (
        <div className="admin-main">
          <header className="admin-header ui-page-header">
            <div className="admin-header-titles">
              <h1 className="ui-page-title">{lang === 'ar' ? 'حسابات الموظفين' : 'Staff accounts'}</h1>
              <span className="admin-header-count">
                {lang === 'ar'
                  ? `${totalStaffCount} حسابات · ${activeStaffCount} نشط`
                  : `${totalStaffCount} accounts · ${activeStaffCount} active`}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setErrorMsg('');
                setSuccessMsg('');
                setShowAddStaffModal(true);
              }}
            >
              <UserPlus size={18} strokeWidth={1.8} aria-hidden="true" />
              {lang === 'ar' ? 'إضافة موظف' : 'Add staff member'}
            </button>
          </header>

          {errorMsg && <div className="badge badge-danger admin-alert" role="alert">{errorMsg}</div>}
          {successMsg && <div className="badge badge-success admin-alert" role="status">{successMsg}</div>}

          <div className="admin-filters">
            <label className="admin-filter-group admin-filter-search">
              <span className="ui-section-label">{lang === 'ar' ? 'البحث عن موظف' : 'Search staff'}</span>
              <input
                type="search"
                className="form-input"
                placeholder={lang === 'ar' ? 'الاسم أو اسم المستخدم' : 'Name or username'}
                value={searchStaff}
                onChange={(e) => setSearchStaff(e.target.value)}
              />
            </label>
            <label className="admin-filter-group admin-filter-role">
              <span className="ui-section-label">{lang === 'ar' ? 'الدور الوظيفي' : 'Role'}</span>
              <select
                className="form-input"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
              >
                <option value="">{lang === 'ar' ? 'كل الأدوار' : 'All roles'}</option>
                <option value="DOCTOR">{getRoleLabel('DOCTOR')}</option>
                <option value="RECEPTIONIST">{getRoleLabel('RECEPTIONIST')}</option>
                <option value="PHARMACIST">{getRoleLabel('PHARMACIST')}</option>
                <option value="LAB_TECH">{getRoleLabel('LAB_TECH')}</option>
                <option value="ADMIN">{getRoleLabel('ADMIN')}</option>
              </select>
            </label>
          </div>

          <div className="admin-table-panel ui-panel">
            {usersLoadError && (
              <div role="alert" className="patient-alert error">
                {lang === 'ar' ? 'تعذر تحميل القائمة. تحقق من الاتصال وحاول مرة أخرى.' : 'Could not load this list. Check the connection and try again.'} <button type="button" onClick={fetchUsers}>{lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}</button>
              </div>
            )}
            <div className="admin-staff-table-scroll">
              <div className="admin-staff-header-grid">
                <span>{lang === 'ar' ? 'الاسم' : 'Name'}</span>
                <span>{lang === 'ar' ? 'اسم المستخدم' : 'Username'}</span>
                <span>{lang === 'ar' ? 'الدور' : 'Role'}</span>
                <span>{lang === 'ar' ? 'الحالة' : 'Status'}</span>
                <span></span>
              </div>
              {filteredStaff.length === 0 ? (
                <div className="admin-empty-state">
                  {lang === 'ar' ? 'لا يوجد موظفون مطابقون للبحث.' : 'No staff accounts match the filter.'}
                </div>
              ) : (
                filteredStaff.map((u) => {
                  const staffName = (lang === 'ar' ? u.fullNameAr : u.fullNameEn) || (lang === 'ar' ? u.fullNameEn : u.fullNameAr) || u.username;
                  return (
                    <div key={u.id} className="admin-staff-row-grid">
                      <span className="admin-staff-name">{staffName}</span>
                      <span className="ui-mono admin-staff-username">{u.username}</span>
                      <span className="admin-staff-role">{getRoleLabel(u.role)}</span>
                      <span className={`ui-status ${u.status === 'ACTIVE' ? 'ui-status--ok' : 'ui-status--muted'}`}>
                        {getUserStatusLabel(u.status)}
                      </span>
                      <div className="admin-staff-actions">
                        {isStaffRole(u.role) && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => {
                              setManageTarget(u);
                              setManageError('');
                            }}
                          >
                            {lang === 'ar' ? 'إدارة' : 'Manage'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <span className="admin-hint">
            {lang === 'ar'
              ? 'إدارة تفتح لوحة لإعادة تعيين كلمة المرور وإنهاء جلسات المستخدم من جميع الأجهزة.'
              : 'Manage opens one panel for password reset and signing a user out of all devices.'}
          </span>

          {showAddStaffModal && (
            <div className="modal-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowAddStaffModal(false); }}>
              <div className="modal-content-panel admin-add-staff-modal" role="dialog" aria-modal="true" aria-labelledby="add-staff-title">
                <div className="admin-modal-header">
                  <div>
                    <span className="ui-section-label">{lang === 'ar' ? 'حساب جديد' : 'New Account'}</span>
                    <h3 id="add-staff-title">{lang === 'ar' ? 'إضافة موظف جديد' : 'Add New Staff'}</h3>
                  </div>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowAddStaffModal(false)} aria-label={lang === 'ar' ? 'إغلاق' : 'Close'}><X size={18} aria-hidden="true" /></button>
                </div>
                {errorMsg && <div className="badge badge-danger admin-modal-alert">{errorMsg}</div>}
                {successMsg && <div className="badge badge-success admin-modal-alert">{successMsg}</div>}
                <form onSubmit={handleCreateUser} className="admin-form">
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
                      <div className="form-group">
                        <label className="form-label">{lang === 'ar' ? 'التخصص' : 'Specialty'}</label>
                        <select required className="form-input" value={newSpecialtyId} onChange={(e) => setNewSpecialtyId(e.target.value)}>
                          <option value="">{lang === 'ar' ? 'اختر التخصص' : 'Select specialty'}</option>
                          {specialties.filter((specialty) => specialty.active).map((specialty) => (
                            <option key={specialty.id} value={specialty.id}>{lang === 'ar' ? specialty.nameAr : specialty.nameEn}</option>
                          ))}
                        </select>
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
                  <div className="admin-form-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => setShowAddStaffModal(false)}>
                      {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                    </button>
                    <button type="submit" className="btn btn-primary">
                      {lang === 'ar' ? 'إنشاء الحساب' : 'Create Account'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {manageTarget && (() => {
            const u = manageTarget;
            const staffName = (lang === 'ar' ? u.fullNameAr : u.fullNameEn) || (lang === 'ar' ? u.fullNameEn : u.fullNameAr) || u.username;
            return (
              <div className="modal-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) { setManageTarget(null); setManageError(''); } }}>
                <div className="modal-content-panel admin-manage-modal" role="dialog" aria-modal="true" aria-labelledby="manage-staff-title">
                  <div className="admin-modal-header">
                    <div>
                      <span className="ui-section-label">{lang === 'ar' ? 'إدارة الموظف' : 'Manage Staff Member'}</span>
                      <h3 id="manage-staff-title">{staffName}</h3>
                    </div>
                    <button type="button" className="btn btn-secondary" onClick={() => { setManageTarget(null); setManageError(''); }} aria-label={lang === 'ar' ? 'إغلاق' : 'Close'}><X size={18} aria-hidden="true" /></button>
                  </div>
                  {manageError && <div role="alert" className="badge badge-danger admin-modal-alert">{manageError}</div>}
                  <div className="admin-manage-info">
                    <div>
                      <span className="ui-section-label">{lang === 'ar' ? 'اسم المستخدم' : 'Username'}</span>
                      <span className="ui-mono admin-manage-field-value">{u.username}</span>
                    </div>
                    <div>
                      <span className="ui-section-label">{lang === 'ar' ? 'الدور' : 'Role'}</span>
                      <span className="admin-manage-field-value">{getRoleLabel(u.role)}</span>
                    </div>
                    <div>
                      <span className="ui-section-label">{lang === 'ar' ? 'الحالة' : 'Status'}</span>
                      <span className={`ui-status ${u.status === 'ACTIVE' ? 'ui-status--ok' : 'ui-status--muted'} admin-manage-field-value`}>
                        {getUserStatusLabel(u.status)}
                      </span>
                    </div>
                  </div>
                  <div className="admin-manage-actions">
                    {isStaffRole(u.role) && (
                      <button
                        type="button"
                        className={`btn ${u.status === 'ACTIVE' ? 'btn-danger' : 'btn-primary'}`}
                        disabled={statusUpdatePending}
                        onClick={() => {
                          handleToggleUserStatus(u.id, u.status);
                        }}
                      >
                        {u.status === 'ACTIVE' ? (lang === 'ar' ? 'تعطيل الحساب' : 'Deactivate') : (lang === 'ar' ? 'تفعيل الحساب' : 'Activate')}
                      </button>
                    )}
                    {u.id !== user?.id && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => {
                          setResetTarget(u);
                          setResetError('');
                          setManageTarget(null);
                          setManageError('');
                        }}
                      >
                        {lang === 'ar' ? 'إعادة تعيين كلمة المرور' : 'Reset Password'}
                      </button>
                    )}
                    {u.id !== user?.id && u.status === 'ACTIVE' && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => {
                          setRevokeTarget(u);
                          setRevokeError('');
                          setManageTarget(null);
                          setManageError('');
                        }}
                      >
                        {lang === 'ar' ? 'إنهاء الجلسات' : 'Sign out of all devices'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {resetTarget && <div className="modal-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) closePasswordReset(); }}>
            <div className="modal-content-panel admin-reset-modal" role="dialog" aria-modal="true" aria-labelledby="staff-password-reset-title">
              <h3 id="staff-password-reset-title">{lang === 'ar' ? 'إعادة تعيين كلمة مرور الموظف' : 'Reset Staff Password'}</h3>
              <p>{resetTarget.username} — {getRoleLabel(resetTarget.role)}</p>
              {resetError && <div role="alert" className="badge badge-danger admin-modal-alert">{resetError}</div>}
              <form onSubmit={handlePasswordReset} className="admin-grid-form">
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
                <div className="admin-modal-actions">
                  <button type="button" className="btn btn-secondary" disabled={resetPending} onClick={closePasswordReset}>{lang === 'ar' ? 'إلغاء' : 'Cancel'}</button>
                  <button type="submit" className="btn btn-primary" disabled={resetPending}>{resetPending ? (lang === 'ar' ? 'جارٍ الحفظ…' : 'Saving…') : (lang === 'ar' ? 'إعادة التعيين' : 'Reset Password')}</button>
                </div>
              </form>
            </div>
          </div>}

          {revokeTarget && <div className="modal-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) closeSessionRevocation(); }}>
            <div className="modal-content-panel admin-revoke-modal" role="dialog" aria-modal="true" aria-labelledby="staff-session-revocation-title">
              <h3 id="staff-session-revocation-title">{lang === 'ar' ? 'إنهاء جلسات المستخدم' : 'Sign out user from all devices'}</h3>
              <p>{revokeTarget.username} — {getRoleLabel(revokeTarget.role)}</p>
              <p className="admin-modal-description">
                {lang === 'ar'
                  ? 'سيتم إنهاء الجلسات النشطة فقط. لن يتم تعطيل الحساب أو تغيير كلمة المرور أو الدور.'
                  : 'This ends active sessions only. It does not deactivate the account, reset the password, or change the role.'}
              </p>
              {revokeError && <div role="alert" className="badge badge-danger admin-modal-alert">{revokeError}</div>}
              <div className="admin-modal-actions">
                <button type="button" className="btn btn-secondary" disabled={revokePending} onClick={closeSessionRevocation}>{lang === 'ar' ? 'إلغاء' : 'Cancel'}</button>
                <button type="button" className="btn btn-danger" disabled={revokePending} onClick={handleSessionRevocation}>{revokePending ? (lang === 'ar' ? 'جارٍ الإنهاء…' : 'Signing out…') : (lang === 'ar' ? 'إنهاء جميع الجلسات' : 'Sign out all devices')}</button>
              </div>
            </div>
          </div>}
        </div>
      )}

      {activeTab === 'pricing' && (
        <div className="admin-main">
          <header className="admin-header ui-page-header">
            <div className="admin-header-titles">
              <h1 className="ui-page-title">{lang === 'ar' ? 'إدارة الأسعار' : 'Pricing Management'}</h1>
              <span className="admin-header-subtitle">
                {lang === 'ar'
                  ? 'تُستخدم الأسعار المحفوظة هنا للفواتير الجديدة فقط، ولا تتغير الفواتير التاريخية.'
                  : 'Prices saved here apply to future invoices only. Historical invoices remain unchanged.'}
              </span>
            </div>
          </header>
          {errorMsg && <div className="badge badge-danger admin-alert" role="alert">{errorMsg}</div>}
          {successMsg && <div className="badge badge-success admin-alert" role="status">{successMsg}</div>}
          {pricingLoading || !pricing ? <div className="portal-loading" /> : (
            <>
              <PricingTable title={lang === 'ar' ? 'رسوم الاستشارات' : 'Consultation Fees'} kind="doctors" items={pricing.doctors} lang={lang} drafts={pricingDrafts} setDrafts={setPricingDrafts} onSave={saveOfficialPrice} />
              <PricingTable title={lang === 'ar' ? 'الخدمات السريرية والمختبرية' : 'Clinical & Laboratory Services'} kind="services" items={pricing.services} lang={lang} drafts={pricingDrafts} setDrafts={setPricingDrafts} onSave={saveOfficialPrice} />
              <PricingTable title={lang === 'ar' ? 'أسعار الصيدلية' : 'Pharmacy Selling Prices'} kind="medicines" items={pricing.medicines} lang={lang} drafts={pricingDrafts} setDrafts={setPricingDrafts} onSave={saveOfficialPrice} />
            </>
          )}
        </div>
      )}

      {activeTab === 'specialties' && (
        <div className="admin-main">
          <header className="admin-header ui-page-header">
            <div className="admin-header-titles">
              <h1 className="ui-page-title">{lang === 'ar' ? 'إدارة التخصصات' : 'Specialties'}</h1>
              <span className="admin-header-subtitle">
                {lang === 'ar' ? `${specialties.length} تخصص مسجل` : `${specialties.length} registered specialties`}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setSpecialtyError('');
                setSpecialtyFeedback(null);
                setShowAddSpecialtyModal(true);
              }}
            >
              <Plus size={18} strokeWidth={1.8} aria-hidden="true" />
              {lang === 'ar' ? 'إضافة تخصص' : 'Add specialty'}
            </button>
          </header>

          {specialtiesLoadError && (
            <div role="alert" className="patient-alert error">
              {lang === 'ar' ? 'تعذر تحميل القائمة. تحقق من الاتصال وحاول مرة أخرى.' : 'Could not load this list. Check the connection and try again.'}{' '}
              <button type="button" onClick={reloadSpecialties}>
                {lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}
              </button>
            </div>
          )}

          {specialtyError && <div role="alert" className="badge badge-danger">{specialtyError}</div>}
          {specialtyFeedback && <div role={specialtyFeedback.type === 'error' ? 'alert' : 'status'} className={`badge ${specialtyFeedback.type === 'error' ? 'badge-danger' : 'badge-success'}`}>{specialtyFeedback.message}</div>}

          <div className="ui-panel admin-table-panel">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>{lang === 'ar' ? 'الرمز' : 'Code'}</th>
                  <th>{lang === 'ar' ? 'العربية' : 'Arabic'}</th>
                  <th>{lang === 'ar' ? 'الإنجليزية' : 'English'}</th>
                  <th>{lang === 'ar' ? 'الحالة' : 'Status'}</th>
                  <th>{lang === 'ar' ? 'الإجراءات' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody>
                {specialties.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="admin-empty-state">
                      {lang === 'ar' ? 'لا توجد تخصصات مسجلة.' : 'No registered specialties.'}
                    </td>
                  </tr>
                ) : (
                  specialties.map((specialty) => (
                    <SpecialtyRow
                      key={specialty.id}
                      specialty={specialty}
                      lang={lang}
                      onSave={saveSpecialty}
                      isAdmin={user?.role === 'ADMIN'}
                      request={fetchWithAuth}
                      onDeleted={specialtyDeleted}
                      onFeedback={showSpecialtyFeedback}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>

          {showAddSpecialtyModal && (
            <div className="modal-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowAddSpecialtyModal(false); }}>
              <div className="modal-content-panel admin-specialty-modal" role="dialog" aria-modal="true" aria-labelledby="add-specialty-title">
                <div className="admin-modal-header">
                  <div>
                    <span className="ui-section-label">{lang === 'ar' ? 'تخصص جديد' : 'New Specialty'}</span>
                    <h3 id="add-specialty-title">{lang === 'ar' ? 'إضافة تخصص جديد' : 'Add New Specialty'}</h3>
                  </div>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowAddSpecialtyModal(false)} aria-label={lang === 'ar' ? 'إغلاق' : 'Close'}><X size={18} aria-hidden="true" /></button>
                </div>
                <form onSubmit={createSpecialty} className="admin-form">
                  <div className="form-group">
                    <label className="form-label">{lang === 'ar' ? 'رمز التخصص' : 'Specialty code'}</label>
                    <input required className="form-input ui-mono" placeholder={lang === 'ar' ? 'مثال: CARD' : 'e.g. CARD'} value={specialtyDraft.code} onChange={(e) => setSpecialtyDraft((v) => ({ ...v, code: e.target.value }))}/>
                  </div>
                  <div className="form-group">
                    <label className="form-label">{lang === 'ar' ? 'الاسم بالعربية' : 'Arabic name'}</label>
                    <input required className="form-input" placeholder={lang === 'ar' ? 'الاسم بالعربية' : 'Arabic name'} value={specialtyDraft.nameAr} onChange={(e) => setSpecialtyDraft((v) => ({ ...v, nameAr: e.target.value }))}/>
                  </div>
                  <div className="form-group">
                    <label className="form-label">{lang === 'ar' ? 'الاسم بالإنجليزية' : 'English name'}</label>
                    <input required className="form-input" placeholder={lang === 'ar' ? 'الاسم بالإنجليزية' : 'English name'} value={specialtyDraft.nameEn} onChange={(e) => setSpecialtyDraft((v) => ({ ...v, nameEn: e.target.value }))}/>
                  </div>
                  <div className="admin-form-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => setShowAddSpecialtyModal(false)}>
                      {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={creatingSpecialty}>
                      {creatingSpecialty ? (lang === 'ar' ? 'جارٍ الإضافة…' : 'Adding…') : (lang === 'ar' ? 'إضافة' : 'Add')}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'scheduling' && user?.role === 'ADMIN' && (
        <div className="admin-main">
          <AdminSchedulePanel lang={lang} t={t} />
        </div>
      )}

      {activeTab === 'analytics' && (
        <div className="admin-main">
          <Suspense fallback={<div role="status" aria-live="polite" className="admin-loading-fallback">{t('analyticsLoading')}</div>}>
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
          </Suspense>
        </div>
      )}

      {activeTab === 'logs' && (
        <div className="admin-main">
          <AuditLogPanel lang={lang} t={t}/>
        </div>
      )}
    </div>
  );
}

function PricingTable({ title, kind, items, lang, drafts, setDrafts, onSave }) {
  const priceField = kind === 'doctors' ? 'consultationFee' : kind === 'services' ? 'baseFeeSdg' : 'unitPriceSdg';
  return (
    <section className="admin-pricing-section">
      <h3 className="admin-section-title ui-section-label">{title}</h3>
      <div className="ui-panel admin-table-panel">
        <table className="staff-table">
          <thead>
            <tr>
              <th>{lang === 'ar' ? 'الاسم' : 'Name'}</th>
              <th>{lang === 'ar' ? 'الفئة' : 'Category'}</th>
              <th>{lang === 'ar' ? 'السعر الحالي' : 'Current Price'}</th>
              <th>{lang === 'ar' ? 'الحالة' : 'Status'}</th>
              <th>{lang === 'ar' ? 'آخر تحديث' : 'Last Updated'}</th>
              <th>{lang === 'ar' ? 'إجراء' : 'Action'}</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="admin-empty-state">
                  {lang === 'ar' ? 'لا توجد عناصر مسجلة.' : 'No entries found.'}
                </td>
              </tr>
            ) : (
              items.map((item) => {
              const key = `${kind}:${item.id}`;
              const currentPrice = item[priceField];
              const draft = drafts[key] || { priceSdg: currentPrice == null ? '' : String(Number(currentPrice)), status: item.status };
              return (
                <tr key={item.id}>
                  <td className="admin-pricing-name">{lang === 'ar' ? (item.fullNameAr || item.labelAr) : (item.fullNameEn || item.labelEn)}</td>
                  <td className="admin-pricing-category">{item.category || item.specialtyEn || item.dosageForm || '—'}</td>
                  <td>
                    <input
                      aria-label={`${kind} price`}
                      className="form-input ui-mono"
                      type="number"
                      min="1"
                      step="1"
                      placeholder={lang === 'ar' ? 'غير محدد' : 'Not configured'}
                      value={draft.priceSdg}
                      onChange={(event) => setDrafts((current) => ({ ...current, [key]: { ...draft, priceSdg: event.target.value } }))}
                    />
                  </td>
                  <td>
                    <select
                      aria-label={`${kind} status`}
                      className="form-input"
                      value={draft.status}
                      onChange={(event) => setDrafts((current) => ({ ...current, [key]: { ...draft, status: event.target.value } }))}
                    >
                      <option value="ACTIVE">{lang === 'ar' ? 'نشط' : 'Active'}</option>
                      <option value="INACTIVE">{lang === 'ar' ? 'غير نشط' : 'Inactive'}</option>
                    </select>
                  </td>
                  <td className="ui-mono admin-pricing-updated">
                    {item.updatedAt ? new Date(item.updatedAt).toLocaleString(lang === 'ar' ? 'ar' : 'en') : '—'}
                  </td>
                  <td>
                    <button type="button" className="btn btn-secondary" onClick={() => onSave(kind, item)}>
                      {lang === 'ar' ? 'حفظ' : 'Save'}
                    </button>
                  </td>
                </tr>
              );
            })
          )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
