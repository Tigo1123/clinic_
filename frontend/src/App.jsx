import { logoutAccount } from './services/logout.js';
import React, { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { LogOut, HeartPulse, ShieldCheck } from 'lucide-react';
import ThemeToggle from './components/ui/ThemeToggle';
import './features/patient-auth/patientAuth.css';

import NotificationDropdown from './components/NotificationDropdown';
import StaffSecurityDialog from './components/StaffSecurityDialog';
import MfaCodeInput from './components/MfaCodeInput';
import { clearStaffSession, readStaffSession, writeStaffSession } from './services/authStorage';
import { completeStaffMfa, completeStaffMfaRecovery, isTerminalMfaError, startStaffLogin } from './services/staffLogin';
import { apiErrorMessage, fetchWithAuth } from './services/staffApi';
import { localizedApiErrorMessage } from './services/apiClient.js';
import {
  configureStaffSocketSessionRevocation,
  connectStaffSocket,
  disconnectStaffSocket
} from './services/staffSocket';

import './App.css';
import { useFacilityBranding } from './app/branding/FacilityBrandingContext.js';
import { brandingSubline } from './app/branding/brandingConfig';
import { withLoginSubmissionLock } from './features/patient-auth/loginSubmission.js';
import PasswordField from './components/PasswordField.jsx';

const AdminDashboard = lazy(() => import('./features/admin/AdminDashboard'));
const LaboratoryDashboard = lazy(() => import('./features/laboratory/LaboratoryDashboard'));
const PharmacyDashboard = lazy(() => import('./features/pharmacy/PharmacyDashboard'));
const DoctorDashboard = lazy(() => import('./features/doctor/DoctorDashboard'));
const ReceptionDashboard = lazy(() => import('./features/reception/ReceptionDashboard'));
const RequiredStaffMfaEnrollment = lazy(() => import('./components/RequiredStaffMfaEnrollment.jsx'));

/**
 * Utility to generate WhatsApp Web click-to-chat links
 */

export default function App({ initialView = 'login' }) {
  const { t, i18n } = useTranslation();
  const branding = useFacilityBranding();
  const [user, setUser] = useState(null);
  const [view, setView] = useState(initialView); // 'portal', 'login', 'dashboard'
  const lang = (i18n.resolvedLanguage || i18n.language || 'ar')
    .split('-')[0];
  const displayName = lang === 'ar' ? branding.displayNameAr : branding.displayNameEn;
  const productDescriptor = brandingSubline(branding, lang);
  const facilityName = lang === 'ar' ? branding.facilityNameAr : branding.facilityNameEn;
  const productName = lang === 'ar' ? branding.productNameAr : branding.productNameEn;
  const [securityOpen, setSecurityOpen] = useState(false);
  const [recoveryLoginNotice, setRecoveryLoginNotice] = useState(false);
  const [sessionRevokedNotice, setSessionRevokedNotice] = useState(false);
  const [mfaEnrollmentToken, setMfaEnrollmentToken] = useState(null);

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
    setMfaEnrollmentToken(null);
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
            <a className="patient-auth-brand" href="/" aria-label={displayName}>
              <span className="patient-auth-brand-mark"><HeartPulse size={20} aria-hidden="true" /></span>
              <span>{displayName}{!facilityName && <small className="brand-product-descriptor">{productDescriptor}</small>}</span>
            </a>
            <div className="patient-auth-topbar-actions patient-auth-topbar-actions--staff">
              <a
                className="staff-topbar-patient-link"
                href="/patient-login"
              >
                {t('patientPortalShort')}
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

        <div className="patient-auth-stage patient-auth-stage--login">
          <div className="patient-auth-content">
            {mfaEnrollmentToken
              ? <RequiredStaffMfaEnrollment token={mfaEnrollmentToken} t={t} onDone={() => setMfaEnrollmentToken(null)} />
              : <LoginView onLogin={handleLogin} onMfaEnrollmentRequired={setMfaEnrollmentToken} t={t} lang={lang} productName={productName} productDescriptor={branding.productDescriptorAr && lang === 'ar' ? branding.productDescriptorAr : branding.productDescriptorEn} showProductIdentity={Boolean(facilityName)} />}
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
          <span className="brand-title">{displayName}<small className="brand-product-descriptor">{productDescriptor}</small></span>
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
                <bdi>{user.username}</bdi> ({t(`staffRole_${user.role}`)})
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
      if (!response.ok) throw new Error(apiErrorMessage(body, t('passwordChangeFailed')));
      await onComplete();
    } catch (requestError) { setError(requestError.message); }
    finally { setSaving(false); }
  };
  return <section className="staff-login-card" style={{ maxWidth: 460, margin: '3rem auto' }}>
    <div className="staff-mfa-icon"><ShieldCheck size={30} /></div>
    <h2>{t('passwordChangeRequired')}</h2><p>{t('passwordChangeRequiredDescription')}</p>
    <form onSubmit={submit} className="staff-login-form">
      <PasswordField label={t('currentPassword')} value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} autoComplete="current-password" required />
      <PasswordField label={t('newPassword')} value={newPassword} onChange={event => setNewPassword(event.target.value)} autoComplete="new-password" required minLength={10} maxLength={200} helperText={t('passwordRequirementsSummary')} />
      <PasswordField label={t('confirmNewPassword')} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password" required error={Boolean(confirmPassword && newPassword !== confirmPassword)} helperText={confirmPassword && newPassword !== confirmPassword ? t('passwordsDoNotMatch') : undefined} />
      {error && <div role="alert" className="badge badge-danger">{error}</div>}
      <button className="btn btn-primary" disabled={saving}>{saving ? t('loading') : t('savePassword')}</button>
    </form>
  </section>;
}

