import { Component } from 'react';
import i18n from '../../i18n.js';

export default class AppErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { if (import.meta.env.DEV) console.error('Application render error', error); }
  render() {
    if (this.state.failed) {
      const isAr = Boolean(i18n?.language && i18n.language.startsWith('ar'));
      return (
        <main className="fatal-error" dir={isAr ? 'rtl' : 'ltr'}>
          <div>
            <h1>{isAr ? 'تعذر عرض هذه الصفحة' : 'We couldn’t display this page'}</h1>
            <p>{isAr ? 'بياناتك بأمان. أعد تحميل الصفحة للمتابعة.' : 'Your information is safe. Reload the page to continue.'}</p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', marginTop: '1.25rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="ui-button ui-button--primary"
                onClick={() => window.location.reload()}
              >
                {isAr ? 'إعادة تحميل التطبيق' : 'Reload application'}
              </button>
              <button
                type="button"
                className="ui-button ui-button--secondary"
                onClick={() => this.setState({ failed: false })}
              >
                {isAr ? 'حاول مرة أخرى' : 'Try again'}
              </button>
            </div>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
