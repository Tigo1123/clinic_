import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../app/theme/ThemeContext';

const GIS_SCRIPT_ID = 'google-identity-services-script';
const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
let gisScriptPromise;
let initializedClientId;
let activeCredentialConsumer;

function loadGoogleIdentityServices() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return Promise.reject(new Error('Google Identity Services is unavailable.'));
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (gisScriptPromise) return gisScriptPromise;
  gisScriptPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(GIS_SCRIPT_ID);
    const script = existing || document.createElement('script');
    const fail = (message) => {
      script.remove();
      reject(new Error(message));
    };
    const finish = () => window.google?.accounts?.id ? resolve(window.google) : fail('Google Identity Services did not initialize.');
    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', () => fail('Google Identity Services failed to load.'), { once: true });
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
  const { theme } = useTheme();
  const buttonRef = useRef(null);
  const consumerRef = useRef({ callback: onCredential });
  const [state, setState] = useState('loading');
  const clientId = import.meta.env?.VITE_GOOGLE_CLIENT_ID?.trim();
  consumerRef.current.callback = onCredential;

  useEffect(() => {
    let active = true;
    const consumer = consumerRef.current;
    activeCredentialConsumer = consumer;
    if (!clientId) {
      setState('unavailable');
      return () => { active = false; };
    }
    loadGoogleIdentityServices().then((google) => {
      if (!active || !buttonRef.current) return;
      activeCredentialConsumer = consumer;
      if (initializedClientId !== clientId) {
        google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            const callback = activeCredentialConsumer?.callback;
            if (typeof response?.credential === 'string' && response.credential && typeof callback === 'function') callback(response.credential);
          },
        });
        initializedClientId = clientId;
      }
      google.accounts.id.renderButton(buttonRef.current, {
        type: 'standard',
        theme: theme === 'dark' ? 'outline_dark' : 'outline',
        size: 'large',
        text,
        shape: 'rectangular',
        locale: i18n.language,
        width: Math.max(1, Math.min(400, Math.floor(buttonRef.current.clientWidth || 400))),
      });
      setState('ready');
    }).catch(() => { if (active) setState('unavailable'); });
    return () => {
      active = false;
      if (activeCredentialConsumer === consumer) activeCredentialConsumer = undefined;
    };
  }, [clientId, i18n.language, text, theme]);

  if (state === 'unavailable') return <p className={`patient-google-unavailable ${className}`.trim()} role="status">{t('googleSignInUnavailable')}</p>;
  return <div className={`patient-google-button${loading ? ' is-loading' : ''} ${className}`.trim()} aria-busy={state !== 'ready' || loading}><div ref={buttonRef} /></div>;
}
