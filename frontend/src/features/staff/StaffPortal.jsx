import { logoutAccount } from '../../services/logout.js';
import React, { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { HeartPulse, ShieldCheck } from 'lucide-react';
import ThemeToggle from '../../components/ui/ThemeToggle';
import '../patient/auth/patientAuth.css';

import StaffSecurityDialog from './components/StaffSecurityDialog';
import StaffShell from './components/StaffShell';
import MfaCodeInput from './components/MfaCodeInput';
import { clearStaffSession, readStaffSession, writeStaffSession } from '../../services/authStorage';
import { completeStaffMfa, completeStaffMfaRecovery, isTerminalMfaError, startStaffLogin } from '../../services/staff/staffLogin';
import { fetchWithAuth } from '../../services/staff/staffApi';
import {
  configureStaffSocketSessionRevocation,
  connectStaffSocket,
  disconnectStaffSocket
} from '../../services/staff/staffSocket';

import './staffPortal.css';
import { useFacilityBranding } from '../../app/branding/FacilityBrandingContext.js';
import { brandingSubline } from '../../app/branding/brandingConfig';
import { withLoginSubmissionLock } from '../../utils/loginSubmission.js';
import PasswordField from '../../components/PasswordField.jsx';
const AdminDashboard = lazy(() => import('./admin/AdminDashboard'));
const LaboratoryDashboard = lazy(() => import('./laboratory/LaboratoryDashboard'));
const PharmacyDashboard = lazy(() => import('./pharmacy/PharmacyDashboard'));
const DoctorDashboard = lazy(() => import('./doctor/DoctorDashboard'));
const ReceptionDashboard = lazy(() => import('./reception/ReceptionDashboard'));

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
          <div className="staff-session-revoked-banner">
            <div role="alert" className="patient-alert error">{t('sessionNoLongerValid')}</div>
          </div>
        )}

        <div className="patient-auth-stage patient-auth-stage--login">
          <div className="patient-auth-content">
            <LoginView onLogin={handleLogin} t={t} lang={lang} productName={productName} productDescriptor={branding.productDescriptorAr && lang === 'ar' ? branding.productDescriptorAr : branding.productDescriptorEn} showProductIdentity={Boolean(facilityName)} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <StaffShell
      user={user}
      displayName={displayName}
      lang={lang}
      t={t}
      onToggleLanguage={toggleLanguage}
      onLogout={handleLogout}
      onOpenSecurity={() => setSecurityOpen(true)}
    >
      {recoveryLoginNotice && user && (
        <div role="status" className="staff-shell__notice staff-shell__notice--warning">
          {t('recoveryLoginNotice')}
        </div>
      )}
      {sessionRevokedNotice && (
        <div role="alert" className="staff-shell__notice staff-shell__notice--danger">
          {t('sessionNoLongerValid')}
        </div>
      )}
      {view === 'dashboard' && user && (user.mustChangePassword
        ? <RequiredPasswordChange t={t} onComplete={handleLogout} />
        : <DashboardContainer user={user} lang={lang} t={t} />)}
      {securityOpen && user && <StaffSecurityDialog user={user} onUserChange={handleUserChange} onClose={() => setSecurityOpen(false)} t={t} />}
    </StaffShell>
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
  return <section className="patient-auth staff-login-card staff-password-change-card" aria-labelledby="staff-pw-change-title">
    <header className="patient-auth-heading">
      <div className="patient-auth-brand-mark staff-auth-brand-mark"><ShieldCheck size={22} aria-hidden="true" /></div>
      <h1 id="staff-pw-change-title">{t('passwordChangeRequired')}</h1>
      <p className="patient-auth-intro">{t('passwordChangeRequiredDescription')}</p>
    </header>
    {error && <div role="alert" className="patient-alert error">{error}</div>}
    <form onSubmit={submit} className="staff-login-form">
      <PasswordField label={t('currentPassword')} value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} autoComplete="current-password" required />
      <PasswordField label={t('newPassword')} value={newPassword} onChange={event => setNewPassword(event.target.value)} autoComplete="new-password" required minLength={10} maxLength={200} helperText={t('passwordRequirementsSummary')} />
      <PasswordField label={t('confirmNewPassword')} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password" required error={Boolean(confirmPassword && newPassword !== confirmPassword)} helperText={confirmPassword && newPassword !== confirmPassword ? t('passwordsDoNotMatch') : undefined} />
      <button type="submit" className="patient-button btn btn-primary staff-auth-submit-btn" disabled={saving}>{saving ? t('loading') : t('savePassword')}</button>
    </form>
  </section>;
}

/* ==========================================
   PATIENT PUBLIC BOOKING PORTAL
   ========================================== */
function LoginView({ onLogin, t, lang, productName, productDescriptor, showProductIdentity }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mfaChallenge, setMfaChallenge] = useState(null);
  const [mfaMethod, setMfaMethod] = useState('totp');
  const [errorMsg, setErrorMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submitInFlight = useRef(false);
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
    await withLoginSubmissionLock(submitInFlight, setSubmitting, async () => {
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
      }
    });
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
        {showProductIdentity && <p className="patient-auth-product-line">{productName}<span aria-hidden="true"> · </span>{productDescriptor}</p>}
        <div className="patient-auth-brand-mark staff-auth-brand-mark">
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

        <button type="submit" disabled={submitting} className="patient-button staff-auth-submit-btn">
          {submitting ? t('verifying') : mfaMethod === 'totp' ? t('verify') : t('verifyRecoveryCode')}
        </button>

        <button
          type="button"
          disabled={submitting}
          className="patient-button secondary staff-auth-secondary-btn"
          onClick={() => { clearMfaCode(); setErrorMsg(''); setMfaMethod(mfaMethod === 'totp' ? 'recovery' : 'totp'); }}
        >
          {mfaMethod === 'totp' ? <>{t('lostYourPhone')} {t('useRecoveryCode')}</> : t('useAuthenticatorInstead')}
        </button>

        <button
          type="button"
          disabled={submitting}
          className="patient-button secondary staff-auth-secondary-btn"
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
          className="patient-button staff-auth-submit-btn-login"
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
    <div className="staff-unknown-role">
      <h3>Unknown User Role. Contact administrator.</h3>
    </div>
  );
  return <Suspense fallback={<div className="portal-loading" role="status"><HeartPulse/><span>{t('loading')}</span></div>}>{dashboard}</Suspense>;
}

/* ==========================================
   1. ADMIN DASHBOARD
   ========================================== */
