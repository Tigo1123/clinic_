import { Component, useEffect, useRef, useState } from 'react';

class PharmacyRenderBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// Use an explicit import state instead of parking this role in Suspense.
// A rejected chunk has a localized recovery action; a pending chunk can be
// cancelled, and a late import cannot remount an abandoned attempt.
export default function PharmacyPage({ lang, t }) {
  const [page, setPage] = useState({ status: 'pending', Dashboard: null });
  const cancel = useRef(() => {});
  useEffect(() => {
    let active = true;
    cancel.current = () => { active = false; setPage({ status: 'error', Dashboard: null }); };
    setPage({ status: 'pending', Dashboard: null });
    import('./PharmacyDashboard').then(
      module => { if (active) setPage({ status: 'success', Dashboard: module.default }); },
      () => { if (active) setPage({ status: 'error', Dashboard: null }); }
    );
    return () => { active = false; };
  }, []);
  // A failed/pending native import is cached for this document. Reload on Retry
  // to discard that module graph and request the current deployment's assets.
  const recoveryStyle = { padding: '2rem', display: 'grid', justifyItems: 'center', gap: '1rem', textAlign: 'center' };
  const error = <section className="pharmacy-page-error" style={recoveryStyle}><p role="alert">{lang === 'ar' ? 'تعذر فتح الصيدلية. أعد المحاولة لتحميل الصفحة من جديد.' : 'Unable to open Pharmacy. Retry to reload the page.'}</p><button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>{lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}</button></section>;
  if (page.status === 'error') return error;
  if (page.status === 'pending') return <section className="pharmacy-page-loading" style={recoveryStyle}><p role="status">{lang === 'ar' ? 'جارٍ فتح الصيدلية…' : 'Opening Pharmacy…'}</p><button type="button" className="btn btn-secondary" onClick={() => cancel.current()}>{lang === 'ar' ? 'إلغاء التحميل' : 'Cancel loading'}</button></section>;
  return <PharmacyRenderBoundary fallback={error}><page.Dashboard lang={lang} t={t} /></PharmacyRenderBoundary>;
}
