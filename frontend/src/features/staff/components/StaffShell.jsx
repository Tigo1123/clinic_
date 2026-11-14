/**
 * StaffShell – dark left rail + main content area.
 *
 * Renders:
 *   - Rail (desktop) or top bar (< 900px)
 *   - Brand: HeartPulse on mint square + display name + role label
 *   - Nav items registered by the active dashboard via useStaffNav()
 *   - Footer: signed-in user name/role, notifications, security, theme, language, logout
 *
 * RTL: add dir="rtl" to <html>; rail moves to inline-end automatically.
 * Dark theme: inherits [data-theme="dark"] on <html>.
 * Print: .no-print-section hides the rail.
 */
import React, { useState, useCallback, useMemo } from 'react';
import { HeartPulse, ShieldCheck, LogOut } from 'lucide-react';
import ThemeToggle from '../../../components/ui/ThemeToggle';
import NotificationDropdown from './NotificationDropdown';
import { StaffShellContext } from '../staffShellContext';
import './staffShell.css';

export default function StaffShell({
  user,
  displayName,
  lang,
  t,
  onToggleLanguage,
  onLogout,
  onOpenSecurity,
  children,
}) {
  const [nav, setNav] = useState(null);

  const setNavCb = useCallback((nextNav) => {
    setNav(nextNav);
  }, []);

  const ctx = useMemo(() => ({ setNav: setNavCb }), [setNavCb]);

  const items = nav?.items ?? [];
  const activeId = nav?.activeId;
  const onSelect = nav?.onSelect;
  const railRoleLabel = nav?.roleLabel ?? (user?.role ? humanRole(user.role, lang) : '');

  return (
    <StaffShellContext.Provider value={ctx}>
      <div className="staff-shell">
        {/* ── Rail ───────────────────────────────────────────── */}
        <nav
          className="staff-shell__rail no-print-section"
          aria-label={lang === 'ar' ? 'قائمة التنقل' : 'Navigation'}
        >
          {/* Brand */}
          <div className="staff-shell__brand">
            <span className="staff-shell__brand-mark" aria-hidden="true">
              <HeartPulse size={18} strokeWidth={1.8} aria-hidden="true" />
            </span>
            <div className="staff-shell__brand-text">
              <strong className="staff-shell__brand-name">{displayName}</strong>
              {railRoleLabel && (
                <span className="staff-shell__brand-role">{railRoleLabel}</span>
              )}
            </div>
          </div>

          {/* Nav items */}
          {items.length > 0 && (
            <ul className="staff-shell__nav">
              {items.map((item) => {
                const Icon = item.icon;
                const isCurrent = item.id === activeId;
                const accessibleName = item.count != null
                  ? `${item.label} (${item.count})`
                  : item.label;
                return (
                  <li key={item.id} className="staff-shell__nav-item-wrapper">
                    <button
                      type="button"
                      className="staff-shell__nav-item"
                      aria-current={isCurrent ? 'page' : undefined}
                      aria-label={accessibleName}
                      onClick={() => onSelect?.(item.id)}
                    >
                      <span className="staff-shell__nav-item-inner">
                        {Icon && <Icon size={18} strokeWidth={1.8} aria-hidden="true" />}
                        <span className="staff-shell__nav-label">{item.label}</span>
                      </span>
                      {item.count != null && (
                        <span className="staff-shell__nav-count" aria-hidden="true">
                          {item.count}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Footer: user info + controls */}
          <div className="staff-shell__footer">
            {user && (
              <div className="staff-shell__user">
                <span className="staff-shell__user-name">{user.username}</span>
                <span className="staff-shell__user-role">
                  {humanRole(user.role, lang)}
                </span>
              </div>
            )}

            <div className="staff-shell__footer-actions">
              {/* Notifications */}
              {user && !user.mustChangePassword && (
                <NotificationDropdown userId={user.id} lang={lang} />
              )}

              {/* Security settings */}
              {user && !user.mustChangePassword && (
                <button
                  type="button"
                  className="staff-shell__footer-btn"
                  onClick={onOpenSecurity}
                  aria-label={t('securitySettings')}
                  title={t('securitySettings')}
                >
                  <ShieldCheck size={16} aria-hidden="true" />
                </button>
              )}

              {/* Theme toggle */}
              <ThemeToggle
                className="staff-shell__footer-btn"
                size={16}
              />

              {/* Language toggle */}
              <button
                type="button"
                className="staff-shell__footer-btn staff-shell__footer-btn--lang"
                onClick={onToggleLanguage}
                lang={lang === 'ar' ? 'en' : 'ar'}
                aria-label={lang === 'ar' ? 'English' : 'العربية'}
              >
                {lang === 'ar' ? 'English' : 'العربية'}
              </button>

              {/* Logout */}
              <button
                type="button"
                className="staff-shell__footer-btn staff-shell__footer-btn--danger"
                onClick={onLogout}
                aria-label={t('logout')}
                title={t('logout')}
              >
                <LogOut size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        </nav>

        {/* ── Main content ──────────────────────────────────── */}
        <main className="staff-shell__main">
          {children}
        </main>
      </div>
    </StaffShellContext.Provider>
  );
}

/** Map ROLE string to a human-readable label */
function humanRole(role, lang) {
  const map = {
    ADMIN:        { ar: 'مدير النظام',  en: 'Admin' },
    RECEPTIONIST: { ar: 'موظف استقبال', en: 'Reception' },
    DOCTOR:       { ar: 'طبيب',          en: 'Doctor' },
    PHARMACIST:   { ar: 'صيدلي',         en: 'Pharmacist' },
    LAB_TECH:     { ar: 'فني مختبر',    en: 'Lab Tech' },
  };
  const entry = map[role];
  if (!entry) return role;
  return lang === 'ar' ? entry.ar : entry.en;
}
