import React, { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LogOut,
  HeartPulse,
  ShieldCheck,
  Sun,
  Moon
} from 'lucide-react';

import NotificationDropdown from './components/NotificationDropdown';
import StaffSecurityDialog from './components/StaffSecurityDialog';
import MfaCodeInput from './components/MfaCodeInput';
import { clearStaffSession, readStaffSession, writeStaffSession } from './services/authStorage';
import { completeStaffMfa, completeStaffMfaRecovery, isTerminalMfaError, startStaffLogin } from './services/staffLogin';
import { staffSocket as socket } from './services/staffSocket';

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
  const [theme, setTheme] = useState('light');
  const [securityOpen, setSecurityOpen] = useState(false);
  const [recoveryLoginNotice, setRecoveryLoginNotice] = useState(false);

  // Load state on mount
  useEffect(() => {
    const staffSession = readStaffSession();
    const savedTheme = localStorage.getItem('cms_theme') || 'light';

    if (staffSession) {
      setUser(staffSession.user);
      setView('dashboard');
    }
    setTheme(savedTheme);
    document.documentElement.setAttribute('data-theme', savedTheme);

  }, []);

  const toggleLanguage = () => {
    const nextLang = lang === 'ar' ? 'en' : 'ar';
    i18n.changeLanguage(nextLang);
  };

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    localStorage.setItem('cms_theme', nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
  };

  const handleLogin = (userData, token, context = {}) => {
    writeStaffSession(userData, token);
    setUser(userData);
    setRecoveryLoginNotice(context.mfaMethod === 'RECOVERY_CODE');
    setView('dashboard');
  };

  const handleLogout = () => {
    setSecurityOpen(false);
    setRecoveryLoginNotice(false);
    clearStaffSession();
    setUser(null);
    setView(initialView);
    socket.disconnect();
  };

  const handleUserChange = (nextUser) => {
    const session = readStaffSession();
    if (!session) return handleLogout();
    writeStaffSession(nextUser, session.token);
    setUser(nextUser);
  };

  useEffect(() => {
    if (user && readStaffSession()) socket.connect();
    return () => socket.disconnect();
  }, [user]);

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
          <button className="lang-toggle-btn" style={{ padding: '0.5rem' }} onClick={toggleTheme}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {user ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <NotificationDropdown userId={user?.id} lang={lang} />
              <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                {user.username} ({user.role})
              </span>
              <button className="btn btn-secondary" onClick={() => setSecurityOpen(true)}>
                <ShieldCheck size={16} />
                {t('securitySettings')}
              </button>
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
        {view === 'login' && <LoginView onLogin={handleLogin} t={t} />}
        {view === 'dashboard' && user && (
          <DashboardContainer user={user} lang={lang} t={t} />
        )}
      </main>
      {securityOpen && user && <StaffSecurityDialog user={user} onUserChange={handleUserChange} onClose={() => setSecurityOpen(false)} t={t} />}
    </div>
  );
}

/* ==========================================
   PATIENT PUBLIC BOOKING PORTAL
   ========================================== */
function LoginView({ onLogin, t }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
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
    <div className="portal-container glass-panel staff-login-card">
      <div className="staff-mfa-icon" aria-hidden="true"><ShieldCheck size={30} /></div>
      <h3 className="staff-login-title">{mfaMethod === 'totp' ? t('twoFactorAuthentication') : t('recoveryCodeTitle')}</h3>
      <p className="staff-login-description">{mfaMethod === 'totp' ? t('mfaCodeInstructions') : t('recoveryCodeLoginDescription')}</p>
      {errorMsg && <div role="alert" className="badge badge-danger staff-login-error">{errorMsg}</div>}
      <form onSubmit={handleMfaSubmit} className="staff-login-form">
        {mfaMethod === 'totp' ? <div className="form-group">
          <label className="form-label" htmlFor="staff-mfa-code">{t('authenticatorCode')}</label>
          <MfaCodeInput
            ref={mfaCodeRef}
            id="staff-mfa-code"
            required
            autoFocus
            className="form-input staff-mfa-code"
          />
        </div> : <div className="form-group">
          <label className="form-label" htmlFor="staff-recovery-code">{t('recoveryCodeTitle')}</label>
          <input ref={recoveryCodeRef} id="staff-recovery-code" type="text" autoComplete="off" required className="form-input" />
        </div>}
        <button type="submit" disabled={submitting} className="btn btn-primary staff-login-submit">
          {submitting ? t('verifying') : mfaMethod === 'totp' ? t('verify') : t('verifyRecoveryCode')}
        </button>
        <button type="button" disabled={submitting} className="btn btn-secondary staff-login-submit" onClick={() => { clearMfaCode(); setErrorMsg(''); setMfaMethod(mfaMethod === 'totp' ? 'recovery' : 'totp'); }}>
          {mfaMethod === 'totp' ? <>{t('lostYourPhone')} {t('useRecoveryCode')}</> : t('useAuthenticatorInstead')}
        </button>
        <button type="button" disabled={submitting} className="btn btn-secondary staff-login-submit" onClick={cancelMfa}>
          {t('backToLogin')}
        </button>
      </form>
    </div>
  );

  return (
    <div className="portal-container glass-panel staff-login-card">
      <h3 className="staff-login-title">{t('login')}</h3>
      {errorMsg && (
        <div role="alert" className="badge badge-danger staff-login-error">
          {errorMsg}
        </div>
      )}
      <form onSubmit={handleSubmit} className="staff-login-form">
        <div className="form-group">
          <label className="form-label" htmlFor="staff-username">{t('username')}</label>
          <input
            id="staff-username"
            type="email"
            required
            autoComplete="username"
            className="form-input"
            placeholder="staff@cms.com"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="staff-password">{t('password')}</label>
          <input
            id="staff-password"
            type="password"
            required
            autoComplete="current-password"
            className="form-input"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button type="submit" disabled={submitting} className="btn btn-primary staff-login-submit">
          {submitting ? t('loading') : t('login')}
        </button>
      </form>
    </div>
  );
}

/* ==========================================
   ROLE DASHBOARDS CONTAINER
   ========================================== */
function DashboardContainer({ user, lang, t }) {
  let dashboard;
  if (user.role === 'ADMIN') {
    dashboard = <AdminDashboard lang={lang} t={t} />;
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
