import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { Check, Eye, EyeOff, HeartPulse } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { patientApiRequest, publicApiRequest as apiRequest } from '../../services/apiClient';
import { useAuth } from '../../app/auth/auth-context';
import { INITIAL_ONBOARDING_FORM, NAME_FIELDS, ONBOARDING_STEPS, onboardingErrorMessage, passwordChecks, registrationPayload, RESEND_COOLDOWN_SECONDS, resendSecondsRemaining, validateOnboardingStep } from './onboarding';
import { callingCode, countryFlag, countryName, normalisePatientPhone, PATIENT_PHONE_COUNTRIES, splitInternationalPhone } from './phoneCountries';
import { SUDANESE_STATES } from '../reception/clinicData';
import patientAuthDoctor from '../../assets/patient-auth-doctor-v2.webp';

export function PatientLogin(){
  const{t}=useTranslation();
  const{login}=useAuth();
  const navigate=useNavigate();
  const location=useLocation();

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
        />

        <label className="patient-field">
          {t('password')}
          <span style={{position:'relative'}}>
            <input
              style={{width:'100%',paddingInlineEnd:'3rem'}}
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
              style={{
                position:'absolute',
                insetInlineEnd:'.45rem',
                top:'.35rem',
                width:'38px',
                height:'38px',
                border:0,
                background:'transparent',
                color:'var(--color-text-secondary)',
                cursor:'pointer'
              }}
            >
              {showPassword?<EyeOff size={19}/>:<Eye size={19}/>}
            </button>
          </span>
        </label>

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

        <div className="patient-auth-create-account">
          <p>{t('dontHaveAccount')}</p>
          <Link className="patient-auth-secondary-button" to="/register">
            {t('createAccountAction')}
          </Link>
        </div>

        <Link className="patient-auth-forgot" to="/forgot-password">
          {t('forgotPassword')}
        </Link>
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

function LegacyPatientRegister(){
  const{t}=useTranslation();const navigate=useNavigate();
  const[form,setForm]=useState({
    firstNameAr:'', fatherNameAr:'', grandfatherNameAr:'', familyNameAr:'',
    firstNameEn:'', fatherNameEn:'', grandfatherNameEn:'', familyNameEn:'',
    countryCode:'+249',
    phone:'',
    email:'',
    dateOfBirth:'',
    gender:'MALE',
    password:'',
    confirmPassword:''
  });const[challenge,setChallenge]=useState(null);const[code,setCode]=useState('');const[error,setError]=useState('');const[fieldErrors,setFieldErrors]=useState({});const[loading,setLoading]=useState(false);
  const checks=[['length',form.password.length>=10,t('passwordMin')],['upper',/[A-Z]/.test(form.password),t('passwordUpper')],['lower',/[a-z]/.test(form.password),t('passwordLower')],['number',/\d/.test(form.password),t('passwordNumber')]];
  async function register(event){event.preventDefault();const clientErrors={};if(checks.some(([,valid])=>!valid))clientErrors.password=t('passwordRequirementsMissing');if(form.password!==form.confirmPassword)clientErrors.confirmPassword=t('passwordMismatch');if(Object.keys(clientErrors).length){setFieldErrors(clientErrors);return}setLoading(true);setError('');setFieldErrors({});try{const payload={...form};
delete payload.confirmPassword;

const localPhone = payload.phone.trim().replace(/^0+/, '');
payload.phone = `${payload.countryCode}${localPhone}`;
delete payload.countryCode;

const data=await apiRequest('/api/patient-auth/register',{method:'POST',body:JSON.stringify(payload)});setChallenge(data)}catch(requestError){const details=Array.isArray(requestError.details)?requestError.details:[];if(details.length){const fields={};for(const detail of details)fields[detail.field]=friendlyValidation(detail.field,detail.message,t);setFieldErrors(fields)}else setError(requestError.code==='VERIFICATION_UNAVAILABLE'?t('onlineVerificationUnavailable'):requestError.message)}finally{setLoading(false)}}
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

      let message = t('accountVerified');

      if(data.state === 'CLAIMED'){
        message = t('accountLinked');
      }else if(
        data.state === 'MANUAL_REVIEW_REQUIRED' ||
        data.state === 'AMBIGUOUS_MATCH'
      ){
        message = t('manualReviewRequired');
      }

      navigate('/patient-login',{
        state:{message}
      });
    }catch(requestError){
      setError(requestError.message);
    }finally{
      setLoading(false);
    }
  }
