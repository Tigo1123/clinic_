import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const GIS_SCRIPT_ID = 'google-identity-services-script';
const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
let gisScriptPromise;

function loadGoogleIdentityServices() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return Promise.reject(new Error('Google Identity Services is unavailable.'));
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (gisScriptPromise) return gisScriptPromise;
  gisScriptPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(GIS_SCRIPT_ID);
    const script = existing || document.createElement('script');
    const finish = () => window.google?.accounts?.id ? resolve(window.google) : reject(new Error('Google Identity Services did not initialize.'));
    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', () => reject(new Error('Google Identity Services failed to load.')), { once: true });
    if (!existing) {
      script.id = GIS_SCRIPT_ID;
      script.src = GIS_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  }).catch((error) => { gisScriptPromise = undefined; throw error; });
  return gisScriptPromise;
}

export function GoogleIdentityButton({ onCredential, text = 'continue_with', className = '', loading = false }) {
  const { t, i18n } = useTranslation();
  const buttonRef = useRef(null);
  const initializedRef = useRef(false);
  const [state, setState] = useState('loading');
  const clientId = import.meta.env?.VITE_GOOGLE_CLIENT_ID?.trim();

  useEffect(() => {
    let active = true;
    if (!clientId) {
      setState('unavailable');
      return () => { active = false; };
    }
    loadGoogleIdentityServices().then((google) => {
      if (!active || initializedRef.current || !buttonRef.current) return;
      initializedRef.current = true;
      google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          if (active && typeof response?.credential === 'string' && response.credential) onCredential(response.credential);
        },
      });
      google.accounts.id.renderButton(buttonRef.current, { type: 'standard', theme: 'outline', size: 'large', text, shape: 'rectangular', locale: i18n.language, width: Math.min(400, buttonRef.current.clientWidth || 400) });
      setState('ready');
    }).catch(() => { if (active) setState('unavailable'); });
    return () => { active = false; };
  }, [clientId, i18n.language, onCredential, text]);

  if (state === 'unavailable') return <p className={`patient-google-unavailable ${className}`.trim()} role="status">{t('googleSignInUnavailable')}</p>;
  return <div className={`patient-google-button${loading ? ' is-loading' : ''} ${className}`.trim()} aria-busy={state !== 'ready' || loading}><div ref={buttonRef} />{loading && <span className="patient-google-loading" aria-hidden="true" />}</div>;
}
