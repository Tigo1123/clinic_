import React, { useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Check, Copy, KeyRound, ShieldCheck, X } from 'lucide-react';
import {
  confirmMfaEnrollment,
  disableMfa,
  regenerateMfaRecoveryCodes,
  startMfaEnrollment
} from '../services/staffMfa';
import MfaCodeInput from './MfaCodeInput';

function ProofFields({ currentPassword, setCurrentPassword, proofType, setProofType, proof, setProof, proofRef, t }) {
  return <>
    <div className="form-group">
      <label className="form-label" htmlFor="mfa-current-password">{t('currentPassword')}</label>
      <input id="mfa-current-password" className="form-input" type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
    </div>
    <fieldset className="security-proof-options">
      <legend>{t('mfaVerificationMethod')}</legend>
      <label><input type="radio" name="mfa-proof" value="totp" checked={proofType === 'totp'} onChange={() => { proofRef.current?.clear(); setProofType('totp'); setProof(''); }} /> {t('authenticatorCode')}</label>
      <label><input type="radio" name="mfa-proof" value="recovery" checked={proofType === 'recovery'} onChange={() => { proofRef.current?.clear(); setProofType('recovery'); setProof(''); }} /> {t('recoveryCode')}</label>
    </fieldset>
    <div className="form-group">
      <label className="form-label" htmlFor="mfa-proof">{proofType === 'totp' ? t('authenticatorCode') : t('recoveryCode')}</label>
      {proofType === 'totp'
        ? <MfaCodeInput ref={proofRef} id="mfa-proof" className="form-input" required />
        : <input id="mfa-proof" className="form-input" type="text" autoComplete="one-time-code" required value={proof} onChange={(event) => setProof(event.target.value.trim().slice(0, 30))} />}
    </div>
  </>;
}

