import { logoutAccount } from './services/logout.js';
import React, { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LogOut,
  HeartPulse,
  ShieldCheck,
  Eye,
  EyeOff
} from 'lucide-react';
import ThemeToggle from './components/ui/ThemeToggle';
import staff3dScene from './assets/alshifa-staff-3d.webp';
import './features/patient-auth/patientAuth.css';

import NotificationDropdown from './components/NotificationDropdown';
import StaffSecurityDialog from './components/StaffSecurityDialog';
import MfaCodeInput from './components/MfaCodeInput';
import { clearStaffSession, readStaffSession, writeStaffSession } from './services/authStorage';
import { completeStaffMfa, completeStaffMfaRecovery, isTerminalMfaError, startStaffLogin } from './services/staffLogin';
import { fetchWithAuth } from './services/staffApi';
import {
  configureStaffSocketSessionRevocation,
  connectStaffSocket,
  disconnectStaffSocket
} from './services/staffSocket';

import './App.css';

const AdminDashboard = lazy(() => import('./features/admin/AdminDashboard'));
const LaboratoryDashboard = lazy(() => import('./features/laboratory/LaboratoryDashboard'));
const PharmacyDashboard = lazy(() => import('./features/pharmacy/PharmacyDashboard'));
const DoctorDashboard = lazy(() => import('./features/doctor/DoctorDashboard'));
const ReceptionDashboard = lazy(() => import('./features/reception/ReceptionDashboard'));

/**
 * Utility to generate WhatsApp Web click-to-chat links
 */

