import { clearPatientSession } from '../../../../services/authStorage.js';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Link2, Lock, MapPin, Phone } from 'lucide-react';
import { patientApiRequest as apiRequest } from '../../../../services/apiClient';
import { GoogleIdentityButton } from '../../auth/GoogleIdentityButton.jsx';
import PasswordField from '../../../../components/PasswordField.jsx';
import { useApi, State } from './shared.jsx';

export function Profile() {
  const { t, i18n } = useTranslation();
  const {
    data,
    error,
    loading,
    reload
  } = useApi('/api/patient/me');

  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';

  const [form, setForm] = useState(null);
  const [message, setMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [openSection, setOpenSection] = useState(null);

  const [emailChangeOpen, setEmailChangeOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [emailChallengeId, setEmailChallengeId] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [emailChanging, setEmailChanging] = useState(false);
  const [emailChangeError, setEmailChangeError] = useState('');
  const [emailChangeMessage, setEmailChangeMessage] = useState('');

  const [phoneChangeOpen, setPhoneChangeOpen] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [phoneChallengeId, setPhoneChallengeId] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneChanging, setPhoneChanging] = useState(false);
  const [phoneChangeError, setPhoneChangeError] = useState('');
  const [phoneChangeMessage, setPhoneChangeMessage] = useState('');
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [passwordChanging, setPasswordChanging] = useState(false);
  const [passwordChangeError, setPasswordChangeError] = useState('');

  const location = useLocation();
  const highlightGoogleLink = location.state?.highlightGoogleLink;

  const [googleLinkOpen, setGoogleLinkOpen] = useState(false);
  const [googleLinkPassword, setGoogleLinkPassword] = useState('');
  const [googleLinkError, setGoogleLinkError] = useState('');
  const [googleLinkMessage, setGoogleLinkMessage] = useState('');
  const [googleLinking, setGoogleLinking] = useState(false);
  const [pendingGoogleCredential, setPendingGoogleCredential] = useState(null);

  const [googleUnlinkOpen, setGoogleUnlinkOpen] = useState(false);
  const [googleUnlinkPassword, setGoogleUnlinkPassword] = useState('');
  const [googleUnlinkError, setGoogleUnlinkError] = useState('');
  const [googleUnlinking, setGoogleUnlinking] = useState(false);

  async function handleConfirmGoogleLink(event) {
    event.preventDefault();
    if (googleLinking || !pendingGoogleCredential || !googleLinkPassword) return;
    setGoogleLinking(true);
    setGoogleLinkError('');
    setGoogleLinkMessage('');

    try {
      await apiRequest('/api/patient/me/external-identities/google/link', {
        method: 'POST',
        body: JSON.stringify({
          credential: pendingGoogleCredential,
          currentPassword: googleLinkPassword
        })
      });
      setGoogleLinkMessage(t('googleLinkedSuccess'));
      setPendingGoogleCredential(null);
      setGoogleLinkPassword('');
      setGoogleLinkOpen(false);
      await reload();
    } catch (requestError) {
      let msg = t('genericLinkingFailed');
      if (requestError?.code === 'REAUTHENTICATION_FAILED') msg = t('reauthenticationFailed');
      else if (requestError?.code === 'GOOGLE_EMAIL_MISMATCH') msg = t('googleEmailMismatch');
      else if (requestError?.code === 'GOOGLE_IDENTITY_ALREADY_LINKED') msg = t('identityAlreadyLinked');
      else if (requestError?.code === 'GOOGLE_ALREADY_LINKED') msg = t('googleAlreadyLinked');
      else if (requestError?.code === 'GOOGLE_CREDENTIAL_INVALID') msg = t('googleCredentialInvalid');
      setGoogleLinkError(msg);
    } finally {
      setGoogleLinking(false);
    }
  }

  async function handleConfirmGoogleUnlink(event) {
    event.preventDefault();
    if (googleUnlinking || !googleUnlinkPassword) return;
    setGoogleUnlinking(true);
    setGoogleUnlinkError('');

    try {
      await apiRequest('/api/patient/me/external-identities/google', {
        method: 'DELETE',
        body: JSON.stringify({
          currentPassword: googleUnlinkPassword
        })
      });
      setGoogleUnlinkOpen(false);
      setGoogleUnlinkPassword('');
      setMessage(t('googleUnlinkedSuccess'));
      await reload();
    } catch (requestError) {
      let msg = t('genericUnlinkingFailed');
      if (requestError?.code === 'REAUTHENTICATION_FAILED') msg = t('reauthenticationFailed');
      setGoogleUnlinkError(msg);
    } finally {
      setGoogleUnlinking(false);
    }
  }

  useEffect(() => {
    if (!data) return;

    setForm({
      addressStateId: data.addressStateId,
      addressDetails: data.addressDetails || '',
      emergencyContact: data.emergencyContact || '',
      bloodType: data.bloodType || '',
      preferredLanguage: data.preferredLanguage
    });
  }, [data]);

  async function save(event) {
    event.preventDefault();

    if (!form || saving) return;

    setSaving(true);
    setMessage('');
    setSaveError('');

    try {
      await apiRequest('/api/patient/me', {
        method: 'PATCH',
        body: JSON.stringify({
          addressStateId: form.addressStateId,
          addressDetails: form.addressDetails || null,
          emergencyContact: form.emergencyContact,
          bloodType: form.bloodType || null,
          preferredLanguage: form.preferredLanguage
        })
      });

      setMessage(
        lang === 'ar'
          ? 'تم حفظ التغييرات بنجاح.'
          : 'Profile changes saved successfully.'
      );

      try {
        await reload();
      } catch (reloadError) {
        console.error('Patient profile reload error:', reloadError);
      }
    } catch (requestError) {
      console.error('Patient profile save error:', requestError);

      setSaveError(
        requestError?.message ||
          (
            lang === 'ar'
              ? 'تعذر حفظ التغييرات. يرجى المحاولة مرة أخرى.'
              : 'Unable to save profile changes. Please try again.'
          )
      );
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    setPasswordChangeError('');
    if (passwordForm.newPassword !== passwordForm.confirmPassword) return setPasswordChangeError(t('passwordsDoNotMatch'));
    setPasswordChanging(true);
    try {
      await apiRequest('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: passwordForm.currentPassword, newPassword: passwordForm.newPassword }) });
      clearPatientSession();
      window.location.replace('/patient-login');
    } catch (requestError) {
      setPasswordChangeError(requestError?.message || t('passwordChangeFailed'));
    } finally { setPasswordChanging(false); }
  }

  async function requestEmailChange(event) {
    event.preventDefault();

    setEmailChanging(true);
    setEmailChangeError('');
    setEmailChangeMessage('');

    try {
      const result = await apiRequest(
        '/api/patient/me/email-change/request',
        {
          method: 'POST',
          body: JSON.stringify({
            email: newEmail.trim(), currentPassword
          })
        }
      );

      setEmailChallengeId(result.challengeId);

      setEmailChangeMessage(
        lang === 'ar'
          ? 'تم إرسال رمز تحقق إلى البريد الإلكتروني الجديد.'
          : 'A verification code was sent to the new email address.'
      );
    } catch (requestError) {
      setEmailChangeError(
        requestError?.message ||
          (
            lang === 'ar'
              ? 'تعذر إرسال رمز التحقق.'
              : 'Unable to send verification code.'
          )
      );
    } finally {
      setEmailChanging(false);
    }
  }

  async function verifyEmailChange(event) {
    event.preventDefault();

    setEmailChanging(true);
    setEmailChangeError('');

    try {
      await apiRequest(
        '/api/patient/me/email-change/verify',
        {
          method: 'POST',
          body: JSON.stringify({
            challengeId: emailChallengeId,
            code: emailCode, currentPassword
          })
        }
      );

      setEmailChangeMessage(
        lang === 'ar'
          ? 'تم تغيير البريد الإلكتروني والتحقق منه بنجاح.'
          : 'Email address changed and verified successfully.'
      );

      setEmailChangeOpen(false);
      setEmailChallengeId('');
      setEmailCode('');
      setNewEmail('');

      setCurrentPassword('');
      clearPatientSession();
      window.location.replace('/patient-login');
    } catch (requestError) {
      setEmailChangeError(
        requestError?.message ||
          (
            lang === 'ar'
              ? 'تعذر التحقق من رمز البريد الإلكتروني.'
              : 'Unable to verify the email change code.'
          )
      );
    } finally {
      setEmailChanging(false);
    }
  }

  async function requestPhoneChange(event) {
    event.preventDefault();

    setPhoneChanging(true);
    setPhoneChangeError('');
    setPhoneChangeMessage('');

    try {
      const result = await apiRequest(
        '/api/patient/me/phone-change/request',
        {
          method: 'POST',
          body: JSON.stringify({
            phone: newPhone.trim()
          })
        }
      );

      setPhoneChallengeId(result.challengeId);

      setPhoneChangeMessage(
        lang === 'ar'
          ? `تم إرسال رمز تأكيد إلى بريدك الإلكتروني الموثق${result.deliveredTo ? ` (${result.deliveredTo})` : ''}.`
          : `An authorization code was sent to your verified email${result.deliveredTo ? ` (${result.deliveredTo})` : ''}.`
      );
    } catch (requestError) {
      setPhoneChangeError(
        requestError?.message ||
          (
            lang === 'ar'
              ? 'تعذر بدء عملية تغيير رقم الهاتف.'
              : 'Unable to start the phone number change.'
          )
      );
    } finally {
      setPhoneChanging(false);
    }
  }

  async function verifyPhoneChange(event) {
    event.preventDefault();

    setPhoneChanging(true);
    setPhoneChangeError('');

    try {
      await apiRequest(
        '/api/patient/me/phone-change/verify',
        {
          method: 'POST',
          body: JSON.stringify({
            challengeId: phoneChallengeId,
            code: phoneCode
          })
        }
      );

      setPhoneChangeMessage(
        lang === 'ar'
          ? 'تم تغيير رقم الهاتف. سيظل الرقم غير موثق حتى يتم التحقق منه عبر SMS.'
          : 'Phone number changed. It will remain unverified until SMS verification is available.'
      );

      setPhoneChangeOpen(false);
      setPhoneChallengeId('');
      setPhoneCode('');
      setNewPhone('');

      clearPatientSession();
      window.location.replace('/patient-login');
    } catch (requestError) {
      setPhoneChangeError(
        requestError?.message ||
          (
            lang === 'ar'
              ? 'تعذر التحقق من رمز تغيير رقم الهاتف.'
              : 'Unable to verify the phone change code.'
          )
      );
    } finally {
      setPhoneChanging(false);
    }
  }

  return (
    <State
      loading={loading}
      error={error}
      onRetry={reload}
    >
      {form && data && (
        <div className="patient-profile">
          <header className="patient-profile__header">
            <p className="ui-section-label">{t('profile')}</p>
            <h1 className="patient-page-title ui-page-title">
              {lang === 'ar'
                ? data.fullNameAr || data.fullNameEn
                : data.fullNameEn || data.fullNameAr}
            </h1>
            <p className="patient-profile__mrn">
              {lang === 'ar' ? 'رقم الملف: ' : 'File number: '}
              <bdi dir="ltr" className="ui-mono patient-profile__mrn-val">{data.fileNumber || '—'}</bdi>
            </p>
          </header>

          {highlightGoogleLink && !data.googleAccount?.linked && (
            <div className="patient-alert info" role="status">
              {t('googleLinkPostLoginHint')}
            </div>
          )}

          {message && (
            <div className="patient-alert success" role="status">
              {message}
            </div>
          )}

          <div className="patient-profile__groups">
            <section className="patient-profile__group-section" aria-labelledby="profile-details-heading">
              <h2 id="profile-details-heading" className="ui-section-label">
                {lang === 'ar' ? 'بياناتك' : 'Your details'}
              </h2>

              <div className="patient-panel">
                <ProfileRow
                  icon={Phone}
                  title={lang === 'ar' ? 'الهاتف والبريد الإلكتروني' : 'Phone and email'}
                  subtitle={(
                    <>
                      <bdi dir="ltr">{data.phone || '-'}</bdi>
                      {' · '}
                      <bdi dir="ltr">{data.email || '-'}</bdi>
                    </>
                  )}
                  expanded={openSection === 'contact'}
                  onToggle={() => setOpenSection(openSection === 'contact' ? null : 'contact')}
                >
                  <div className="patient-profile__line">
                    <div className="patient-profile__line-main">
                      <span className="patient-profile__label">{lang === 'ar' ? 'رقم الهاتف:' : 'Phone:'}</span>
                      <bdi dir="ltr" className="ui-mono">{data.phone || (lang === 'ar' ? 'غير متوفر' : 'Not available')}</bdi>
                      <span className={`ui-status ui-status--${data.phoneVerified ? 'ok' : 'warn'}`}>
                        {t(data.phoneVerified ? 'patientVerified' : 'patientNotVerified')}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="patient-button secondary"
                      onClick={() => {
                        setPhoneChangeOpen((current) => !current);
                        setPhoneChangeError('');
                        setPhoneChangeMessage('');
                      }}
                    >
                      {lang === 'ar' ? 'تغيير رقم الهاتف' : 'Change Phone'}
                    </button>
                  </div>

                  {phoneChangeOpen && (
                    <div className="patient-profile__subform">
                      {!phoneChallengeId ? (
                        <form onSubmit={requestPhoneChange} className="patient-profile__form">
                          <label className="patient-field">
                            {lang === 'ar' ? 'رقم الهاتف الجديد' : 'New phone number'}
                            <input
                              type="tel"
                              dir="ltr"
                              autoComplete="tel"
                              value={newPhone}
                              onChange={(event) => setNewPhone(event.target.value)}
                              placeholder="+249..."
                              required
                            />
                          </label>
                          <button className="patient-button patient-profile__submit" disabled={phoneChanging || !newPhone.trim()}>
                            {phoneChanging ? t('loading') : (lang === 'ar' ? 'إرسال رمز التأكيد' : 'Send Authorization Code')}
                          </button>
                        </form>
                      ) : (
                        <form onSubmit={verifyPhoneChange} className="patient-profile__form">
                          <label className="patient-field">
                            {lang === 'ar' ? 'رمز التأكيد المرسل إلى بريدك' : 'Authorization code sent to your email'}
                            <input
                              inputMode="numeric"
                              autoComplete="one-time-code"
                              dir="ltr"
                              maxLength={6}
                              value={phoneCode}
                              onChange={(event) => setPhoneCode(event.target.value.replace(/\D/g, ''))}
                              required
                            />
                          </label>
                          <button className="patient-button patient-profile__submit" disabled={phoneChanging || phoneCode.length !== 6}>
                            {phoneChanging ? t('loading') : (lang === 'ar' ? 'تأكيد تغيير الرقم' : 'Confirm Phone Change')}
                          </button>
                        </form>
                      )}

                      {phoneChangeError && (
                        <div className="patient-alert error" role="alert">
                          {phoneChangeError}
                        </div>
                      )}

                      {phoneChangeMessage && (
                        <div className="patient-alert success" role="status">
                          {phoneChangeMessage}
                        </div>
                      )}

                      <p className="patient-help-text">
                        {lang === 'ar'
                          ? 'يتم تأكيد طلب تغيير الرقم عبر بريدك الموثق حالياً. سيظل الرقم الجديد بحالة قيد التحقق حتى يتوفر التحقق عبر SMS.'
                          : 'The change is authorized through your currently verified email. The new phone remains pending until SMS verification is available.'}
                      </p>
                    </div>
                  )}

                  <div className="patient-profile__line">
                    <div className="patient-profile__line-main">
                      <span className="patient-profile__label">{lang === 'ar' ? 'البريد الإلكتروني:' : 'Email:'}</span>
                      <bdi dir="ltr" className="ui-mono">{data.email || (lang === 'ar' ? 'غير متوفر' : 'Not available')}</bdi>
                      <span className={`ui-status ui-status--${data.emailVerified ? 'ok' : 'warn'}`}>
                        {t(data.emailVerified ? 'patientVerified' : 'patientNotVerified')}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="patient-button secondary"
                      onClick={() => {
                        setEmailChangeOpen((current) => !current);
                        setEmailChangeError('');
                        setEmailChangeMessage('');
                      }}
                    >
                      {lang === 'ar' ? 'تغيير البريد' : 'Change Email'}
                    </button>
                  </div>

                  {emailChangeOpen && (
                    <div className="patient-profile__subform">
                      {!emailChallengeId ? (
                        <form onSubmit={requestEmailChange} className="patient-profile__form">
                          <PasswordField
                            label={t('currentPassword')}
                            autoComplete="current-password"
                            value={currentPassword}
                            onChange={(event) => setCurrentPassword(event.target.value)}
                            required
                          />
                          <label className="patient-field">
                            {lang === 'ar' ? 'البريد الإلكتروني الجديد' : 'New email address'}
                            <input
                              type="email"
                              value={newEmail}
                              onChange={(event) => setNewEmail(event.target.value)}
                              required
                            />
                          </label>
                          <button className="patient-button patient-profile__submit" disabled={emailChanging || !newEmail.trim()}>
                            {emailChanging ? t('loading') : (lang === 'ar' ? 'إرسال رمز التحقق' : 'Send Verification Code')}
                          </button>
                        </form>
                      ) : (
                        <form onSubmit={verifyEmailChange} className="patient-profile__form">
                          <label className="patient-field">
                            {lang === 'ar' ? 'رمز التحقق' : 'Verification code'}
                            <input
                              inputMode="numeric"
                              autoComplete="one-time-code"
                              dir="ltr"
                              maxLength={6}
                              value={emailCode}
                              onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, ''))}
                              required
                            />
                          </label>
                          <button className="patient-button patient-profile__submit" disabled={emailChanging || emailCode.length !== 6}>
                            {emailChanging ? t('loading') : (lang === 'ar' ? 'تأكيد البريد الجديد' : 'Confirm New Email')}
                          </button>
                        </form>
                      )}

                      {emailChangeError && (
                        <div className="patient-alert error" role="alert">
                          {emailChangeError}
                        </div>
                      )}

                      {emailChangeMessage && (
                        <div className="patient-alert success" role="status">
                          {emailChangeMessage}
                        </div>
                      )}
                    </div>
                  )}
                </ProfileRow>

                <ProfileRow
                  icon={MapPin}
                  title={lang === 'ar' ? 'العنوان والمعلومات الطبية' : 'Address and medical details'}
                  subtitle={[data.bloodType, data.emergencyContact].filter(Boolean).join(' · ') || (lang === 'ar' ? 'غير محدد' : 'Not set')}
                  expanded={openSection === 'address'}
                  onToggle={() => setOpenSection(openSection === 'address' ? null : 'address')}
                >
                  <form onSubmit={save} className="patient-profile__form">
                    <label className="patient-field">
                      {t('addressState')}

                      <select
                        required
                        value={form.addressStateId || ''}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            addressStateId: Number(event.target.value)
                          })
                        }
                      >
                        <option value="">
                          {t('selectState')}
                        </option>

                        <option value="1">{t('stateKhartoum')}</option>
                        <option value="2">{t('stateGezira')}</option>
                        <option value="3">{t('stateRedSea')}</option>
                        <option value="4">{t('stateKassala')}</option>
                        <option value="5">{t('stateGedaref')}</option>
                        <option value="6">{t('stateSennar')}</option>
                        <option value="7">{t('stateBlueNile')}</option>
                        <option value="8">{t('stateWhiteNile')}</option>
                        <option value="9">{t('stateRiverNile')}</option>
                        <option value="10">{t('stateNorthern')}</option>
                        <option value="11">{t('stateWestKordofan')}</option>
                        <option value="12">{t('stateNorthKordofan')}</option>
                        <option value="13">{t('stateSouthKordofan')}</option>
                        <option value="14">{t('stateNorthDarfur')}</option>
                        <option value="15">{t('stateWestDarfur')}</option>
                        <option value="16">{t('stateSouthDarfur')}</option>
                        <option value="17">{t('stateEastDarfur')}</option>
                        <option value="18">{t('stateCentralDarfur')}</option>
                      </select>
                    </label>

                    <label className="patient-field">
                      {lang === 'ar'
                        ? 'فصيلة الدم'
                        : 'Blood Type'}

                      <select
                        dir="ltr"
                        value={form.bloodType || ''}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            bloodType: event.target.value
                          })
                        }
                      >
                        <option value="">
                          {lang === 'ar'
                            ? 'اختر فصيلة الدم'
                            : 'Select blood type'}
                        </option>

                        <option value="A+">A+</option>
                        <option value="A-">A-</option>
                        <option value="B+">B+</option>
                        <option value="B-">B-</option>
                        <option value="AB+">AB+</option>
                        <option value="AB-">AB-</option>
                        <option value="O+">O+</option>
                        <option value="O-">O-</option>
                      </select>
                    </label>

                    <label className="patient-field">
                      {t('addressDetails')}

                      <input
                        value={form.addressDetails}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            addressDetails: event.target.value
                          })
                        }
                      />
                    </label>

                    <label className="patient-field">
                      {t('emergencyContact')}

                      <input
                        required
                        value={form.emergencyContact}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            emergencyContact: event.target.value
                          })
                        }
                      />
                    </label>

                    {saveError && (
                      <div
                        className="patient-alert error"
                        role="alert"
                      >
                        {saveError}
                      </div>
                    )}

                    <button
                      className="patient-button patient-profile__submit"
                      disabled={saving}
                    >
                      {saving
                        ? t('loading')
                        : t('save')}
                    </button>
                  </form>
                </ProfileRow>
              </div>
            </section>

            <section className="patient-profile__group-section" aria-labelledby="profile-account-heading">
              <h2 id="profile-account-heading" className="ui-section-label">
                {lang === 'ar' ? 'الحساب' : 'Account'}
              </h2>

              <div className="patient-panel">
                <ProfileRow
                  icon={Lock}
                  title={t('changePassword')}
                  subtitle="••••••••"
                  expanded={openSection === 'password'}
                  onToggle={() => setOpenSection(openSection === 'password' ? null : 'password')}
                >
                  <p className="patient-help-text">{t('passwordChangeSignInAgain')}</p>
                  <form onSubmit={changePassword} className="patient-profile__form">
                    <PasswordField
                      label={t('currentPassword')}
                      autoComplete="current-password"
                      value={passwordForm.currentPassword}
                      onChange={(event) => setPasswordForm({ ...passwordForm, currentPassword: event.target.value })}
                      required
                    />
                    <PasswordField
                      label={t('newPassword')}
                      autoComplete="new-password"
                      value={passwordForm.newPassword}
                      onChange={(event) => setPasswordForm({ ...passwordForm, newPassword: event.target.value })}
                      required
                      minLength={10}
                      maxLength={200}
                      helperText={t('passwordRequirementsSummary')}
                    />
                    <PasswordField
                      label={t('confirmNewPassword')}
                      autoComplete="new-password"
                      value={passwordForm.confirmPassword}
                      onChange={(event) => setPasswordForm({ ...passwordForm, confirmPassword: event.target.value })}
                      required
                      error={Boolean(passwordForm.confirmPassword && passwordForm.newPassword !== passwordForm.confirmPassword)}
                      helperText={passwordForm.confirmPassword && passwordForm.newPassword !== passwordForm.confirmPassword ? t('passwordsDoNotMatch') : undefined}
                    />
                    {passwordChangeError && (
                      <div className="patient-alert error" role="alert">
                        {passwordChangeError}
                      </div>
                    )}
                    <button className="patient-button patient-profile__submit" disabled={passwordChanging}>
                      {passwordChanging ? t('loading') : t('changePassword')}
                    </button>
                  </form>
                </ProfileRow>

                <ProfileRow
                  icon={Link2}
                  title={t('linkedAccounts')}
                  subtitle={data.googleAccount?.linked
                    ? `${t('connected')}: ${data.googleAccount.email}`
                    : t('notConnected')}
                  expanded={openSection === 'linked'}
                  onToggle={() => setOpenSection(openSection === 'linked' ? null : 'linked')}
                  id="linked-accounts-section"
                >
                  <div className="patient-profile__line">
                    <div className="patient-profile__line-main">
                      <strong>{t('googleAccount')}</strong>
                      <p className="patient-profile__sub">
                        {data.googleAccount?.linked
                          ? `${t('connected')}: ${data.googleAccount.email}`
                          : t('notConnected')}
                      </p>
                      <span className={`ui-status ui-status--${data.googleAccount?.linked ? 'ok' : 'muted'}`}>{t(data.googleAccount?.linked ? 'connected' : 'notConnected')}</span>
                    </div>

                    {!data.googleAccount?.linked ? (
                      <button
                        type="button"
                        className="patient-button secondary"
                        onClick={() => {
                          setGoogleLinkOpen((current) => !current);
                          setGoogleLinkError('');
                          setGoogleLinkMessage('');
                          setPendingGoogleCredential(null);
                          setGoogleLinkPassword('');
                        }}
                      >
                        {t('connectGoogle')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="patient-button secondary"
                        onClick={() => {
                          setGoogleUnlinkOpen((current) => !current);
                          setGoogleUnlinkError('');
                          setGoogleUnlinkPassword('');
                        }}
                      >
                        {t('disconnectGoogle')}
                      </button>
                    )}
                  </div>

                  {googleLinkOpen && !data.googleAccount?.linked && (
                    <div className="patient-profile__subform">
                      {!pendingGoogleCredential ? (
                        <div>
                          <p className="patient-help-text">
                            {t('connectGooglePrompt')}
                          </p>
                          <GoogleIdentityButton
                            onCredential={(credential) => {
                              setPendingGoogleCredential(credential);
                              setGoogleLinkError('');
                            }}
                          />
                        </div>
                      ) : (
                        <form onSubmit={handleConfirmGoogleLink} className="patient-profile__form">
                          <p className="patient-help-text">
                            {t('enterPasswordToLink')}
                          </p>
                          <PasswordField label={t('confirmPassword')} autoComplete="current-password" value={googleLinkPassword} onChange={(e) => setGoogleLinkPassword(e.target.value)} required />
                          <div className="patient-profile__actions">
                            <button
                              className="patient-button"
                              disabled={googleLinking || !googleLinkPassword}
                            >
                              {googleLinking ? t('loading') : t('connectGoogle')}
                            </button>
                            <button
                              type="button"
                              className="patient-button secondary"
                              disabled={googleLinking}
                              onClick={() => {
                                setPendingGoogleCredential(null);
                                setGoogleLinkPassword('');
                                setGoogleLinkError('');
                              }}
                            >
                              {t('cancel')}
                            </button>
                          </div>
                        </form>
                      )}

                      {googleLinkError && (
                        <div className="patient-alert error" role="alert">
                          {googleLinkError}
                        </div>
                      )}
                      {googleLinkMessage && (
                        <div className="patient-alert success" role="status">
                          {googleLinkMessage}
                        </div>
                      )}
                    </div>
                  )}

                  {googleUnlinkOpen && data.googleAccount?.linked && (
                    <div className="patient-profile__subform">
                      <form onSubmit={handleConfirmGoogleUnlink} className="patient-profile__form">
                        <p className="patient-help-text">
                          {t('disconnectGoogleConfirm')}
                        </p>
                        <PasswordField label={t('enterPasswordToUnlink')} autoComplete="current-password" value={googleUnlinkPassword} onChange={(e) => setGoogleUnlinkPassword(e.target.value)} required />
                        <div className="patient-profile__actions">
                          <button
                            className="patient-button patient-button--danger"
                            disabled={googleUnlinking || !googleUnlinkPassword}
                          >
                            {googleUnlinking ? t('loading') : t('disconnectGoogle')}
                          </button>
                          <button
                            type="button"
                            className="patient-button secondary"
                            disabled={googleUnlinking}
                            onClick={() => {
                              setGoogleUnlinkOpen(false);
                              setGoogleUnlinkPassword('');
                              setGoogleUnlinkError('');
                            }}
                          >
                            {t('cancel')}
                          </button>
                        </div>
                      </form>
                      {googleUnlinkError && (
                        <div className="patient-alert error" role="alert">
                          {googleUnlinkError}
                        </div>
                      )}
                    </div>
                  )}
                </ProfileRow>
              </div>
            </section>
          </div>
        </div>
      )}
    </State>
  );
}

function ProfileRow({ icon: Icon, title, subtitle, expanded, onToggle, id, children }) {
  return (
    <div className="patient-profile__item">
      <button
        type="button"
        className="patient-row-link"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span className="patient-row-link__content">
          <Icon size={20} strokeWidth={1.8} className="patient-profile__icon" aria-hidden="true" />
          <span className="patient-row-link__text">
            <span className="patient-row-link__title">{title}</span>
            <span className="patient-row-link__subtitle">{subtitle}</span>
          </span>
        </span>
        <ChevronDown size={18} strokeWidth={1.8} className="patient-profile__chevron" aria-hidden="true" />
      </button>

      {expanded && (
        <div id={id} className="patient-profile__body">
          {children}
        </div>
      )}
    </div>
  );
}