async function resendVerification(){
  setLoading(true);
  setError('');

  try{
    const data=await apiRequest(
      '/api/patient-auth/verification/resend',
      {
        method:'POST',
        body:JSON.stringify({
          challengeId:challenge.challengeId
        })
      }
    );

    setChallenge({
      ...challenge,
      challengeId:data.challengeId,
      developmentCode:data.developmentCode
    });

    setCode('');
  }catch(requestError){
    setError(requestError.message);
  }finally{
    setLoading(false);
  }
}
  return <AuthShell title={t('createPatientAccount')}>{!challenge?<form onSubmit={register}>
  {['firstNameAr','fatherNameAr','grandfatherNameAr','familyNameAr','firstNameEn','fatherNameEn','grandfatherNameEn','familyNameEn'].map((field)=><Field key={field} label={t(field)} value={form[field]} onChange={(value)=>setForm({...form,[field]:value})} error={fieldErrors[field]}/>)}
  <label className="patient-field">
  {t('phone')}
  <div style={{display:'grid',gridTemplateColumns:'150px 1fr',gap:'.5rem'}}>
    <select
      value={form.countryCode}
      onChange={event=>setForm({...form,countryCode:event.target.value})}
    >
      <option value="+249">🇸🇩 +249 {t('countrySudan')}</option>
      <option value="+250">🇷🇼 +250 {t('countryRwanda')}</option>
      <option value="+20">🇪🇬 +20 {t('countryEgypt')}</option>
      <option value="+251">🇪🇹 +251 {t('countryEthiopia')}</option>
      <option value="+254">🇰🇪 +254 {t('countryKenya')}</option>
      <option value="+256">🇺🇬 +256 {t('countryUganda')}</option>
      <option value="+255">🇹🇿 +255 {t('countryTanzania')}</option>
      <option value="+211">🇸🇸 +211 {t('countrySouthSudan')}</option>
      <option value="+966">🇸🇦 +966 {t('countrySaudiArabia')}</option>
      <option value="+971">🇦🇪 +971 {t('countryUAE')}</option>
    </select>

    <input
      type="tel"
      value={form.phone}
      onChange={event=>setForm({...form,phone:event.target.value})}
      placeholder={t('phoneExample')}
      required
      aria-invalid={Boolean(fieldErrors.phone)}
    />
  </div>
</label>
{fieldErrors.phone&&<span className="field-error">{fieldErrors.phone}</span>}<Field label={t('emailOptional')} type="email" value={form.email} onChange={email=>setForm({...form,email})} error={fieldErrors.email}/><Field label={t('dateOfBirth')} type="date" value={form.dateOfBirth} onChange={dateOfBirth=>setForm({...form,dateOfBirth})} error={fieldErrors.dateOfBirth}/><label className="patient-field">{t('gender')}<select value={form.gender} onChange={event=>setForm({...form,gender:event.target.value})}><option value="MALE">{t('male')}</option><option value="FEMALE">{t('female')}</option></select></label><Field label={t('password')} type="password" value={form.password} onChange={password=>setForm({...form,password})} error={fieldErrors.password}/><div className="password-requirements">{checks.map(([key,valid,label])=><span className={valid?'valid':''} key={key}><Check size={14}/>{label}</span>)}</div><Field label={t('confirmPassword')} type="password" value={form.confirmPassword} onChange={confirmPassword=>setForm({...form,confirmPassword})} error={fieldErrors.confirmPassword}/>{error&&<Alert>{error}</Alert>}<button className="patient-button" style={{width:'100%'}} disabled={loading}>{loading?t('loading'):t('createAccount')}</button></form>:<form onSubmit={verify}>
  <p>{t('verificationCodePrompt')}</p>

  {challenge.developmentCode&&
    <div className="patient-alert success">
      {t('developmentCode')}: <strong>{challenge.developmentCode}</strong>
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

  <button
    type="button"
    className="patient-button"
    style={{width:'100%',marginTop:'.75rem'}}
    disabled={loading}
    onClick={resendVerification}
  >
    {t('resendVerification')}
  </button>
</form>}
</AuthShell>;

}