export default function App({ initialView = 'login' }) {
  const { t, i18n } = useTranslation();
  const [user, setUser] = useState(null);
  const [view, setView] = useState(initialView); // 'portal', 'login', 'dashboard'
  const lang = (i18n.resolvedLanguage || i18n.language || 'ar')
    .split('-')[0];
  const [securityOpen, setSecurityOpen] = useState(false);
  const [recoveryLoginNotice, setRecoveryLoginNotice] = useState(false);
  const [sessionRevokedNotice, setSessionRevokedNotice] = useState(false);

  // Load state on mount
  useEffect(() => {
    const staffSession = readStaffSession();

    if (staffSession) {
      setUser(staffSession.user);
      setView('dashboard');
    }
  }, []);

  const toggleLanguage = () => {
    const nextLang = lang === 'ar' ? 'en' : 'ar';
    i18n.changeLanguage(nextLang);
  };

  const handleLogin = (userData, token, context = {}) => {
    writeStaffSession(userData, token);
    setUser(userData);
    setRecoveryLoginNotice(context.mfaMethod === 'RECOVERY_CODE');
    setSessionRevokedNotice(false);
    setView('dashboard');
  };

  const handleLogout = async () => {
    await logoutAccount('staff');
    setSecurityOpen(false);
    setRecoveryLoginNotice(false);
    clearStaffSession();
    setUser(null);
    setView(initialView);
    disconnectStaffSocket();
  };

  const handleUserChange = (nextUser) => {
    const session = readStaffSession();
    if (!session) return handleLogout();
    writeStaffSession(nextUser, session.token);
    setUser(nextUser);
  };

  useEffect(() => {
    if (user && readStaffSession()) connectStaffSocket();
    return () => disconnectStaffSocket();
  }, [user]);

  useEffect(() => configureStaffSocketSessionRevocation(() => {
    setSecurityOpen(false);
    setRecoveryLoginNotice(false);
    clearStaffSession();
    setUser(null);
    setView('login');
    setSessionRevokedNotice(true);
  }), []);

  if (view === 'login') {
    return (
      <div className="patient-auth-shell patient-auth-shell--staff">
        <header className="patient-auth-topbar">
          <div className="patient-auth-topbar-inner">
            <a className="patient-auth-brand" href="/" aria-label={t('brandName')}>
              <span className="patient-auth-brand-mark"><HeartPulse size={20} aria-hidden="true" /></span>
              <span>{t('brandName')}</span>
            </a>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <a
                className="staff-topbar-patient-link"
                href="/patient-login"
              >
                {t('patientPortal')}
              </a>
              <ThemeToggle
                className="staff-theme-toggle-btn"
                size={15}
              />
              <div className="patient-auth-language" role="group" aria-label="Language">
                <button type="button" className={lang === 'ar' ? 'active' : ''} onClick={() => i18n.changeLanguage('ar')} lang="ar" aria-pressed={lang === 'ar'}>العربية</button>
                <button type="button" className={lang !== 'ar' ? 'active' : ''} onClick={() => i18n.changeLanguage('en')} lang="en" aria-pressed={lang !== 'ar'}>English</button>
              </div>
            </div>
          </div>
        </header>

        {sessionRevokedNotice && (
          <div style={{ width: 'min(960px, calc(100% - 64px))', margin: '10px auto -10px' }}>
            <div role="alert" className="patient-alert error">{t('sessionNoLongerValid')}</div>
          </div>
        )}

        <div className="patient-auth-stage">
          <aside className="patient-auth-aside" aria-hidden="true">
            <img
              className="patient-auth-illustration patient-auth-illustration--3d patient-auth-illustration--staff"
              src={staff3dScene}
              alt=""
              width="500"
              height="373"
              decoding="async"
              fetchPriority="high"
            />
          </aside>
          <div className="patient-auth-content">
            <LoginView onLogin={handleLogin} t={t} lang={lang} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      {/* Global Navbar */}
      <header className="nav-header no-print-section">
        <div className="brand-section">
          <HeartPulse className="logo-icon" size={28} />
          <span className="brand-title">{t('brandName')}</span>
        </div>
        <div className="header-actions">
          <button className="lang-toggle-btn" onClick={toggleLanguage}>
            {lang === 'ar' ? 'English' : 'العربية'}
          </button>
          <ThemeToggle className="lang-toggle-btn" style={{ padding: '0.5rem' }} size={18} />

          {user ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              {!user.mustChangePassword && <NotificationDropdown userId={user?.id} lang={lang} />}
              <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                {user.username} ({user.role})
              </span>
              {!user.mustChangePassword && <button className="btn btn-secondary" onClick={() => setSecurityOpen(true)}>
                <ShieldCheck size={16} />
                {t('securitySettings')}
              </button>}
              <button className="btn btn-secondary" onClick={handleLogout}>
                <LogOut size={16} />
                {t('logout')}
              </button>
            </div>
          ) : <button className="btn btn-secondary" onClick={() => { window.location.href = '/'; }}>{t('patientPortal')}</button>}
        </div>
      </header>

      {/* Main Container */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {recoveryLoginNotice && user && <div role="status" className="badge badge-warning recovery-login-notice">{t('recoveryLoginNotice')}</div>}
        {sessionRevokedNotice && (
          <div role="alert" className="badge badge-danger staff-login-error">{t('sessionNoLongerValid')}</div>
        )}
        {view === 'dashboard' && user && (user.mustChangePassword
          ? <RequiredPasswordChange t={t} onComplete={handleLogout} />
          : <DashboardContainer user={user} lang={lang} t={t} />)}
      </main>
      {securityOpen && user && <StaffSecurityDialog user={user} onUserChange={handleUserChange} onClose={() => setSecurityOpen(false)} t={t} />}
    </div>
  );
}

function RequiredPasswordChange({ t, onComplete }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) return setError(t('passwordsDoNotMatch'));
    setSaving(true);
    try {
      const response = await fetchWithAuth('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message || body?.error || t('passwordChangeFailed'));
      await onComplete();
    } catch (requestError) { setError(requestError.message); }
    finally { setSaving(false); }
  };
  return <section className="staff-login-card" style={{ maxWidth: 460, margin: '3rem auto' }}>
    <div className="staff-mfa-icon"><ShieldCheck size={30} /></div>
    <h2>{t('passwordChangeRequired')}</h2><p>{t('passwordChangeRequiredDescription')}</p>
    <form onSubmit={submit} className="staff-login-form">
      <input className="form-input" type="password" autoComplete="current-password" placeholder={t('currentPassword')} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
      <input className="form-input" type="password" autoComplete="new-password" placeholder={t('newPassword')} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required minLength={10} maxLength={200} />
      <input className="form-input" type="password" autoComplete="new-password" placeholder={t('confirmNewPassword')} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
      {error && <div role="alert" className="badge badge-danger">{error}</div>}
      <button className="btn btn-primary" disabled={saving}>{saving ? t('loading') : t('savePassword')}</button>
    </form>
  </section>;
}

