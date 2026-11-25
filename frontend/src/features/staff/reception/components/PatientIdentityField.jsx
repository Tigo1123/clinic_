import { useId, useState } from 'react';
import { latestBirthDate } from '../../../../utils/patientIdentityValidation.js';

export default function PatientIdentityField({ field, value, onChange, error, t }) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const birthDate = field === 'dateOfBirth';
  const message = error ? t(error) : '';
  const showError = Boolean(message && (touched || value));
  return (
    <div className="reception-form-field">
      <label className="reception-form-label" htmlFor={id}>
        <span className="ui-section-label">{t(field)} *</span>
      </label>
      <input id={id} name={field} required type={birthDate ? 'date' : 'text'}
        dir={field.endsWith('Ar') ? 'rtl' : 'ltr'} className="form-input"
        max={birthDate ? latestBirthDate() : undefined}
        ref={input => { input?.setCustomValidity(message); }}
        value={value} onChange={event => onChange(event.target.value)}
        onBlur={() => setTouched(true)} onInvalid={() => setTouched(true)}
        aria-invalid={showError} aria-describedby={showError ? id + '-error' : undefined} />
      {showError && <span id={id + '-error'} className="field-error">{message}</span>}
    </div>
  );
}