export function PatientRegister() {
  const { t, i18n } = useTranslation(); const navigate = useNavigate();
  const { login } = useAuth();
  const [form, setForm] = useState(INITIAL_ONBOARDING_FORM); const [step, setStep] = useState(0);
  const [challenge, setChallenge] = useState(null); const [code, setCode] = useState(''); const [identity, setIdentity] = useState(null);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [fieldErrors, setFieldErrors] = useState({}); const [loading, setLoading] = useState(false); const [resending, setResending] = useState(false); const [verified, setVerified] = useState(false); const [resendAvailableAt, setResendAvailableAt] = useState(0); const [now, setNow] = useState(Date.now());
  const messages = { required:t('requiredField'), nameInvalid:t('onboardingNameInvalid'), dateInvalid:t('onboardingDobInvalid'), phoneInvalid:t('phoneInvalid'), emailInvalid:t('emailInvalid'), passwordInvalid:t('passwordRequirementsMissing'), passwordMismatch:t('passwordMismatch'), rateLimited:t('onboardingRateLimited'), addressStateInvalid:t('onboardingAddressStateInvalid'), emailDuplicate:t('onboardingEmailDuplicate'), phoneDuplicate:t('onboardingPhoneDuplicate'), manualReview:t('manualReviewRequired'), verificationFailed:t('onboardingVerificationFailed'), requestFailed:t('onboardingRequestFailed') };
  const resendRemaining = resendSecondsRemaining(resendAvailableAt, now);
  useEffect(() => {
    if (!challenge || resendRemaining === 0) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [challenge, resendRemaining]);
  const update = (field, value) => { setForm(current => ({ ...current, [field]: value })); setFieldErrors(current => ({ ...current, [field]: undefined })); setError(''); };
  const updatePhone = (value) => { const nextPhone = splitInternationalPhone(value, form.phoneCountry); setForm(current => ({ ...current, phoneCountry: nextPhone.country, phone: nextPhone.phone })); setFieldErrors(current => ({ ...current, phone: undefined })); setError(''); };
  const next = () => { const errors = validateOnboardingStep(form, step, messages); setFieldErrors(errors); if (!Object.keys(errors).length) setStep(current => current + 1); };
  async function submit(event) { event.preventDefault(); if (loading) return; const errors = validateOnboardingStep(form, 5, messages); if (Object.keys(errors).length) { setFieldErrors(errors); setStep(5); return; } setLoading(true); setError(''); try { const data = await apiRequest('/api/patient-auth/register', { method:'POST', body:JSON.stringify(registrationPayload(form)) }); setChallenge(data); setIdentity(data.identity || null); setNow(Date.now()); setResendAvailableAt(Date.now() + RESEND_COOLDOWN_SECONDS * 1000); } catch (requestError) { setError(onboardingErrorMessage(requestError, messages)); } finally { setLoading(false); } }
  async function verify(event) { event.preventDefault(); if (loading) return; setLoading(true); setError(''); try { const data = await apiRequest('/api/patient-auth/verify', { method:'POST', body:JSON.stringify({ challengeId:challenge.challengeId, code }) }); if (data.state === 'CLAIMED' || data.state === 'VERIFIED') { setIdentity(data.patient || identity); setVerified(true); } else setError(messages.manualReview); } catch (requestError) { setError(onboardingErrorMessage(requestError, messages)); } finally { setLoading(false); } }
  async function resendVerification() { if (resending || resendRemaining > 0 || !challenge) return; setResending(true); setError(''); setNotice(''); try { const data = await apiRequest('/api/patient-auth/verification/resend', { method:'POST', body:JSON.stringify({ challengeId:challenge.challengeId }) }); setChallenge(data); setCode(''); setNow(Date.now()); setResendAvailableAt(Date.now() + RESEND_COOLDOWN_SECONDS * 1000); setNotice(t('onboardingResendSuccess')); } catch (requestError) { setError(onboardingErrorMessage(requestError, messages)); } finally { setResending(false); } }
  async function continueToDashboard() { if (loading) return; setLoading(true); setError(''); try { const data = await apiRequest('/api/auth/login', { method:'POST', body:JSON.stringify({ username:form.email, password:form.password }) }); if (data.user?.role !== 'PATIENT') throw new Error(); login(data.user, data.token); navigate('/patient'); } catch { setError(t('onboardingContinueFailed')); } finally { setLoading(false); } }
  const title = (key) => t(`onboarding${key[0].toUpperCase()}${key.slice(1)}`);
  const reviewPhone = normalisePatientPhone(form.phone, form.phoneCountry) || form.phone;
  if (verified) return <AuthShell title={t('onboardingSuccessTitle')} onboarding><section className="onboarding-success" aria-live="polite"><Check size={44}/><h2>{t('onboardingSuccessTitle')}</h2><p>{t('onboardingSuccessText')}</p><strong>{identity?.fullNameAr || identity?.fullNameEn}</strong>{identity?.fileNumber && <p className="onboarding-mrn">{t('onboardingMrn')}: {identity.fileNumber}</p>}{error&&<Alert>{error}</Alert>}<button className="patient-button" disabled={loading} onClick={continueToDashboard}>{loading?t('loading'):t('onboardingContinueDashboard')}</button></section></AuthShell>;
  if (challenge) return <AuthShell title={t('verificationCode')} onboarding><form className="onboarding-verification" onSubmit={verify} aria-live="polite"><p className="onboarding-caption">{t('onboardingVerificationIntro')}</p>{challenge.developmentCode && <div className="patient-alert success">{t('developmentCode')}: <strong>{challenge.developmentCode}</strong></div>}<Field label={t('verificationCode')} value={code} onChange={setCode} autoComplete="one-time-code" inputMode="numeric" maxLength={6} dir="ltr"/>{notice&&<div className="patient-alert success" role="status">{notice}</div>}{error&&<Alert>{error}</Alert>}<button className="patient-button" style={{width:'100%'}} disabled={loading || resending}>{loading?t('loading'):t('verify')}</button><section className="onboarding-resend" aria-live="polite"><p>{t('onboardingResendPrompt')}</p><button type="button" className="onboarding-resend-button" disabled={resending || loading || resendRemaining > 0} onClick={resendVerification}>{resending ? t('loading') : resendRemaining > 0 ? t('onboardingResendAvailableIn', { seconds:resendRemaining }) : t('onboardingResendAction')}</button></section></form></AuthShell>;
  const nameFields = step === 0 ? NAME_FIELDS.slice(0, 4) : NAME_FIELDS.slice(4);
  return <AuthShell title={t('createPatientAccount')}><form className="onboarding-form" onSubmit={submit}><div className="onboarding-step-summary" aria-live="polite"><span>{t('onboardingStepOf', { current:step + 1, total:ONBOARDING_STEPS.length })}</span><strong>{title(ONBOARDING_STEPS[step])}</strong></div><ol className="onboarding-progress" aria-label={t('onboardingProgress')}>{ONBOARDING_STEPS.map((key, index) => <li key={key} className={index === step ? 'active' : index < step ? 'complete' : ''}><button type="button" disabled={index > step} onClick={() => setStep(index)} aria-current={index === step ? 'step' : undefined}><b aria-hidden="true">{index + 1}</b><span>{title(key)}</span></button></li>)}</ol><div className="onboarding-mobile-progress" aria-live="polite"><span>{t('onboardingStepOf', { current:step + 1, total:ONBOARDING_STEPS.length })}</span><strong>{title(ONBOARDING_STEPS[step])}</strong><i style={{'--progress':`${((step + 1) / ONBOARDING_STEPS.length) * 100}%`}} /></div><h2>{title(ONBOARDING_STEPS[step])}</h2><p className="onboarding-caption">{t(`onboarding${ONBOARDING_STEPS[step][0].toUpperCase()}${ONBOARDING_STEPS[step].slice(1)}Help`)}</p>
  {step < 2 && <div className="onboarding-grid" dir={step === 0 ? 'rtl' : 'ltr'}>{nameFields.map(field => <Field key={field} label={t(`onboarding${field[0].toUpperCase()}${field.slice(1)}`)} value={form[field]} onChange={value => update(field, value)} error={fieldErrors[field]} autoComplete="name"/>)}</div>}
  {step === 2 && <div className="onboarding-grid"><Field label={t('dateOfBirth')} type="date" value={form.dateOfBirth} onChange={value => update('dateOfBirth', value)} error={fieldErrors.dateOfBirth}/><label className="patient-field">{t('gender')}<select value={form.gender} onChange={event => update('gender', event.target.value)}><option value="">{t('onboardingSelectGender')}</option><option value="MALE">{t('male')}</option><option value="FEMALE">{t('female')}</option></select></label>{fieldErrors.gender&&<span className="field-error">{fieldErrors.gender}</span>}</div>}
  {step === 3 && <div className="onboarding-grid onboarding-contact-grid"><div className="onboarding-contact-phone"><label className="patient-field">{t('phone')}<div className="patient-phone-control"><select value={form.phoneCountry} onChange={event => update('phoneCountry', event.target.value)} aria-label={t('selectCountry')} dir={i18n.language === 'ar' ? 'rtl' : 'ltr'}>{PATIENT_PHONE_COUNTRIES.map(country => <option key={country} value={country}>{countryFlag(country)} {countryName(country, i18n.language)} ({callingCode(country)})</option>)}</select><input type="tel" inputMode="tel" dir="ltr" value={form.phone} onChange={event => updatePhone(event.target.value)} placeholder={t('phoneExample')} autoComplete="tel-national" required aria-invalid={Boolean(fieldErrors.phone)}/></div></label>{fieldErrors.phone&&<span className="field-error">{fieldErrors.phone}</span>}</div><Field label={t('email')} type="email" value={form.email} onChange={value => update('email', value)} error={fieldErrors.email} autoComplete="email"/></div>}
  {step === 4 && <><label className="patient-field">{t('addressState')}<select value={form.addressStateId} onChange={event => update('addressStateId', event.target.value)}>{SUDANESE_STATES.map(state => <option key={state.id} value={state.id}>{i18n.language === 'ar' ? state.labelAr : state.labelEn}</option>)}</select></label><p className="onboarding-note">{t('onboardingContactAfterActivation')}</p></>}
  {step === 5 && <div dir="ltr"><Field label={t('password')} type="password" value={form.password} onChange={value => update('password', value)} error={fieldErrors.password} autoComplete="new-password"/><div className="password-requirements">{Object.entries(passwordChecks(form.password)).map(([key, valid]) => <span className={valid?'valid':''} key={key}><Check size={14}/>{t(`password${key[0].toUpperCase()}${key.slice(1)}`)}</span>)}</div><Field label={t('confirmPassword')} type="password" value={form.confirmPassword} onChange={value => update('confirmPassword', value)} error={fieldErrors.confirmPassword} autoComplete="new-password"/></div>}
  {step === 6 && <div className="onboarding-review"><p>{form.firstNameAr} {form.fatherNameAr} {form.grandfatherNameAr} {form.familyNameAr}</p><p dir="ltr">{form.firstNameEn} {form.fatherNameEn} {form.grandfatherNameEn} {form.familyNameEn}</p><p>{form.dateOfBirth} · {form.gender === 'MALE' ? t('male') : t('female')}</p><p dir="ltr">{reviewPhone} · {form.email}</p><p>{t('addressState')}: {(SUDANESE_STATES.find(state => String(state.id) === form.addressStateId)?.[i18n.language === 'ar' ? 'labelAr' : 'labelEn'])}</p><p className="onboarding-note">{t('onboardingPasswordHidden')}</p></div>}
  {error&&<Alert>{error}</Alert>}<div className="onboarding-actions">{step > 0 && <button type="button" className="patient-button secondary" onClick={() => setStep(current => current - 1)} disabled={loading}>{t('onboardingBack')}</button>}{step < 6 ? <button type="button" className="patient-button" onClick={next}>{t('onboardingNext')}</button> : <button className="patient-button" disabled={loading}>{loading?t('loading'):t('createAccount')}</button>}</div><section className="patient-auth-registration-nav"><div className="patient-auth-divider" role="separator"><span>{t('authOr')}</span></div><p>{t('alreadyHaveAccount')}</p><Link className="patient-auth-secondary-button" to="/patient-login">{t('signIn')}</Link></section></form></AuthShell>;
}

export function PatientClaim() {
  const { t, i18n } = useTranslation();
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
    <main className="patient-auth-shell">
      <aside className="patient-auth-aside">
        <Link to="/">
          <HeartPulse size={24} />
          {t('brandName')}
        </Link>

        <div>
          <h2>
            {lang === 'ar'
              ? 'استعادة وربط الملف الطبي'
              : 'Recover your medical record'}
          </h2>

          <p>
            {lang === 'ar'
              ? 'حسابك آمن، لكن يجب ربطه بملف المريض الصحيح قبل الوصول إلى البيانات الطبية.'
              : 'Your account is secure, but it must be linked to the correct patient record before clinical information can be accessed.'}
          </p>
        </div>
      </aside>

      <div className="patient-auth-content">
        <section className="patient-card patient-auth">
          <div style={{ marginBottom: '1.25rem' }}>
            <h1>
              {lang === 'ar'
                ? 'ربط الملف الطبي'
                : 'Link medical record'}
            </h1>

            <p>
              {lang === 'ar'
                ? 'إذا كان لديك ملف سابق في العيادة، استخدم رمز الربط الذي حصلت عليه من موظف الاستقبال.'
                : 'If you already have a record at the clinic, enter the claim code provided by reception.'}
            </p>
          </div>

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
        </section>
      </div>
    </main>
  );
}

