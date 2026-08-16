import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Check, Eye, EyeOff, HeartPulse } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { apiRequest } from '../../services/apiClient';
import { useAuth } from '../../app/auth/auth-context';

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
      setError(requestError.message);
    }finally{
      setLoading(false);
    }
  }

  async function verify(event){
    event.preventDefault();
    setLoading(true);
    setError('');

    try{
      await apiRequest('/api/patient-auth/verify',{
        method:'POST',
        body:JSON.stringify({
          challengeId:challenge.challengeId,
          code
        })
      });

      setPendingVerification(false);
      setChallenge(null);
      setCode('');
      setMessage(t('verificationSuccessLogin'));
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

        <div style={{marginTop:'.75rem',textAlign:'center'}}>
          <Link to="/forgot-password">
            {t('forgotPassword')}
          </Link>
        </div>
      </form>

      <p>
        <Link to="/register">
          {t('createPatientAccount')}
        </Link>
      </p>
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
      setError(requestError.message);
    }finally{
      setLoading(false);
    }
  }

  async function resetPassword(event){
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

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
            disabled={loading}
          >
            {loading ? t('loading') : t('resetPassword')}
          </button>
        </form>
      )}
    </AuthShell>
  );
}

export function PatientRegister(){
  const{t}=useTranslation();const navigate=useNavigate();
  const[form,setForm]=useState({
    fullName:'',
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

const data=await apiRequest('/api/patient-auth/register',{method:'POST',body:JSON.stringify(payload)});setChallenge(data)}catch(requestError){const details=Array.isArray(requestError.details)?requestError.details:[];if(details.length){const fields={};for(const detail of details)fields[detail.field]=friendlyValidation(detail.field,detail.message,t);setFieldErrors(fields)}else setError(requestError.message)}finally{setLoading(false)}}
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
  return <AuthShell title={t('createPatientAccount')}>{!challenge?<form onSubmit={register}><Field label={t('fullName')} value={form.fullName} onChange={fullName=>setForm({...form,fullName})} error={fieldErrors.fullName}/><label className="patient-field">
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

export function PatientClaim(){const{t}=useTranslation();const[form,setForm]=useState({code:'',dateOfBirth:''});const[message,setMessage]=useState('');const[error,setError]=useState('');async function submit(event){event.preventDefault();setError('');try{const data=await apiRequest('/api/patient-auth/claim',{method:'POST',body:JSON.stringify(form)});setMessage(data.state)}catch(requestError){setError(requestError.message)}}return <section className="patient-card"><h1>{t('claimRecord')}</h1><p>{t('claimInstructions')}</p><form onSubmit={submit}><Field label={t('claimCode')} value={form.code} onChange={code=>setForm({...form,code})}/><Field label={t('dateOfBirth')} type="date" value={form.dateOfBirth} onChange={dateOfBirth=>setForm({...form,dateOfBirth})}/>{error&&<Alert>{error}</Alert>}{message&&<div className="patient-alert success">{message}</div>}<button className="patient-button">{t('claimRecord')}</button></form></section>}

function AuthShell({title,children}){const{t}=useTranslation();return <main className="patient-auth-shell"><aside className="patient-auth-aside"><Link to="/"><HeartPulse size={24}/>{t('brandName')}</Link><div><h2>{title}</h2><p>{t('secureAccessDescription')}</p></div></aside><div className="patient-auth-content"><section className="patient-card patient-auth"><h1>{title}</h1>{children}</section></div></main>}
function Field({label,type='text',value,onChange,autoComplete,error}){return <><label className="patient-field">{label}<input type={type} value={value} onChange={event=>onChange(event.target.value)} autoComplete={autoComplete} required aria-invalid={Boolean(error)}/></label>{error&&<span className="field-error">{error}</span>}</>}
function Alert({children}){return <div className="patient-alert error" role="alert">{children}</div>}
function friendlyValidation(field,message,t){if(field==='password'){if(/uppercase/i.test(message))return t('passwordUpper');if(/lowercase/i.test(message))return t('passwordLower');if(/number/i.test(message))return t('passwordNumber');return t('passwordMin')}if(field==='email')return t('emailInvalid');if(field==='phone')return t('phoneInvalid');if(field==='fullName')return t('fullNameInvalid');if(field==='dateOfBirth')return t('dateInvalid');return t('fieldInvalid')}