/* ==========================================
   PATIENT PUBLIC BOOKING PORTAL
   ========================================== */
function LoginView({ onLogin, onMfaEnrollmentRequired, t, lang, productName, productDescriptor, showProductIdentity }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mfaChallenge, setMfaChallenge] = useState(null);
  const [mfaMethod, setMfaMethod] = useState('totp');
  const [errorMsg, setErrorMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submitInFlight = useRef(false);
  const authFlow = useRef({ step: 'password', generation: 0, challenge: null });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const flow = authFlow.current;
    return () => {
      mounted.current = false;
      flow.generation += 1;
      flow.challenge = null;
    };
  }, []);
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
      if (authFlow.current.challenge !== mfaChallenge) return;
      authFlow.current.generation += 1;
      authFlow.current.step = 'password';
      authFlow.current.challenge = null;
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
    if (submitInFlight.current) return;
    authFlow.current.generation += 1;
    authFlow.current.step = 'password';
    authFlow.current.challenge = null;
    setMfaChallenge(null);
    setMfaMethod('totp');
    clearMfaCode();
    setErrorMsg('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!mounted.current || submitInFlight.current || authFlow.current.step !== 'password') return;
    await withLoginSubmissionLock(submitInFlight, setSubmitting, async () => {
      const generation = ++authFlow.current.generation;
      authFlow.current.step = 'password-pending';
      setErrorMsg('');
      try {
        const finalizeLogin = (...args) => {
          if (!mounted.current || authFlow.current.generation !== generation || authFlow.current.step !== 'password-pending') return;
          authFlow.current.step = 'authenticated';
          onLogin(...args);
        };
        const result = await startStaffLogin({ username, password }, finalizeLogin);
        if (!mounted.current || authFlow.current.generation !== generation) return;
        if (result.state === 'MFA_REQUIRED') {
          const challenge = { token: result.challengeToken, expiresAt: result.expiresAt };
          // This synchronous phase change survives the request lock releasing
          // before React commits the MFA screen. Queued password events stop here.
          authFlow.current.step = 'mfa';
          authFlow.current.challenge = challenge;
          setPassword('');
          setMfaMethod('totp');
          setMfaChallenge(challenge);
        } else if (result.state === 'MFA_ENROLLMENT_REQUIRED') {
          authFlow.current.step = 'enrollment';
          setPassword('');
          onMfaEnrollmentRequired(result.enrollmentToken);
        }
      } catch (err) {
        if (!mounted.current || authFlow.current.generation !== generation) return;
        authFlow.current.step = 'password';
        authFlow.current.challenge = null;
        setMfaChallenge(null);
        setErrorMsg(localizedApiErrorMessage(err));
      }
    });
  };

  const handleMfaSubmit = async (e) => {
    e.preventDefault();
    const challenge = authFlow.current.challenge;
    if (!mounted.current || submitInFlight.current || authFlow.current.step !== 'mfa' || !challenge) return;
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
    await withLoginSubmissionLock(submitInFlight, setSubmitting, async () => {
      const generation = authFlow.current.generation;
      authFlow.current.step = 'mfa-pending';
      setErrorMsg('');
      try {
        const finalizeLogin = (...args) => {
          if (!mounted.current || authFlow.current.generation !== generation || authFlow.current.challenge !== challenge || authFlow.current.step !== 'mfa-pending') return;
          authFlow.current.step = 'authenticated';
          authFlow.current.challenge = null;
          onLogin(...args);
        };
        if (mfaMethod === 'totp') await completeStaffMfa(challenge.token, code, finalizeLogin);
        else await completeStaffMfaRecovery(challenge.token, code, finalizeLogin);
        if (!mounted.current || authFlow.current.generation !== generation) return;
        clearMfaCode();
        setMfaChallenge(null);
      } catch (err) {
        if (!mounted.current || authFlow.current.generation !== generation) return;
        authFlow.current.step = 'mfa';
        if (isTerminalMfaError(err)) {
          authFlow.current.generation += 1;
          authFlow.current.step = 'password';
          authFlow.current.challenge = null;
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
      }
    });
  };

  if (mfaChallenge) return (
    <section className="patient-auth" aria-labelledby="staff-mfa-title">
      <header className="patient-auth-heading">
        {showProductIdentity && <p className="patient-auth-product-line">{productName}<span aria-hidden="true"> · </span>{productDescriptor}</p>}
        <div className="patient-auth-brand-mark" style={{ marginBottom: '12px', width: '40px', height: '40px' }}>
          <ShieldCheck size={22} aria-hidden="true" />
        </div>
        <h1 id="staff-mfa-title">{mfaMethod === 'totp' ? t('twoFactorAuthentication') : t('recoveryCodeTitle')}</h1>
        <p className="patient-auth-intro">{mfaMethod === 'totp' ? t('mfaCodeInstructions') : t('recoveryCodeLoginDescription')}</p>
      </header>

      {errorMsg && <div role="alert" className="patient-alert error">{errorMsg}</div>}

      <form onSubmit={handleMfaSubmit} aria-busy={submitting}>
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
        <div className="patient-auth-login-intro">
          <HeartPulse className="patient-auth-login-intro__icon" size={27} strokeWidth={1.8} aria-hidden="true" />
          <div>
            {showProductIdentity && <p className="patient-auth-product-line">{productName}<span aria-hidden="true"> · </span>{productDescriptor}</p>}
            <p className="patient-auth-welcome">{t('staffPortal') || 'بوابة الموظفين'}</p>
            <h1 id="staff-auth-title">{t('signIn') || 'تسجيل الدخول'}</h1>
            <p className="patient-auth-intro">
              {lang === 'ar'
                ? 'دخول آمن للكوادر الطبية والإدارية'
                : 'Secure access for medical and administrative staff'}
            </p>
          </div>
        </div>
      </header>

      {errorMsg && (
        <div role="alert" className="patient-alert error">
          {errorMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} aria-busy={submitting}>
        <label className="patient-field">
          {t('username')}
          <input
            id="staff-username"
            className="patient-auth-identifier"
            type="email"
            required
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            dir="ltr"
          />
        </label>

        <PasswordField id="staff-password" label={t('password')} required autoComplete="current-password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} />

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
            {t('patientPortalShort')}
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
      <h3>{t('unknownUserRole')}</h3>
    </div>
  );
  return <Suspense fallback={<div className="portal-loading" role="status"><HeartPulse/><span>{t('loading')}</span></div>}>{dashboard}</Suspense>;
}

/* ==========================================
   1. ADMIN DASHBOARD
   ========================================== */
