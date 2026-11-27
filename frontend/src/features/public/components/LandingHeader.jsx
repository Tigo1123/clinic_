import { useEffect, useRef, useState } from 'react';
import { HeartPulse, Languages, Menu, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import ThemeToggle from '../../../components/ui/ThemeToggle.jsx';
import { lockPageScroll } from '../../../utils/scrollLock.js';

export default function LandingHeader({ copy, brand, language, onLanguageChange }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const toggleRef = useRef(null);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const desktopQuery = window.matchMedia('(min-width: 901px)');
    const unlockScroll = lockPageScroll();
    menuRef.current?.querySelector('a')?.focus();
    const handleResize = () => { if (desktopQuery.matches) setMenuOpen(false); };
    desktopQuery.addEventListener('change', handleResize);

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        toggleRef.current?.focus();
      }
      if (event.key !== 'Tab') return;
      const focusable = [...menuRef.current?.querySelectorAll('a, button') ?? []];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      unlockScroll();
      document.removeEventListener('keydown', handleKeyDown);
      desktopQuery.removeEventListener('change', handleResize);
    };
  }, [menuOpen]);

  function closeMenu() { setMenuOpen(false); }
  function closeMenuAndFocus() { closeMenu(); toggleRef.current?.focus(); }
  function changeLanguage() { onLanguageChange(); if (menuOpen) closeMenuAndFocus(); }

  return <header className="public-header">
    <div className="public-header__inner">
      <Link className="public-brand" to="/" onClick={closeMenu} aria-label={brand}>
        <span className="public-brand__mark"><HeartPulse aria-hidden="true" size={16} /></span>
        <span className="public-brand__name">{brand}</span>
      </Link>
      <div className="public-header__actions">
        <a className="public-staff-link" href="#visit">{copy.visit}</a>
        <button className="public-language" type="button" onClick={changeLanguage} disabled={menuOpen} aria-label={copy.language} title={copy.language}>
          <Languages aria-hidden="true" size={16} />
          <span lang={language === 'ar' ? 'en' : 'ar'}>{language === 'ar' ? 'EN' : 'عربي'}</span>
        </button>
        <ThemeToggle className="public-theme-toggle" size={16} />
        <Link className="public-staff-link" to="/staff">{copy.staffLogin}</Link>
        <button ref={toggleRef} className="public-menu-toggle" type="button" aria-label={menuOpen ? copy.closeMenu : copy.menu} aria-expanded={menuOpen} aria-controls="public-mobile-menu" onClick={() => setMenuOpen(open => !open)}>
          {menuOpen ? <X aria-hidden="true" size={20} /> : <Menu aria-hidden="true" size={20} />}
        </button>
      </div>
    </div>
    <button className="public-menu-backdrop" tabIndex={-1} aria-label={copy.closeMenu} onClick={closeMenuAndFocus} hidden={!menuOpen} />
    <div className="public-mobile-menu" id="public-mobile-menu" ref={menuRef} role="dialog" aria-modal="true" aria-label={copy.navigationMenu} hidden={!menuOpen}>
      <nav aria-label={language === 'ar' ? 'قائمة الهاتف' : 'Mobile navigation'}>
        <a href="#visit" onClick={closeMenu}>{copy.visit}</a>
      </nav>
      <div className="public-mobile-menu__actions">
        <Link to="/patient-login" className="ui-button ui-button--primary" onClick={closeMenu}>{copy.patientLogin}</Link>
        <Link to="/staff" className="ui-button ui-button--secondary" onClick={closeMenu}>{copy.staffLogin}</Link>
        <div className="public-mobile-menu__footer-row">
          <button type="button" className="public-mobile-menu__language" onClick={changeLanguage}>
            <Languages aria-hidden="true" size={16} />
            <span>{copy.language}</span>
          </button>
          <ThemeToggle className="public-theme-toggle public-mobile-theme-toggle" size={16} />
        </div>
      </div>
    </div>
  </header>;
}