function OfflineActivation(){
  const { t } = useTranslation(); const navigate = useNavigate();
  const [form,setForm]=useState({code:'',dateOfBirth:'',email:'',password:'',confirmPassword:''}); const [error,setError]=useState(''); const [loading,setLoading]=useState(false);
  async function submit(event){event.preventDefault();if(form.password!==form.confirmPassword){setError(t('passwordMismatch'));return;}setLoading(true);setError('');try{await apiRequest('/api/patient-auth/offline-activation',{method:'POST',body:JSON.stringify({code:form.code.trim(),dateOfBirth:form.dateOfBirth,email:form.email.trim()||undefined,password:form.password})});navigate('/patient-login',{state:{message:t('offlineActivationSuccess')}});}catch(e){setError(e.code==='CLAIM_VERIFICATION_FAILED'?t('claimCredentialInvalid'):e.message);}finally{setLoading(false);}}
  return <AuthShell title={t('offlineActivation')}><p>{t('offlineActivationInstructions')}</p><form onSubmit={submit}><Field label={t('claimCode')} value={form.code} onChange={code=>setForm({...form,code})} autoComplete="one-time-code"/><Field label={t('dateOfBirth')} type="date" value={form.dateOfBirth} onChange={dateOfBirth=>setForm({...form,dateOfBirth})}/><Field label={t('emailOptional')} type="email" value={form.email} onChange={email=>setForm({...form,email})}/><Field label={t('newPassword')} type="password" value={form.password} onChange={password=>setForm({...form,password})} autoComplete="new-password"/><Field label={t('confirmPassword')} type="password" value={form.confirmPassword} onChange={confirmPassword=>setForm({...form,confirmPassword})} autoComplete="new-password"/>{error&&<Alert>{error}</Alert>}<button className="patient-button" style={{width:'100%'}} disabled={loading}>{loading?t('loading'):t('activatePatientAccount')}</button></form></AuthShell>;
}