/* ==========================================
   PATIENT PUBLIC BOOKING PORTAL
   ========================================== */
function LoginView({ onLogin, t, lang }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState(null);
  const [mfaMethod, setMfaMethod] = useState('totp');
  const [errorMsg, setErrorMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const mfaCodeRef = useRef(null);
  const recoveryCodeRef = useRef(null);

  const clearMfaCode = useCallback(() => {
    mfaCodeRef.current?.clear();
    if (recoveryCodeRef.current) recoveryCodeRef.current.value = '';
  }, []);

  useEffect(() => {
    if (!mfaChallenge) return undefined;
    const remainingMs = new Date(mfaChallenge.expiresAt).getTime() - Date.now();
    const expire = () => {
      setMfaChallenge(null);
      clearMfaCode();
      setErrorMsg(t('mfaChallengeExpired'));
    };
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
      expire();
      return undefined;
    }
    const timer = window.setTimeout(expire, remainingMs);
    return () => window.clearTimeout(timer);
  }, [clearMfaCode, mfaChallenge, t]);

  const cancelMfa = () => {
    setMfaChallenge(null);
    setMfaMethod('totp');
    clearMfaCode();
    setErrorMsg('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setErrorMsg('');
    try {
      const result = await startStaffLogin({ username, password }, onLogin);
      if (result.state === 'MFA_REQUIRED') {
        setPassword('');
        setMfaMethod('totp');
        setMfaChallenge({ token: result.challengeToken, expiresAt: result.expiresAt });
      }
    } catch (err) {
      setErrorMsg(err?.status ? err.message : 'Cannot connect to authorization service.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleMfaSubmit = async (e) => {
    e.preventDefault();
    if (submitting || !mfaChallenge) return;
    const code = mfaMethod === 'totp'
      ? mfaCodeRef.current?.getValue() || ''
      : String(recoveryCodeRef.current?.value || '').trim();
    if (mfaMethod === 'totp' && code.length !== 6) {
      setErrorMsg(t('mfaCodeIncomplete'));
      mfaCodeRef.current?.focus();
      return;
    }
    if (mfaMethod === 'recovery' && !code) {
      setErrorMsg(t('recoveryCodeRequired'));
      recoveryCodeRef.current?.focus();
      return;
    }
    setSubmitting(true);
    setErrorMsg('');
    try {
      if (mfaMethod === 'totp') await completeStaffMfa(mfaChallenge.token, code, onLogin);
      else await completeStaffMfaRecovery(mfaChallenge.token, code, onLogin);
      clearMfaCode();
      setMfaChallenge(null);
    } catch (err) {
      if (isTerminalMfaError(err)) {
        clearMfaCode();
        setMfaChallenge(null);
        setErrorMsg(t('mfaChallengeExpired'));
      } else if (err?.status === 429) {
        setErrorMsg(t('mfaRateLimited'));
      } else if (err?.code === 'MFA_CODE_INVALID' || err?.code === 'MFA_RECOVERY_INVALID') {
        if (mfaMethod === 'recovery' && recoveryCodeRef.current) {
          recoveryCodeRef.current.value = '';
          recoveryCodeRef.current.focus();
        }
        setErrorMsg(mfaMethod === 'recovery' ? t('recoveryCodeInvalid') : t('mfaCodeInvalid'));
      } else {
        setErrorMsg(t('mfaServiceUnavailable'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (mfaChallenge) return (
    <section className="patient-auth" aria-labelledby="staff-mfa-title">
      <header className="patient-auth-heading">
        <div className="patient-auth-brand-mark" style={{ marginBottom: '12px', width: '40px', height: '40px' }}>
          <ShieldCheck size={22} aria-hidden="true" />
        </div>
        <h1 id="staff-mfa-title">{mfaMethod === 'totp' ? t('twoFactorAuthentication') : t('recoveryCodeTitle')}</h1>
        <p className="patient-auth-intro">{mfaMethod === 'totp' ? t('mfaCodeInstructions') : t('recoveryCodeLoginDescription')}</p>
      </header>

      {errorMsg && <div role="alert" className="patient-alert error">{errorMsg}</div>}

      <form onSubmit={handleMfaSubmit}>
        {mfaMethod === 'totp' ? (
          <label className="patient-field">
            {t('authenticatorCode')}
            <MfaCodeInput
              ref={mfaCodeRef}
              id="staff-mfa-code"
              required
              autoFocus
              className="form-input staff-mfa-code"
            />
          </label>
        ) : (
          <label className="patient-field">
            {t('recoveryCodeTitle')}
            <input ref={recoveryCodeRef} id="staff-recovery-code" type="text" autoComplete="off" required dir="ltr" />
          </label>
        )}

        <button type="submit" disabled={submitting} className="patient-button" style={{ marginTop: '10px' }}>
          {submitting ? t('verifying') : mfaMethod === 'totp' ? t('verify') : t('verifyRecoveryCode')}
        </button>

        <button
          type="button"
          disabled={submitting}
          className="patient-button secondary"
          style={{ marginTop: '10px' }}
          onClick={() => { clearMfaCode(); setErrorMsg(''); setMfaMethod(mfaMethod === 'totp' ? 'recovery' : 'totp'); }}
        >
          {mfaMethod === 'totp' ? <>{t('lostYourPhone')} {t('useRecoveryCode')}</> : t('useAuthenticatorInstead')}
        </button>

        <button
          type="button"
          disabled={submitting}
          className="patient-button secondary"
          style={{ marginTop: '10px' }}
          onClick={cancelMfa}
        >
          {t('backToLogin')}
        </button>
      </form>
    </section>
  );

  return (
    <section className="patient-auth" aria-labelledby="staff-auth-title">
      <header className="patient-auth-heading">
        <p className="patient-auth-welcome">{t('staffPortal') || 'بوابة الموظفين'}</p>
        <h1 id="staff-auth-title">{t('signIn') || 'تسجيل الدخول'}</h1>
        <p className="patient-auth-intro">
          {lang === 'ar'
            ? 'دخول آمن للكوادر الطبية والإدارية'
            : 'Secure access for medical and administrative staff'}
        </p>
      </header>

      {errorMsg && (
        <div role="alert" className="patient-alert error">
          {errorMsg}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <label className="patient-field">
          {t('username')}
          <input
            id="staff-username"
            className="patient-auth-identifier"
            type="email"
            required
            autoComplete="username"
            placeholder="staff@cms.com"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            dir="ltr"
          />
        </label>

        <label className="patient-field">
          {t('password')}
          <span className="patient-field__password-wrap">
            <input
              id="staff-password"
              className="patient-field__password-input"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="patient-field__password-toggle"
              aria-label={showPassword ? t('hidePassword') : t('showPassword')}
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </span>
        </label>

        <button
          type="submit"
          disabled={submitting}
          className="patient-button"
          style={{ marginTop: '6px' }}
        >
          {submitting ? t('loading') : (t('signIn') || t('login'))}
        </button>

        <div className="patient-auth-create-account">
          <p>{lang === 'ar' ? 'هل تبحث عن خدمات المرضى؟' : 'Looking for patient services?'}</p>
          <a href="/patient-login" className="patient-auth-secondary-button">
            {t('patientPortal')}
          </a>
        </div>
      </form>
    </section>
  );
}

/* ==========================================
   ROLE DASHBOARDS CONTAINER
   ========================================== */
function DashboardContainer({ user, lang, t }) {
  let dashboard;
  if (user.role === 'ADMIN') {
    dashboard = <AdminDashboard user={user} lang={lang} t={t} />;
  }
  else if (user.role === 'RECEPTIONIST') {
    dashboard = <ReceptionDashboard lang={lang} t={t} />;
  }
  else if (user.role === 'DOCTOR') {
    dashboard = <DoctorDashboard user={user} lang={lang} t={t} />;
  }
  else if (user.role === 'PHARMACIST') {
    dashboard = <PharmacyDashboard lang={lang} t={t} />;
  }
  else if (user.role === 'LAB_TECH') {
    dashboard = <LaboratoryDashboard lang={lang} />;
  }
  else return (
    <div style={{ padding: '3rem', textAlign: 'center' }}>
      <h3>Unknown User Role. Contact administrator.</h3>
    </div>
  );
  return <Suspense fallback={<div className="portal-loading" role="status"><HeartPulse/><span>{t('loading')}</span></div>}>{dashboard}</Suspense>;
}

/* ==========================================
   1. ADMIN DASHBOARD
   ========================================== */
