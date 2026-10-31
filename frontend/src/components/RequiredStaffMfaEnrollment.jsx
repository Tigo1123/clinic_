import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Check, ShieldCheck } from 'lucide-react';
import MfaCodeInput from './MfaCodeInput.js';
import { confirmRequiredMfaEnrollment, startRequiredMfaEnrollment } from '../services/staffLogin.js';
import ShifaLogo from './brand/ShifaLogo.jsx';

export default function RequiredStaffMfaEnrollment({ token, t, onDone }) {
  const [enrollment, setEnrollment] = useState(null);
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    startRequiredMfaEnrollment(token)
      .then((result) => { if (active) setEnrollment(result); })
      .catch(() => { if (active) setError(t('mfaServiceUnavailable')); })
      .finally(() => { if (active) setPending(false); });
    return () => { active = false; };
  }, [token, t]);

  const submit = async (event) => {
    event.preventDefault();
    const field = event.currentTarget.elements.namedItem('required-mfa-code');
    const code = field?.value || '';
    if (!/^\d{6}$/.test(code)) {
      setError(t('mfaCodeIncomplete'));
      field?.focus();
      return;
    }
    setPending(true);
    setError('');
    try {
      const result = await confirmRequiredMfaEnrollment(token, code);
      setRecoveryCodes(result.recoveryCodes);
      setEnrollment(null);
    } catch (requestError) {
      setError(requestError?.code === 'MFA_CODE_INVALID' ? t('mfaCodeInvalid') : t('mfaEnrollmentExpired'));
    } finally {
      setPending(false);
    }
  };

  return <section className="patient-auth" aria-labelledby="required-staff-mfa-title">
    <ShifaLogo className="auth-form-shifa-logo" />
    <header className="patient-auth-heading">
      <div className="patient-auth-brand-mark" style={{ marginBottom: 12, width: 40, height: 40 }}><ShieldCheck size={22} aria-hidden="true" /></div>
      <h1 id="required-staff-mfa-title">{t('staffMfaRequiredTitle')}</h1>
      <p className="patient-auth-intro">{recoveryCodes ? t('recoveryCodesWarning') : t('mfaScanInstructions')}</p>
    </header>

    {error && <div role="alert" className="patient-alert error">{error}</div>}
    {pending && !enrollment && !recoveryCodes && <p role="status">{t('loading')}</p>}

    {enrollment && !recoveryCodes && <form className="staff-login-form" onSubmit={submit}>
      <div style={{ display: 'grid', justifyItems: 'center', gap: 12 }}>
        <QRCodeSVG value={enrollment.otpauthUri} size={196} level="M" aria-label={t('mfaQrCode')} />
        <p>{t('manualSetupInstructions')}</p>
        <code dir="ltr" style={{ overflowWrap: 'anywhere', userSelect: 'all' }}>{enrollment.secret}</code>
      </div>
      <label className="patient-field" htmlFor="required-mfa-code">{t('authenticatorCode')}
        <MfaCodeInput id="required-mfa-code" name="required-mfa-code" required autoComplete="one-time-code" />
      </label>
      <button type="submit" className="patient-button" disabled={pending}>{pending ? t('verifying') : t('confirmAndEnable')}</button>
    </form>}

    {recoveryCodes && <div className="staff-login-form">
      <div className="security-success"><Check size={20} aria-hidden="true" /> {t('recoveryCodesReady')}</div>
      <div className="recovery-code-grid" aria-label={t('recoveryCodes')}>
        {recoveryCodes.map((code) => <code key={code}>{code}</code>)}
      </div>
      <label className="security-ack"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /> {t('recoveryCodesAcknowledgement')}</label>
      <button type="button" className="patient-button" disabled={!acknowledged} onClick={onDone}>{t('finish')}</button>
    </div>}

    {!recoveryCodes && <button type="button" className="patient-button secondary" disabled={pending} onClick={onDone}>{t('backToLogin')}</button>}
  </section>;
}
