import React, { lazy, Suspense, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LogOut,
  HeartPulse,
  Sun,
  Moon
} from 'lucide-react';

import NotificationDropdown from './components/NotificationDropdown';
import { apiRequest } from './services/apiClient';
import { staffSocket as socket } from './services/staffSocket';

import './App.css';

const AdminDashboard = lazy(() => import('./features/admin/AdminDashboard'));
const LaboratoryDashboard = lazy(() => import('./features/laboratory/LaboratoryDashboard'));
const PharmacyDashboard = lazy(() => import('./features/pharmacy/PharmacyDashboard'));
const DoctorDashboard = lazy(() => import('./features/doctor/DoctorDashboard'));
const ReceptionDashboard = lazy(() => import('./features/reception/ReceptionDashboard'));

/**
 * Utility to generate WhatsApp Web click-to-chat links
 */

export default function App({ initialView = 'login' }) {
  const { t, i18n } = useTranslation();
  const [user, setUser] = useState(null);
  const [view, setView] = useState(initialView); // 'portal', 'login', 'dashboard'
  const lang = (i18n.resolvedLanguage || i18n.language || 'ar')
    .split('-')[0];
  const [theme, setTheme] = useState('light');

  // Load state on mount
  useEffect(() => {
    const savedUser = localStorage.getItem('cms_user');
    const savedToken = localStorage.getItem('cms_token');
    const savedTheme = localStorage.getItem('cms_theme') || 'light';

    if (savedUser && savedToken) {
      try { setUser(JSON.parse(savedUser)); setView('dashboard'); }
      catch { localStorage.removeItem('cms_user'); localStorage.removeItem('cms_token'); }
    }
    setTheme(savedTheme);
    document.documentElement.setAttribute('data-theme', savedTheme);

  }, []);

  const toggleLanguage = () => {
    const nextLang = lang === 'ar' ? 'en' : 'ar';
    i18n.changeLanguage(nextLang);
  };

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    localStorage.setItem('cms_theme', nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
  };

  const handleLogin = (userData, token) => {
    localStorage.setItem('cms_user', JSON.stringify(userData));
    localStorage.setItem('cms_token', token);
    setUser(userData);
    setView('dashboard');
  };

  const handleLogout = () => {
    localStorage.removeItem('cms_user');
    localStorage.removeItem('cms_token');
    setUser(null);
    setView(initialView);
    socket.disconnect();
  };

  useEffect(() => {
    if (user && localStorage.getItem('cms_token')) socket.connect();
    return () => socket.disconnect();
  }, [user]);

  return (
    <div className="app-layout">
      {/* Global Navbar */}
      <header className="nav-header no-print-section">
        <div className="brand-section">
          <HeartPulse className="logo-icon" size={28} />
          <span className="brand-title">{t('brandName')}</span>
        </div>
        <div className="header-actions">
          <button className="lang-toggle-btn" onClick={toggleLanguage}>
            {lang === 'ar' ? 'English' : 'العربية'}
          </button>
          <button className="lang-toggle-btn" style={{ padding: '0.5rem' }} onClick={toggleTheme}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {user ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <NotificationDropdown userId={user?.id} lang={lang} />
              <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                {user.username} ({user.role})
              </span>
              <button className="btn btn-secondary" onClick={handleLogout}>
                <LogOut size={16} />
                {t('logout')}
              </button>
            </div>
          ) : <button className="btn btn-secondary" onClick={() => { window.location.href = '/'; }}>{t('patientPortal')}</button>}
        </div>
      </header>

      {/* Main Container */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {view === 'login' && <LoginView onLogin={handleLogin} t={t} />}
        {view === 'dashboard' && user && (
          <DashboardContainer user={user} lang={lang} t={t} />
        )}
      </main>
    </div>
  );
}

/* ==========================================
   PATIENT PUBLIC BOOKING PORTAL
   ========================================== */
function LoginView({ onLogin, t }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const data = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      onLogin(data.user, data.token);
    } catch (err) {
      console.error(err);
      setErrorMsg(err?.status ? err.message : 'Cannot connect to authorization service.');
    }
  };

  return (
    <div className="portal-container glass-panel" style={{ maxWidth: '450px' }}>
      <h3 style={{ textAlign: 'center', marginBottom: '2rem' }}>{t('login')}</h3>
      {errorMsg && (
        <div className="badge badge-danger" style={{ width: '100%', padding: '0.75rem', marginBottom: '1rem' }}>
          {errorMsg}
        </div>
      )}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div className="form-group">
          <label className="form-label">{t('username')}</label>
          <input
            type="email"
            required
            className="form-input"
            placeholder="staff@cms.com"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="form-label">{t('password')}</label>
          <input
            type="password"
            required
            className="form-input"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }}>
          {t('login')}
        </button>
      </form>
    </div>
  );
}

/* ==========================================
   ROLE DASHBOARDS CONTAINER
   ========================================== */
function DashboardContainer({ user, lang, t }) {
  let dashboard;
  if (user.role === 'ADMIN') {
    dashboard = <AdminDashboard lang={lang} t={t} />;
  }
  else if (user.role === 'RECEPTIONIST') {
    dashboard = <ReceptionDashboard lang={lang} t={t} />;
  }
  else if (user.role === 'DOCTOR') {
    dashboard = <DoctorDashboard user={user} lang={lang} t={t} />;
  }
  else if (user.role === 'PHARMACIST') {
    dashboard = <PharmacyDashboard lang={lang} t={t} />;
  }
  else if (user.role === 'LAB_TECH') {
    dashboard = <LaboratoryDashboard lang={lang} />;
  }
  else return (
    <div style={{ padding: '3rem', textAlign: 'center' }}>
      <h3>Unknown User Role. Contact administrator.</h3>
    </div>
  );
  return <Suspense fallback={<div className="portal-loading" role="status"><HeartPulse/><span>{t('loading')}</span></div>}>{dashboard}</Suspense>;
}

/* ==========================================
   1. ADMIN DASHBOARD
   ========================================== */
