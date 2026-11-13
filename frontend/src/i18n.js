import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from './locales/ar.js';
import en from './locales/en.js';

const resources = {
  ar: {
    translation: ar
  },
  en: {
    translation: en
  }
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: (() => { try { const saved = localStorage.getItem('shifa_language'); return ['ar', 'en'].includes(saved) ? saved : 'ar'; } catch { return 'ar'; } })(),
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false
    }
  });

i18n.on('languageChanged', (language) => { try { localStorage.setItem('shifa_language', language.startsWith('ar') ? 'ar' : 'en'); } catch { /* Storage can be unavailable in private browsing. */ } });

export default i18n;