export default function StaffSecurityDialog({ user, onUserChange, onClose, t }) {
  const [mode, setMode] = useState('overview');
  const [currentPassword, setCurrentPassword] = useState('');
  const [enrollment, setEnrollment] = useState(null);
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [proofType, setProofType] = useState('totp');
  const [proof, setProof] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const enrollmentCodeRef = useRef(null);
  const proofRef = useRef(null);

  const resetSensitive = (nextMode = 'overview') => {
    enrollmentCodeRef.current?.clear();
    proofRef.current?.clear();
    setCurrentPassword('');
    setEnrollment(null);
    setRecoveryCodes(null);
    setProof('');
    setProofType('totp');
    setAcknowledged(false);
    setCopied(false);
    setError('');
    setMode(nextMode);
  };

  const requestEnrollment = async (event) => {
    event.preventDefault();
    setPending(true); setError('');
    try {
      const result = await startMfaEnrollment(currentPassword);
      setCurrentPassword('');
      setEnrollment({ secret: result.secret, otpauthUri: result.otpauthUri, expiresAt: result.expiresAt });
      setMode('setup');
    } catch (requestError) {
      setError(requestError?.status ? t('mfaReauthFailed') : t('mfaServiceUnavailable'));
    } finally { setPending(false); }
  };

  const confirmEnrollment = async (event) => {
    event.preventDefault();
    const code = enrollmentCodeRef.current?.getValue() || '';
    if (code.length !== 6) {
      setError(t('mfaCodeIncomplete'));
      enrollmentCodeRef.current?.focus();
      return;
    }
    setPending(true); setError('');
    try {
      const result = await confirmMfaEnrollment(code);
      enrollmentCodeRef.current?.clear();
      setEnrollment(null);
      setRecoveryCodes(result.recoveryCodes);
      onUserChange({ ...user, mfaEnabled: true });
      setMode('recovery');
    } catch (requestError) {
      if (['MFA_ENROLLMENT_EXPIRED', 'MFA_ENROLLMENT_NOT_PENDING'].includes(requestError?.code)) {
        resetSensitive('overview');
        setError(t('mfaEnrollmentExpired'));
      } else setError(requestError?.code === 'MFA_CODE_INVALID' ? t('mfaCodeInvalid') : t('mfaServiceUnavailable'));
    } finally { setPending(false); }
  };

  const submitManagement = async (event) => {
    event.preventDefault();
    const submittedProof = proofType === 'totp' ? proofRef.current?.getValue() || '' : proof;
    if (proofType === 'totp' && submittedProof.length !== 6) {
      setError(t('mfaCodeIncomplete'));
      proofRef.current?.focus();
      return;
    }
    setPending(true); setError('');
    try {
      if (mode === 'disable') {
        await disableMfa(currentPassword, proofType, submittedProof);
        onUserChange({ ...user, mfaEnabled: false });
        resetSensitive('overview');
      } else {
        const result = await regenerateMfaRecoveryCodes(currentPassword, proofType, submittedProof);
        proofRef.current?.clear();
        setCurrentPassword(''); setProof('');
        setRecoveryCodes(result.recoveryCodes);
        setMode('recovery');
      }
    } catch (requestError) {
      setError(requestError?.status ? t('mfaReauthFailed') : t('mfaServiceUnavailable'));
    } finally { setPending(false); }
  };

  const copyRecoveryCodes = async () => {
    if (!recoveryCodes || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      setCopied(true);
    } catch {
      setError(t('copyCodesFailed'));
    }
  };

  return <div className="security-dialog-backdrop" role="presentation">
    <section className="security-dialog glass-panel" role="dialog" aria-modal="true" aria-labelledby="security-dialog-title">
      <button type="button" className="security-dialog-close" aria-label={t('close')} disabled={mode === 'recovery' && !acknowledged} onClick={onClose}><X size={20} /></button>
      <div className="security-dialog-heading">
        <span className="staff-mfa-icon"><ShieldCheck size={28} /></span>
        <div><h2 id="security-dialog-title">{t('securitySettings')}</h2><p>{t('mfaSettingsDescription')}</p></div>
      </div>
      {error && <div className="badge badge-danger staff-login-error" role="alert">{error}</div>}

      {mode === 'overview' && <div className="security-overview">
        <div className="security-status-card">
          <div><strong>{t('twoFactorAuthentication')}</strong><p>{user.mfaEnabled ? t('mfaEnabledDescription') : t('mfaDisabledDescription')}</p></div>
          <span className={`security-status ${user.mfaEnabled ? 'enabled' : 'disabled'}`}>{user.mfaEnabled ? t('enabled') : t('disabled')}</span>
        </div>
        {!user.mfaEnabled
          ? <button className="btn btn-primary" type="button" onClick={() => setMode('enroll')}>{t('enableMfa')}</button>
          : <div className="security-actions"><button className="btn btn-secondary" type="button" onClick={() => setMode('regenerate')}>{t('regenerateRecoveryCodes')}</button><button className="btn btn-danger" type="button" onClick={() => setMode('disable')}>{t('disableMfa')}</button></div>}
      </div>}

      {mode === 'enroll' && <form className="staff-login-form" onSubmit={requestEnrollment}>
        <p className="staff-login-description">{t('mfaPasswordPrompt')}</p>
        <div className="form-group"><label className="form-label" htmlFor="mfa-enroll-password">{t('currentPassword')}</label><input id="mfa-enroll-password" className="form-input" type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></div>
        <button className="btn btn-primary" disabled={pending} type="submit">{pending ? t('loading') : t('continue')}</button>
        <button className="btn btn-secondary" disabled={pending} type="button" onClick={() => resetSensitive()}>{t('cancel')}</button>
      </form>}

      {mode === 'setup' && enrollment && <form className="staff-login-form" onSubmit={confirmEnrollment}>
        <div className="security-pending"><KeyRound size={18} /> {t('enrollmentPending')}</div>
        <p className="staff-login-description">{t('mfaScanInstructions')}</p>
        <div className="security-qr" aria-label={t('mfaQrCode')}><QRCodeSVG value={enrollment.otpauthUri} size={190} level="M" /></div>
        <details className="security-manual"><summary>{t('manualSetup')}</summary><p>{t('manualSetupInstructions')}</p><code dir="ltr">{enrollment.secret}</code></details>
        <div className="form-group"><label className="form-label" htmlFor="mfa-enrollment-code">{t('authenticatorCode')}</label><MfaCodeInput ref={enrollmentCodeRef} id="mfa-enrollment-code" className="form-input staff-mfa-code" required /></div>
        <button className="btn btn-primary" disabled={pending} type="submit">{pending ? t('verifying') : t('confirmAndEnable')}</button>
        <button className="btn btn-secondary" disabled={pending} type="button" onClick={() => resetSensitive()}>{t('cancel')}</button>
      </form>}

      {mode === 'recovery' && recoveryCodes && <div className="staff-login-form">
        <div className="security-success"><Check size={20} /> {t('recoveryCodesReady')}</div>
        <p className="staff-login-description">{t('recoveryCodesWarning')}</p>
        <div className="recovery-code-grid" aria-label={t('recoveryCodes')}>{recoveryCodes.map((item) => <code key={item}>{item}</code>)}</div>
        <button className="btn btn-secondary" type="button" onClick={copyRecoveryCodes}><Copy size={16} /> {copied ? t('copied') : t('copyCodes')}</button>
        <label className="security-ack"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /> {t('recoveryCodesAcknowledgement')}</label>
        <button className="btn btn-primary" disabled={!acknowledged} type="button" onClick={() => resetSensitive()}>{t('finish')}</button>
      </div>}

      {(mode === 'disable' || mode === 'regenerate') && <form className="staff-login-form" onSubmit={submitManagement}>
        <p className="staff-login-description">{mode === 'disable' ? t('disableMfaWarning') : t('regenerateRecoveryWarning')}</p>
        <ProofFields {...{ currentPassword, setCurrentPassword, proofType, setProofType, proof, setProof, proofRef, t }} />
        <button className={`btn ${mode === 'disable' ? 'btn-danger' : 'btn-primary'}`} disabled={pending} type="submit">{pending ? t('loading') : mode === 'disable' ? t('disableMfa') : t('regenerateRecoveryCodes')}</button>
        <button className="btn btn-secondary" disabled={pending} type="button" onClick={() => resetSensitive()}>{t('cancel')}</button>
      </form>}
    </section>
  </div>;
}
