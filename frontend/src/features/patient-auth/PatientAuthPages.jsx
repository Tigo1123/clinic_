import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { Check, Eye, EyeOff, HeartPulse } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { patientApiRequest, publicApiRequest as apiRequest } from '../../services/apiClient';
import { useAuth } from '../../app/auth/auth-context';
import { INITIAL_ONBOARDING_FORM, NAME_FIELDS, ONBOARDING_STEPS, googleRegistrationPayload, onboardingErrorMessage, passwordChecks, registrationPayload, RESEND_COOLDOWN_SECONDS, resendSecondsRemaining, validateOnboardingStep } from './onboarding';
import { callingCode, countryFlag, countryName, normalisePatientPhone, PATIENT_PHONE_COUNTRIES, splitInternationalPhone } from './phoneCountries';
import { SUDANESE_STATES } from '../reception/clinicData';
import consultationIllustration from '../../assets/alshifa-consultation.svg';
import doctor3dScene from '../../assets/alshifa-doctor-patient-3d.webp';
import register3dScene from '../../assets/alshifa-register-3d.webp';
import './patientAuth.css';
import { GoogleIdentityButton } from './GoogleIdentityButton.jsx';
import { clearGoogleOnboardingToken, getGoogleOnboardingToken } from './googleOnboardingStorage.js';
import { useGooglePatientAuth } from './useGooglePatientAuth.js';
import ThemeToggle from '../../components/ui/ThemeToggle.jsx';

export function PatientLogin(){
  const{t}=useTranslation();
  const{login}=useAuth();
  const navigate=useNavigate();
  const location=useLocation();
  const handleGoogleAuthenticated = useCallback((data) => { login(data.user, data.token); navigate('/patient'); }, [login, navigate]);
  const handleGoogleOnboarding = useCallback(() => navigate('/register', { state: { googleOnboarding: true } }), [navigate]);
  const googleAuth = useGooglePatientAuth({ onAuthenticated: handleGoogleAuthenticated, onOnboarding: handleGoogleOnboarding });

  const[form,setForm]=useState({username:'',password:''});
  const[error,setError]=useState('');
  const[loading,setLoading]=useState(false);
  const[showPassword,setShowPassword]=useState(false);
  const[pendingVerification,setPendingVerification]=useState(false);
  const[challenge,setChallenge]=useState(null);
  const[code,setCode]=useState('');
  const[message,setMessage]=useState('');

  async function submit(event){
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');
    setPendingVerification(false);

    try{
      const data=await apiRequest('/api/auth/login',{
        method:'POST',
        body:JSON.stringify(form)
      });

      if(data.user.role!=='PATIENT'){
        throw new Error(t('patientAccountRequired'));
      }

      login(data.user,data.token);
      navigate('/patient');
    }catch(requestError){
      if(requestError.code==='ACCOUNT_PENDING_VERIFICATION'){
        setPendingVerification(true);
        setError(t('pendingVerificationMessage'));
      }else{
        setError(requestError.message);
      }
    }finally{
      setLoading(false);
    }
  }

  async function resendVerification(){
    setLoading(true);
    setError('');
    setMessage('');

    try{
      const data=await apiRequest(
        '/api/patient-auth/verification/resend-by-identity',
        {
          method:'POST',
          body:JSON.stringify({
            identity:form.username,
            password:form.password
          })
        }
      );

      setChallenge(data);
      setCode('');
      setMessage(t('verificationResent'));
    }catch(requestError){
      setError(requestError.code === 'VERIFICATION_UNAVAILABLE' ? t('onlineVerificationUnavailable') : requestError.message);
    }finally{
      setLoading(false);
    }
  }

  async function verify(event){
    event.preventDefault();
    setLoading(true);
    setError('');

    try{
      const data = await apiRequest('/api/patient-auth/verify',{
        method:'POST',
        body:JSON.stringify({
          challengeId:challenge.challengeId,
          code
        })
      });

      let verificationMessage = t('verificationSuccessLogin');

      if(data.state === 'CLAIMED'){
        verificationMessage = t('accountLinked');
      }else if(
        data.state === 'MANUAL_REVIEW_REQUIRED' ||
        data.state === 'AMBIGUOUS_MATCH'
      ){
        verificationMessage = t('manualReviewRequired');
      }

      setPendingVerification(false);
      setChallenge(null);
      setCode('');
      setMessage(verificationMessage);
    }catch(requestError){
      setError(requestError.message);
    }finally{
      setLoading(false);
    }
  }

  if(challenge){
    return (
      <AuthShell title={t('patientLogin')}>
        <form onSubmit={verify}>
          <p>{t('enterVerificationCode')}</p>

          {message&&
            <div className="patient-alert success">
              {message}
            </div>
          }

          <Field
            label={t('verificationCode')}
            value={code}
            onChange={setCode}
          />

          {error&&<Alert>{error}</Alert>}

          <button
            className="patient-button"
            style={{width:'100%'}}
            disabled={loading}
          >
            {loading?t('loading'):t('verify')}
          </button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t('patientLogin')}>
      {location.state?.message&&
        <div className="patient-alert success">
          {location.state.message}
        </div>
      }

      {message&&
        <div className="patient-alert success">
          {message}
        </div>
      }

      <form onSubmit={submit}>
        <Field
          label={t('phoneOrEmail')}
          value={form.username}
          onChange={username=>setForm({...form,username})}
          autoComplete="username"
          className="patient-auth-identifier"
          dir="ltr"
        />

        <label className="patient-field">
          {t('password')}
          <span className="patient-field__password-wrap">
            <input
              className="patient-field__password-input"
              type={showPassword?'text':'password'}
              value={form.password}
              onChange={event=>setForm({...form,password:event.target.value})}
              autoComplete="current-password"
              required
            />

            <button
              type="button"
              aria-label={showPassword?t('hidePassword'):t('showPassword')}
              onClick={()=>setShowPassword(!showPassword)}
              className="patient-field__password-toggle"
            >
              {showPassword?<EyeOff size={19}/>:<Eye size={19}/>}
            </button>
          </span>
        </label>

        <Link className="patient-auth-forgot" to="/forgot-password">
          {t('forgotPassword')}
        </Link>

        {error&&<Alert>{error}</Alert>}

        {pendingVerification&&
          <button
            type="button"
            className="patient-button"
            style={{width:'100%',marginBottom:'.75rem'}}
            disabled={loading}
            onClick={resendVerification}
          >
            {t('resendVerification')}
          </button>
        }

        <button
          className="patient-button"
          style={{width:'100%'}}
          disabled={loading}
        >
          {loading?t('loading'):t('login')}
        </button>

        <div className="patient-auth-divider" role="separator"><span>{t('authOr')}</span></div>

        {googleAuth.errorCode&&<Alert>{t(googleErrorMessageKey(googleAuth.errorCode))}</Alert>}
        <GoogleIdentityButton onCredential={googleAuth.handleCredential} loading={googleAuth.loading} />

        <div className="patient-auth-create-account">
          <p>{t('dontHaveAccount')}</p>
          <Link className="patient-auth-secondary-button" to="/register">
            {t('createAccountAction')}
          </Link>
        </div>

      </form>

    </AuthShell>
  );
}