function AuthShell({title,children,onboarding=false}){const{t,i18n}=useTranslation();const isOnboarding=onboarding||title===t('createPatientAccount');const isRegistration=!onboarding&&title===t('createPatientAccount');const isLogin=title===t('patientLogin');const languageControl=<div className={isOnboarding?'onboarding-language':'patient-auth-language'} role="group" aria-label="Language"><button type="button" className={i18n.language==='ar'?'active':''} onClick={()=>i18n.changeLanguage('ar')} lang="ar">العربية</button><button type="button" className={i18n.language!=='ar'?'active':''} onClick={()=>i18n.changeLanguage('en')} lang="en">English</button></div>;return <main className={`patient-auth-shell${isOnboarding?' patient-auth-shell--onboarding':''}${isLogin?' patient-auth-shell--login':''}${isRegistration?' patient-auth-shell--registration':''}`}><aside className="patient-auth-aside"><Link className="patient-auth-brand" to="/"><span><HeartPulse size={20}/></span>{t('brandName')}</Link><div className="patient-auth-hero-copy"><span className="patient-auth-kicker">{t('patientPortal')}</span><h2>{t('patientPortal')}</h2><p>{t('secureAccessDescription')}</p></div><div className="patient-auth-doctor" aria-hidden="true"><img src={patientAuthDoctor} alt=""/></div></aside><div className="patient-auth-content"><section className="patient-card patient-auth">{isLogin&&<PatientLoginIllustration/>}{isRegistration&&<PatientRegisterIllustration/>}<header className="patient-auth-card-header">{languageControl}<span className="patient-auth-card-kicker">{t('patientPortal')}</span><h1>{title}</h1></header>{children}</section></div></main>}

