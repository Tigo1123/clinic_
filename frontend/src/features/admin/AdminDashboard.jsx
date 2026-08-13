import { useEffect, useState } from 'react';
import { Activity, AlertCircle, Building, Calendar, CheckCircle, DollarSign, Sliders, Stethoscope, Users } from 'lucide-react';
import { apiErrorMessage, fetchWithAuth } from '../../services/staffApi';

export default function AdminDashboard({ lang, t }) {
  const [activeTab, setActiveTab] = useState('profile');
  const [logs, setLogs] = useState([]);
  const [users, setUsers] = useState([]);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [analyticsError, setAnalyticsError] = useState('');

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
          setAnalyticsError(err.message || 'Failed to fetch analytics');
          setAnalyticsData(null);
          setLoadingAnalytics(false);
        });
    }
  }, [activeTab]);

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await fetchWithAuth('/api/auth/users', {
        method: 'POST',
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          role: newRole,
          fullNameAr: newFullNameAr,
          fullNameEn: newFullNameEn,
          specialtyAr: newSpecialtyAr,
          specialtyEn: newSpecialtyEn,
          consultationFee: newConsultationFee
        })
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
        setErrorMsg(apiErrorMessage(data, 'Failed to create user.'));
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Failed to connect to the backend server.');
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
                    placeholder="••••••••"
                    className="form-input"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">{lang === 'ar' ? 'الدور الوظيفي' : 'Role'}</label>
                  <select className="form-input" value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                    <option value="ADMIN">ADMIN</option>
                    <option value="RECEPTIONIST">RECEPTIONIST</option>
                    <option value="DOCTOR">DOCTOR</option>
                    <option value="PHARMACIST">PHARMACIST</option>
                    <option value="LAB_TECH">LAB_TECH</option>
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
                        <span className="badge badge-success" style={{ fontSize: '0.8rem' }}>{u.role}</span>
                      </td>
                      <td>
                        <span className={`badge ${u.status === 'ACTIVE' ? 'badge-success' : 'badge-danger'}`}>
                          {u.status}
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
                      {(analyticsData.financials?.totalRevenueSdg || 0).toLocaleString()} <span style={{ fontSize: '0.8rem' }}>SDG</span>
                    </h2>
                  </div>
                </div>

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
                            <span>{lang === 'ar' ? 'الحالات المنجزة (Completed)' : 'Completed'}</span>
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
                            <span>{lang === 'ar' ? 'في غرفة الكشف (In Consultation)' : 'In Consultation'}</span>
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
                            <span>{lang === 'ar' ? 'صالة الانتظار (Waiting)' : 'Waiting Room'}</span>
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
                            <span>{lang === 'ar' ? 'طلبات قيد المراجعة (Pending)' : 'Pending Approvals'}</span>
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
                      <td>{new Date(log.timestamp).toLocaleString()}</td>
                      <td>{log.userId || 'System'}</td>
                      <td>
                        <span className={`badge ${isBypass ? 'badge-danger' : 'badge-success'}`}>
                          {log.action}
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

/* ==========================================
   2. RECEPTIONIST DASHBOARD
   ========================================== */