export function PatientForgotPassword(){
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [step, setStep] = useState('request');
  const [email, setEmail] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [developmentCode, setDevelopmentCode] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const passwordChecks = [
    ['length', newPassword.length >= 10, t('passwordMin')],
    ['upper', /[A-Z]/.test(newPassword), t('passwordUpper')],
    ['lower', /[a-z]/.test(newPassword), t('passwordLower')],
    ['number', /\d/.test(newPassword), t('passwordNumber')]
  ];

  const passwordValid = passwordChecks.every(([, valid]) => valid);

  async function requestReset(event){
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    try{
      const data = await apiRequest('/api/patient-auth/forgot-password',{
        method:'POST',
        body:JSON.stringify({ email })
      });

      setMessage(
        data.message ||
        t('passwordResetCodeSent')
      );

      if(data.challengeId){
        setChallengeId(data.challengeId);
        setDevelopmentCode(data.developmentCode || '');
        setStep('reset');
      }
    }catch(requestError){
      setError(requestError.code === 'VERIFICATION_UNAVAILABLE' ? t('onlineVerificationUnavailable') : requestError.message);
    }finally{
      setLoading(false);
    }
  }

  async function resetPassword(event){
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    if (!passwordValid) {
      setError(t('passwordRequirementsMissing'));
      setLoading(false);
      return;
    }

    if(newPassword !== confirmPassword){
      setError(t('passwordMismatch'));
      setLoading(false);
      return;
    }

    try{
      await apiRequest('/api/patient-auth/reset-password',{
        method:'POST',
        body:JSON.stringify({
          challengeId,
          code,
          newPassword
        })
      });

      navigate('/patient-login',{
        state:{
          message:t('passwordResetSuccess')
        }
      });
    }catch(requestError){
      setError(requestError.message);
    }finally{
      setLoading(false);
    }
  }

  return (
    <AuthShell title={t('forgotPassword')}>
      {step === 'request' ? (
        <form onSubmit={requestReset}>
          <p>{t('forgotPasswordInstructions')}</p>

          <Field
            label={t('emailOptional')}
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="email"
          />

          {error && <Alert>{error}</Alert>}

          {message && (
            <div className="patient-alert success">
              {message}
            </div>
          )}

          <button
            className="patient-button"
            style={{width:'100%'}}
            disabled={loading}
          >
            {loading ? t('loading') : t('sendResetCode')}
          </button>

          <div style={{marginTop:'1rem',textAlign:'center'}}>
            <Link to="/patient-login">
              {t('backToLogin')}
            </Link>
          </div>
        </form>
      ) : (
        <form onSubmit={resetPassword}>
          <p>{t('resetPasswordInstructions')}</p>

          {developmentCode && (
            <div className="patient-alert success">
              {t('developmentCode')}: {developmentCode}
            </div>
          )}

          <Field
            label={t('verificationCode')}
            value={code}
            onChange={setCode}
            autoComplete="one-time-code"
          />

          <label className="patient-field">
            {t('newPassword')}
            <span style={{position:'relative'}}>
              <input
                style={{width:'100%',paddingInlineEnd:'3rem'}}
                type={showPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={event=>setNewPassword(event.target.value)}
                autoComplete="new-password"
                required
              />

              <button
                type="button"
                aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                onClick={()=>setShowPassword(!showPassword)}
                style={{
                  position:'absolute',
                  insetInlineEnd:'.45rem',
                  top:'.35rem',
                  background:'transparent',
                  border:0,
                  cursor:'pointer'
                }}
              >
                {showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}
              </button>
            </span>
          </label>

          <div className="password-requirements">
            {passwordChecks.map(([key, valid, label]) => (
              <span
                className={valid ? 'valid' : ''}
                key={key}
              >
                <Check size={14} />
                {label}
              </span>
            ))}
          </div>

          <Field
            label={t('confirmPassword')}
            type="password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
          />

          {error && <Alert>{error}</Alert>}

          <button
            className="patient-button"
            style={{width:'100%'}}
            disabled={
              loading ||
              !passwordValid ||
              newPassword !== confirmPassword ||
              code.length !== 6
            }
          >
            {loading ? t('loading') : t('resetPassword')}
          </button>
        </form>
      )}
    </AuthShell>
  );
}

export function PatientRegister() {
  const { t, i18n } = useTranslation(); const navigate = useNavigate(); const location = useLocation();
  const { login } = useAuth();
  const [form, setForm] = useState(INITIAL_ONBOARDING_FORM); const [step, setStep] = useState(0);
  const [stepDirection, setStepDirection] = useState('forward');
  const [stepLeaving, setStepLeaving] = useState(false);
  const stepTimer = useRef(null);
  const [challenge, setChallenge] = useState(null); const [code, setCode] = useState(''); const [identity, setIdentity] = useState(null);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [fieldErrors, setFieldErrors] = useState({}); const [loading, setLoading] = useState(false); const [resending, setResending] = useState(false); const [verified, setVerified] = useState(false); const [googleReviewState, setGoogleReviewState] = useState(''); const [googleExpired, setGoogleExpired] = useState(false); const [resendAvailableAt, setResendAvailableAt] = useState(0); const [now, setNow] = useState(Date.now());
  const googleOnboardingToken = getGoogleOnboardingToken();
  const googleOnboarding = Boolean(googleOnboardingToken || location.state?.googleOnboarding || googleExpired);
  const handleGoogleAuthenticated = useCallback((data) => { login(data.user, data.token); navigate('/patient'); }, [login, navigate]);
  const handleGoogleOnboarding = useCallback(() => navigate('/register', { replace: true, state: { googleOnboarding: true } }), [navigate]);
  const googleAuth = useGooglePatientAuth({ onAuthenticated: handleGoogleAuthenticated, onOnboarding: handleGoogleOnboarding });
  const messages = { required:t('requiredField'), nameInvalid:t('onboardingNameInvalid'), dateInvalid:t('onboardingDobInvalid'), phoneInvalid:t('phoneInvalid'), emailInvalid:t('emailInvalid'), passwordInvalid:t('passwordRequirementsMissing'), passwordMismatch:t('passwordMismatch'), rateLimited:t('onboardingRateLimited'), addressStateInvalid:t('onboardingAddressStateInvalid'), emailDuplicate:t('onboardingEmailDuplicate'), phoneDuplicate:t('onboardingPhoneDuplicate'), manualReview:t('manualReviewRequired'), verificationFailed:t('onboardingVerificationFailed'), requestFailed:t('onboardingRequestFailed') };
  const resendRemaining = resendSecondsRemaining(resendAvailableAt, now);
  useEffect(() => {
    if (!challenge || resendRemaining === 0) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [challenge, resendRemaining]);
  const update = (field, value) => { setForm(current => ({ ...current, [field]: value })); setFieldErrors(current => ({ ...current, [field]: undefined })); setError(''); };
  const updatePhone = (value) => { const nextPhone = splitInternationalPhone(value, form.phoneCountry); setForm(current => ({ ...current, phoneCountry: nextPhone.country, phone: nextPhone.phone })); setFieldErrors(current => ({ ...current, phone: undefined })); setError(''); };
  useEffect(() => () => window.clearTimeout(stepTimer.current), []);
  const goToStep = (target) => {
    if (target === step || stepLeaving) return;
    setStepDirection(target > step ? 'forward' : 'back');
    setStepLeaving(true);
    window.clearTimeout(stepTimer.current);
    stepTimer.current = window.setTimeout(() => { setStep(target); setStepLeaving(false); }, 105);
  };
  const next = () => { const errors = validateOnboardingStep(form, step, messages, undefined, { requireEmail: !googleOnboarding }); setFieldErrors(errors); if (!Object.keys(errors).length) goToStep(step + 1); };
  async function submit(event) {
    event.preventDefault(); if (loading) return;
    const errors = validateOnboardingStep(form, 5, messages, undefined, { requireEmail: !googleOnboarding });
    if (Object.keys(errors).length) { setFieldErrors(errors); goToStep(5); return; }
    setLoading(true); setError('');
    try {
      if (googleOnboarding) {
        const token = getGoogleOnboardingToken();
        if (!token) { setGoogleExpired(true); setError(t('googleOnboardingExpired')); return; }
        const data = await apiRequest('/api/patient-auth/google/complete', { method:'POST', body:JSON.stringify(googleRegistrationPayload(form, token)) });
        if (data?.status === 'AUTHENTICATED' && typeof data.token === 'string' && data.token && data.user?.role === 'PATIENT') {
          clearGoogleOnboardingToken(); login(data.user, data.token); navigate('/patient'); return;
        }
        if (data?.state === 'MANUAL_REVIEW_REQUIRED' || data?.state === 'AMBIGUOUS_MATCH') {
          clearGoogleOnboardingToken(); setGoogleReviewState(data.state); return;
        }
        throw new Error('GOOGLE_COMPLETION_UNEXPECTED_RESPONSE');
      }
      const data = await apiRequest('/api/patient-auth/register', { method:'POST', body:JSON.stringify(registrationPayload(form)) });
      setChallenge(data); setIdentity(data.identity || null); setNow(Date.now()); setResendAvailableAt(Date.now() + RESEND_COOLDOWN_SECONDS * 1000);
    } catch (requestError) {
      if (googleOnboarding && requestError?.code === 'GOOGLE_ONBOARDING_INVALID') { clearGoogleOnboardingToken(); setGoogleExpired(true); setError(t('googleOnboardingExpired')); }
      else setError(onboardingErrorMessage(requestError, messages));
    } finally { setLoading(false); }
  }
  async function verify(event) { event.preventDefault(); if (loading) return; setLoading(true); setError(''); try { const data = await apiRequest('/api/patient-auth/verify', { method:'POST', body:JSON.stringify({ challengeId:challenge.challengeId, code }) }); if (data.state === 'CLAIMED' || data.state === 'VERIFIED') { setIdentity(data.patient || identity); setVerified(true); } else setError(messages.manualReview); } catch (requestError) { setError(onboardingErrorMessage(requestError, messages)); } finally { setLoading(false); } }
  async function resendVerification() { if (resending || resendRemaining > 0 || !challenge) return; setResending(true); setError(''); setNotice(''); try { const data = await apiRequest('/api/patient-auth/verification/resend', { method:'POST', body:JSON.stringify({ challengeId:challenge.challengeId }) }); setChallenge(data); setCode(''); setNow(Date.now()); setResendAvailableAt(Date.now() + RESEND_COOLDOWN_SECONDS * 1000); setNotice(t('onboardingResendSuccess')); } catch (requestError) { setError(onboardingErrorMessage(requestError, messages)); } finally { setResending(false); } }
  async function continueToDashboard() { if (loading) return; setLoading(true); setError(''); try { const data = await apiRequest('/api/auth/login', { method:'POST', body:JSON.stringify({ username:form.email, password:form.password }) }); if (data.user?.role !== 'PATIENT') throw new Error(); login(data.user, data.token); navigate('/patient'); } catch { setError(t('onboardingContinueFailed')); } finally { setLoading(false); } }
  const title = (key) => t(`onboarding${key[0].toUpperCase()}${key.slice(1)}`);
  const reviewPhone = normalisePatientPhone(form.phone, form.phoneCountry) || form.phone;
  if (googleReviewState) return <AuthShell title={t('createPatientAccount')} onboarding><section className="onboarding-success" aria-live="polite"><h2>{t('googleManualReviewTitle')}</h2><p>{t(googleReviewState === 'AMBIGUOUS_MATCH' ? 'googleAmbiguousReview' : 'googleManualReview')}</p><button className="patient-button" onClick={() => navigate('/patient-login')}>{t('signIn')}</button></section></AuthShell>;
  if (verified) return <AuthShell title={t('onboardingSuccessTitle')} onboarding><section className="onboarding-success" aria-live="polite"><Check size={44}/><p>{t('onboardingSuccessText')}</p><strong>{identity?.fullNameAr || identity?.fullNameEn}</strong>{identity?.fileNumber && <p className="onboarding-mrn">{t('onboardingMrn')}: {identity.fileNumber}</p>}{error&&<Alert>{error}</Alert>}<button className="patient-button" disabled={loading} onClick={continueToDashboard}>{loading?t('loading'):t('onboardingContinueDashboard')}</button></section></AuthShell>;
  if (challenge) return <AuthShell title={t('verificationCode')} onboarding><form className="onboarding-verification" onSubmit={verify} aria-live="polite"><p className="onboarding-caption">{t('onboardingVerificationIntro')}</p>{challenge.developmentCode && <div className="patient-alert success">{t('developmentCode')}: <strong>{challenge.developmentCode}</strong></div>}<Field label={t('verificationCode')} value={code} onChange={setCode} autoComplete="one-time-code" inputMode="numeric" maxLength={6} dir="ltr"/>{notice&&<div className="patient-alert success" role="status">{notice}</div>}{error&&<Alert>{error}</Alert>}<button className="patient-button" style={{width:'100%'}} disabled={loading || resending}>{loading?t('loading'):t('verify')}</button><section className="onboarding-resend" aria-live="polite"><p>{t('onboardingResendPrompt')}</p><button type="button" className="onboarding-resend-button" disabled={resending || loading || resendRemaining > 0} onClick={resendVerification}>{resending ? t('loading') : resendRemaining > 0 ? t('onboardingResendAvailableIn', { seconds:resendRemaining }) : t('onboardingResendAction')}</button></section></form></AuthShell>;
  const nameFields = step === 0 ? NAME_FIELDS.slice(0, 4) : NAME_FIELDS.slice(4);
  return <AuthShell title={t('createPatientAccount')} onboarding><form className="onboarding-form" onSubmit={submit}>
    <div className="onboarding-progress-meta" aria-live="polite">{t('onboardingStepOf', { current:step + 1, total:ONBOARDING_STEPS.length })}</div>
    <ol className="onboarding-progress" aria-label={t('onboardingProgress')}>
      {ONBOARDING_STEPS.map((key, index) => <li key={key} className={index === step ? 'active' : index < step ? 'complete' : ''}>
        <button type="button" disabled={index > step || stepLeaving} onClick={() => goToStep(index)} aria-label={`${t('onboardingStepOf', { current:index + 1, total:ONBOARDING_STEPS.length })}: ${title(key)}`} aria-current={index === step ? 'step' : undefined}><span aria-hidden="true" /></button>
      </li>)}
    </ol>
    <div key={step} className={`onboarding-step-panel${stepLeaving ? ' is-leaving' : ''}`} data-direction={stepDirection}>
      <h2>{title(ONBOARDING_STEPS[step])}</h2>
      <p className="onboarding-caption">{t(`onboarding${ONBOARDING_STEPS[step][0].toUpperCase()}${ONBOARDING_STEPS[step].slice(1)}Help`)}</p>
  {step < 2 && <div className="onboarding-grid">{nameFields.map(field => <Field key={field} label={t(`onboarding${field[0].toUpperCase()}${field.slice(1)}`)} value={form[field]} onChange={value => update(field, value)} error={fieldErrors[field]} autoComplete="name" dir={step === 0 ? 'rtl' : 'ltr'}/>)}</div>}
  {step === 2 && <div className="onboarding-grid"><Field label={t('dateOfBirth')} type="date" value={form.dateOfBirth} onChange={value => update('dateOfBirth', value)} error={fieldErrors.dateOfBirth}/><label className="patient-field">{t('gender')}<select value={form.gender} onChange={event => update('gender', event.target.value)}><option value="">{t('onboardingSelectGender')}</option><option value="MALE">{t('male')}</option><option value="FEMALE">{t('female')}</option></select></label>{fieldErrors.gender&&<span className="field-error">{fieldErrors.gender}</span>}</div>}
  {step === 3 && <div className="onboarding-grid onboarding-contact-grid"><div className="onboarding-contact-phone"><label className="patient-field">{t('phone')}<div className="patient-phone-control"><select value={form.phoneCountry} onChange={event => update('phoneCountry', event.target.value)} aria-label={t('selectCountry')} dir={i18n.language === 'ar' ? 'rtl' : 'ltr'}>{PATIENT_PHONE_COUNTRIES.map(country => <option key={country} value={country}>{countryFlag(country)} {countryName(country, i18n.language)} ({callingCode(country)})</option>)}</select><input type="tel" inputMode="tel" dir="ltr" value={form.phone} onChange={event => updatePhone(event.target.value)} placeholder={t('phoneExample')} autoComplete="tel-national" required aria-invalid={Boolean(fieldErrors.phone)}/></div></label>{fieldErrors.phone&&<span className="field-error">{fieldErrors.phone}</span>}</div>{!googleOnboarding && <Field label={t('email')} type="email" value={form.email} onChange={value => update('email', value)} error={fieldErrors.email} autoComplete="email"/>}</div>}
  {step === 4 && <><label className="patient-field">{t('addressState')}<select value={form.addressStateId} onChange={event => update('addressStateId', event.target.value)}>{SUDANESE_STATES.map(state => <option key={state.id} value={state.id}>{i18n.language === 'ar' ? state.labelAr : state.labelEn}</option>)}</select></label><p className="onboarding-note">{t('onboardingContactAfterActivation')}</p></>}
  {step === 5 && <div dir="ltr"><Field label={t('password')} type="password" value={form.password} onChange={value => update('password', value)} error={fieldErrors.password} autoComplete="new-password"/><div className="password-requirements">{Object.entries(passwordChecks(form.password)).map(([key, valid]) => <span className={valid?'valid':''} key={key}><Check size={14}/>{t(`password${key[0].toUpperCase()}${key.slice(1)}`)}</span>)}</div><Field label={t('confirmPassword')} type="password" value={form.confirmPassword} onChange={value => update('confirmPassword', value)} error={fieldErrors.confirmPassword} autoComplete="new-password"/></div>}
  {step === 6 && <div className="onboarding-review"><p>{form.firstNameAr} {form.fatherNameAr} {form.grandfatherNameAr} {form.familyNameAr}</p><p dir="ltr">{form.firstNameEn} {form.fatherNameEn} {form.grandfatherNameEn} {form.familyNameEn}</p><p>{form.dateOfBirth} · {form.gender === 'MALE' ? t('male') : t('female')}</p><p dir="ltr">{reviewPhone}{!googleOnboarding && ` · ${form.email}`}</p><p>{t('addressState')}: {(SUDANESE_STATES.find(state => String(state.id) === form.addressStateId)?.[i18n.language === 'ar' ? 'labelAr' : 'labelEn'])}</p><p className="onboarding-note">{t('onboardingPasswordHidden')}</p></div>}
    </div>
  {error&&<Alert>{error}</Alert>}<div className="onboarding-actions">{step > 0 && <button type="button" className="patient-button secondary" onClick={() => goToStep(step - 1)} disabled={loading}>{t('onboardingBack')}</button>}{step < 6 ? <button type="button" className="patient-button" onClick={next}>{t('onboardingNext')}</button> : <button className="patient-button" disabled={loading}>{loading?t('loading'):t('createAccount')}</button>}</div>{step === 0 && !googleOnboarding && <section className="patient-auth-google-entry"><div className="patient-auth-divider" role="separator"><span>{t('authOr')}</span></div><GoogleIdentityButton onCredential={googleAuth.handleCredential} loading={googleAuth.loading}/>{googleAuth.errorCode&&<Alert>{t(googleErrorMessageKey(googleAuth.errorCode))}</Alert>}</section>}<section className="patient-auth-registration-nav"><div className="patient-auth-divider" role="separator"><span>{t('authOr')}</span></div><p>{t('alreadyHaveAccount')}</p><Link className="patient-auth-secondary-button" to="/patient-login">{t('signIn')}</Link></section></form></AuthShell>;
}

export function PatientClaim() {
  const { i18n } = useTranslation();
  const { user, updateUser, logout } = useAuth();
  const navigate = useNavigate();

  const lang = i18n.language === 'ar' ? 'ar' : 'en';

  const [form, setForm] = useState({
    code: '',
    dateOfBirth: ''
  });

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  if (user?.patientLinked === true) {
    return <Navigate to="/patient" replace />;
  }

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value
    }));

    setError('');
    setMessage('');
  }

  async function submit(event) {
    event.preventDefault();

    if (loading) return;

    setLoading(true);
    setError('');
    setMessage('');

    try {
      const data = await patientApiRequest('/api/patient-auth/claim', {
        method: 'POST',
        body: JSON.stringify({
          code: form.code.trim(),
          dateOfBirth: form.dateOfBirth
        })
      });

      if (data.state === 'CLAIMED') {
        updateUser({
          patientLinked: true,
          ...(data.patientId
            ? { patientId: data.patientId }
            : {})
        });

        navigate('/patient', {
          replace: true
        });

        return;
      }

      if (data.state === 'AMBIGUOUS_MATCH') {
        setError(
          lang === 'ar'
            ? 'وجد النظام أكثر من ملف طبي مطابق لبياناتك. لا يمكن اختيار ملف تلقائيًا. يرجى التواصل مع موظف الاستقبال للتحقق من هويتك وربط الملف الصحيح.'
            : 'More than one medical record matches your identity. Please contact reception so the correct record can be verified and linked.'
        );

        return;
      }

      if (data.state === 'MANUAL_REVIEW_REQUIRED') {
        setError(
          lang === 'ar'
            ? 'تعذر ربط الحساب بالملف الطبي تلقائيًا. يرجى مراجعة موظف الاستقبال للحصول على رمز ربط جديد أو للتحقق من بيانات الملف.'
            : 'Your account could not be linked automatically. Please contact reception to verify your record or obtain a new claim code.'
        );

        return;
      }

      setError(
        lang === 'ar'
          ? 'لم يتمكن النظام من إكمال عملية ربط الملف الطبي.'
          : 'The system could not complete medical-record linking.'
      );
    } catch (requestError) {
      const code =
        requestError?.code ||
        requestError?.error?.code;

      if (code === 'PATIENT_ALREADY_LINKED') {
        updateUser({
          patientLinked: true
        });

        navigate('/patient', {
          replace: true
        });

        return;
      }

      if (code === 'PATIENT_ALREADY_CLAIMED') {
        setError(
          lang === 'ar'
            ? 'هذا الملف الطبي مرتبط بالفعل بحساب آخر. يرجى التواصل مع موظف الاستقبال إذا كنت تعتقد أن هذا غير صحيح.'
            : 'This medical record is already linked to another account. Please contact reception if you believe this is incorrect.'
        );

        return;
      }

      if (code === 'CLAIM_VERIFICATION_FAILED') {
        setError(
          lang === 'ar'
            ? 'رمز الربط غير صحيح أو منتهي الصلاحية. تحقق من الرمز وتاريخ الميلاد أو اطلب رمزًا جديدًا من موظف الاستقبال.'
            : 'The claim code is incorrect or expired. Check the code and date of birth, or request a new code from reception.'
        );

        return;
      }

      setError(
        requestError?.message ||
          (lang === 'ar'
            ? 'حدث خطأ أثناء محاولة ربط الملف الطبي.'
            : 'An error occurred while linking your medical record.')
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await logout();

    navigate('/patient-login', {
      replace: true
    });
  }

  if (!user) return <OfflineActivation />;

  if (user.role !== 'PATIENT') {
    return <Navigate to="/" replace />;
  }

  return (
    <AuthShell title={lang === 'ar' ? 'ربط الملف الطبي' : 'Link medical record'}>
      <p className="patient-auth-intro">
        {lang === 'ar'
          ? 'إذا كان لديك ملف سابق في العيادة، استخدم رمز الربط الذي حصلت عليه من موظف الاستقبال.'
          : 'If you already have a record at the clinic, enter the claim code provided by reception.'}
      </p>

          <div
            className="patient-alert"
            style={{ marginBottom: '1.25rem' }}
          >
            <strong>
              {lang === 'ar'
                ? 'لماذا أرى هذه الصفحة؟'
                : 'Why am I seeing this page?'}
            </strong>

            <p style={{ margin: '.4rem 0 0' }}>
              {lang === 'ar'
                ? 'تم تسجيل الدخول إلى حسابك بنجاح، لكن النظام لم يؤكد بعد ارتباط الحساب بملف طبي. لن يتم عرض أي بيانات طبية حتى يتم الربط بشكل آمن.'
                : 'You signed in successfully, but this account is not yet confirmed as linked to a medical record. Clinical data will remain unavailable until secure linking is completed.'}
            </p>
          </div>

          <form onSubmit={submit}>
            <Field
              label={
                lang === 'ar'
                  ? 'رمز ربط الملف'
                  : 'Claim code'
              }
              value={form.code}
              onChange={(code) =>
                updateField('code', code)
              }
              autoComplete="one-time-code"
            />

            <Field
              label={
                lang === 'ar'
                  ? 'تاريخ الميلاد'
                  : 'Date of birth'
              }
              type="date"
              value={form.dateOfBirth}
              onChange={(dateOfBirth) =>
                updateField(
                  'dateOfBirth',
                  dateOfBirth
                )
              }
            />

            {error && <Alert>{error}</Alert>}

            {message && (
              <div
                className="patient-alert success"
                role="status"
              >
                {message}
              </div>
            )}

            <button
              type="submit"
              className="patient-button"
              style={{
                width: '100%',
                marginTop: '1rem'
              }}
              disabled={
                loading ||
                !form.code.trim() ||
                !form.dateOfBirth
              }
            >
              {loading
                ? lang === 'ar'
                  ? 'جاري التحقق...'
                  : 'Verifying...'
                : lang === 'ar'
                  ? 'تحقق واربط الملف'
                  : 'Verify and link record'}
            </button>
          </form>

          <div
            style={{
              marginTop: '1.25rem',
              paddingTop: '1.25rem',
              borderTop:
                '1px solid var(--border-color, rgba(148, 163, 184, .2))'
            }}
          >
            <p style={{ fontSize: '.9rem' }}>
              {lang === 'ar'
                ? 'ليس لديك رمز ربط؟ اطلب من موظف الاستقبال التحقق من ملفك وإصدار رمز جديد. الرمز صالح لمدة 30 دقيقة.'
                : 'Do not have a claim code? Ask reception to verify your record and issue a new code. Claim codes are valid for 30 minutes.'}
            </p>

            <button
              type="button"
              className="patient-button secondary"
              style={{
                width: '100%',
                marginTop: '.75rem'
              }}
              onClick={handleLogout}
            >
              {lang === 'ar'
                ? 'تسجيل الخروج واستخدام حساب آخر'
                : 'Sign out and use another account'}
            </button>
          </div>
    </AuthShell>
  );
}

function OfflineActivation(){
  const { t } = useTranslation(); const navigate = useNavigate();
  const [form,setForm]=useState({code:'',dateOfBirth:'',email:'',password:'',confirmPassword:''}); const [error,setError]=useState(''); const [loading,setLoading]=useState(false);
  async function submit(event){event.preventDefault();if(form.password!==form.confirmPassword){setError(t('passwordMismatch'));return;}setLoading(true);setError('');try{await apiRequest('/api/patient-auth/offline-activation',{method:'POST',body:JSON.stringify({code:form.code.trim(),dateOfBirth:form.dateOfBirth,email:form.email.trim()||undefined,password:form.password})});navigate('/patient-login',{state:{message:t('offlineActivationSuccess')}});}catch(e){setError(e.code==='CLAIM_VERIFICATION_FAILED'?t('claimCredentialInvalid'):e.message);}finally{setLoading(false);}}
  return <AuthShell title={t('offlineActivation')}><p>{t('offlineActivationInstructions')}</p><form onSubmit={submit}><Field label={t('claimCode')} value={form.code} onChange={code=>setForm({...form,code})} autoComplete="one-time-code"/><Field label={t('dateOfBirth')} type="date" value={form.dateOfBirth} onChange={dateOfBirth=>setForm({...form,dateOfBirth})}/><Field label={t('emailOptional')} type="email" value={form.email} onChange={email=>setForm({...form,email})}/><Field label={t('newPassword')} type="password" value={form.password} onChange={password=>setForm({...form,password})} autoComplete="new-password"/><Field label={t('confirmPassword')} type="password" value={form.confirmPassword} onChange={confirmPassword=>setForm({...form,confirmPassword})} autoComplete="new-password"/>{error&&<Alert>{error}</Alert>}<button className="patient-button" style={{width:'100%'}} disabled={loading}>{loading?t('loading'):t('activatePatientAccount')}</button></form></AuthShell>;
}

function AuthShell({ title, children, onboarding = false }) {
  const { t, i18n } = useTranslation();
  const isRegistration = onboarding || title === t('createPatientAccount');
  const isLogin = title === t('patientLogin');
  const mode = isRegistration ? 'register' : isLogin ? 'login' : 'flow';

  return <main className={`patient-auth-shell patient-auth-shell--${mode}`}>
    <header className="patient-auth-topbar">
      <div className="patient-auth-topbar-inner">
        <Link className="patient-auth-brand" to="/" aria-label={t('brandName')}>
          <span className="patient-auth-brand-mark"><HeartPulse size={20} aria-hidden="true" /></span>
          <span>{t('brandName')}</span>
        </Link>
        <div className="patient-auth-topbar-actions">
          <ThemeToggle />
          <div className="patient-auth-language" role="group" aria-label="Language">
            <button type="button" className={i18n.language === 'ar' ? 'active' : ''} onClick={() => i18n.changeLanguage('ar')} lang="ar" aria-pressed={i18n.language === 'ar'}>العربية</button>
            <button type="button" className={i18n.language !== 'ar' ? 'active' : ''} onClick={() => i18n.changeLanguage('en')} lang="en" aria-pressed={i18n.language !== 'ar'}>English</button>
          </div>
        </div>
      </div>
    </header>
    <div className="patient-auth-stage">
      <aside className="patient-auth-aside" aria-hidden="true">
        {isLogin ? (
          <img
            className="patient-auth-illustration patient-auth-illustration--3d"
            src={doctor3dScene}
            alt=""
            width="500"
            height="373"
            decoding="async"
            fetchPriority="high"
          />
        ) : isRegistration ? (
          <img
            className="patient-auth-illustration patient-auth-illustration--3d patient-auth-illustration--register"
            src={register3dScene}
            alt=""
            width="420"
            height="314"
            decoding="async"
          />
        ) : (
          <img className="patient-auth-illustration" src={consultationIllustration} alt="" />
        )}
      </aside>
      <div className="patient-auth-content">
        <section className="patient-auth" aria-labelledby="patient-auth-title">
          <header className="patient-auth-heading">
            {isLogin && <p className="patient-auth-welcome">{t('welcomeBack')}</p>}
            <h1 id="patient-auth-title">{title}</h1>
          </header>
          {children}
        </section>
      </div>
    </div>
  </main>;
}
function Field({label,type='text',value,onChange,autoComplete,error,inputMode,maxLength,dir,className}){const {t}=useTranslation();const [visible,setVisible]=useState(false);const password=type==='password';return <><label className="patient-field">{label}<span className={password?'patient-field__password-wrap':undefined}><input className={className} type={password&&visible?'text':type} value={value} onChange={event=>onChange(event.target.value)} autoComplete={autoComplete} inputMode={inputMode} maxLength={maxLength} dir={dir} required aria-invalid={Boolean(error)}/>{password&&<button type="button" className="patient-field__password-toggle" aria-label={visible?t('hidePassword'):t('showPassword')} onClick={()=>setVisible(current=>!current)}>{visible?<EyeOff size={18}/>:<Eye size={18}/>}</button>}</span></label>{error&&<span className="field-error">{error}</span>}</>}
function Alert({children}){return <div className="patient-alert error" role="alert">{children}</div>}
function googleErrorMessageKey(code){if(code==='ACCOUNT_LINK_REQUIRED')return 'googleAccountLinkRequired';if(code==='REGISTRATION_PENDING')return 'googleRegistrationPending';if(code==='GOOGLE_SIGN_IN_CONFLICT')return 'googleAccountConflict';if(code==='GOOGLE_ONBOARDING_BUSY')return 'googleOnboardingBusy';if(code==='GOOGLE_AUTH_UNAVAILABLE')return 'googleSignInUnavailable';if(code==='GOOGLE_CREDENTIAL_INVALID'||code?.startsWith('GOOGLE_CREDENTIAL_')||code==='GOOGLE_EMAIL_UNVERIFIED')return 'googleCredentialInvalid';if(code==='GOOGLE_SIGN_IN_NETWORK_ERROR'||code==='GOOGLE_VERIFICATION_UNAVAILABLE'||code==='REQUEST_FAILED')return 'googleNetworkError';return 'googleSignInUnexpectedError'}