function PatientLoginIllustration(){return <svg className="patient-login-illustration" viewBox="0 0 120 120" role="img" aria-label="Patient illustration"><circle cx="60" cy="60" r="55" fill="#e7f4ff"/><path d="M36 105c2-18 12-29 24-29s22 11 24 29" fill="#1f83c9"/><path d="M38 104c3-16 11-24 22-24s19 8 22 24" fill="#72c5ed" opacity=".55"/><circle cx="60" cy="48" r="17" fill="#f2c4a2"/><path d="M43 48c0-17 8-26 19-26 10 0 18 8 18 22-5-4-11-7-18-7-6 0-12 2-19 11Z" fill="#31516e"/><path d="M51 51h.5M68.5 51h.5" stroke="#31516e" strokeWidth="3" strokeLinecap="round"/><path d="M55 59c3 3 7 3 10 0" fill="none" stroke="#b66f67" strokeWidth="2" strokeLinecap="round"/><path d="M46 79c5 6 9 8 14 8s9-2 14-8" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"/><path d="M75 78c9 2 12 8 12 15 0 5-3 8-7 8" fill="none" stroke="#125f9f" strokeWidth="3" strokeLinecap="round"/><path d="M87 99c4 0 7-3 7-7" fill="none" stroke="#125f9f" strokeWidth="3" strokeLinecap="round"/><circle cx="94" cy="91" r="3" fill="#125f9f"/><path d="M88 89c-2-4-5-5-8-5" fill="none" stroke="#125f9f" strokeWidth="3" strokeLinecap="round"/></svg>}

function PatientRegisterIllustration(){return <svg className="patient-register-illustration" viewBox="0 0 120 120" role="img" aria-label="New patient illustration"><circle cx="60" cy="60" r="55" fill="#e7f4ff"/><path d="M35 105c2-18 12-29 25-29s23 11 25 29" fill="#277fbe"/><path d="M42 101c4-12 10-18 18-18s14 6 18 18" fill="#8dd4f1" opacity=".6"/><circle cx="60" cy="48" r="17" fill="#f2c4a2"/><path d="M43 47c1-16 9-25 20-25 9 0 16 6 18 18-7-4-13-6-20-6-7 0-12 4-18 13Z" fill="#31516e"/><path d="M51 51h.5M68.5 51h.5" stroke="#31516e" strokeWidth="3" strokeLinecap="round"/><path d="M55 59c3 3 7 3 10 0" fill="none" stroke="#b66f67" strokeWidth="2" strokeLinecap="round"/><path d="M76 80c8 2 12 7 12 13" fill="none" stroke="#125f9f" strokeWidth="3" strokeLinecap="round"/><circle cx="94" cy="91" r="15" fill="#fff" stroke="#91cbed" strokeWidth="2"/><path d="M94 84v14M87 91h14" stroke="#1680c9" strokeWidth="3" strokeLinecap="round"/></svg>}
function Field({label,type='text',value,onChange,autoComplete,error,inputMode,maxLength,dir}){return <><label className="patient-field">{label}<input type={type} value={value} onChange={event=>onChange(event.target.value)} autoComplete={autoComplete} inputMode={inputMode} maxLength={maxLength} dir={dir} required aria-invalid={Boolean(error)}/></label>{error&&<span className="field-error">{error}</span>}</>}
function Alert({children}){return <div className="patient-alert error" role="alert">{children}</div>}
function friendlyValidation(field,message,t){if(field==='password'){if(/uppercase/i.test(message))return t('passwordUpper');if(/lowercase/i.test(message))return t('passwordLower');if(/number/i.test(message))return t('passwordMin')}if(field==='email')return t('emailInvalid');if(field==='phone')return t('phoneInvalid');if(/Name(?:Ar|En)$/.test(field))return t('fullNameInvalid');if(field==='dateOfBirth')return t('dateInvalid');return t('fieldInvalid')}
