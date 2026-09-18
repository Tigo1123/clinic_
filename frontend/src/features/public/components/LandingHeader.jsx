import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, HeartPulse, Languages, Menu, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import ThemeToggle from '../../../components/ui/ThemeToggle.jsx';

export default function LandingHeader({ copy, brand, language, onLanguageChange }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const toggleRef = useRef(null);
  const links = [
    ['#home', copy.home],
    ['#features', copy.featuresNav],
    ['#journey', copy.howItWorks],
    ['#about', copy.about]
  ];

  useEffect(() => {
    if (!menuOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const desktopQuery = window.matchMedia('(min-width: 1051px)');
    document.body.style.overflow = 'hidden';
    menuRef.current?.querySelector('a')?.focus();
    const handleResize = () => { if (desktopQuery.matches) setMenuOpen(false); };
    desktopQuery.addEventListener('change', handleResize);

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        toggleRef.current?.focus();
      }
      if (event.key !== 'Tab') return;
      const focusable = [...menuRef.current.querySelectorAll('a, button')];
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
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      desktopQuery.removeEventListener('change', handleResize);
    };
  }, [menuOpen]);

  function closeMenu() { setMenuOpen(false); }
  function closeMenuAndFocus() { closeMenu(); toggleRef.current?.focus(); }
  function changeLanguage() { onLanguageChange(); closeMenu(); }

  return <header className="public-header">
    <div className="public-header__inner">
      <Link className="public-brand" to="/" onClick={closeMenu} aria-label={brand}>
        <span className="public-brand__mark"><HeartPulse aria-hidden="true" /></span>
        <span className="public-brand__name">{brand}</span>
      </Link>
      <nav className="public-nav" aria-label={language === 'ar' ? 'التنقل الرئيسي' : 'Main navigation'}>
        {links.map(([href, label]) => <a key={href} href={href}>{label}</a>)}
      </nav>
      <div className="public-header__actions">
        <ThemeToggle className="public-theme-toggle" size={17} />
        <button className="public-language" type="button" onClick={changeLanguage} aria-label={copy.language} title={copy.language}><Languages aria-hidden="true" /><span>{language === 'ar' ? 'EN' : 'عربي'}</span></button>
        <Link className="public-staff-link" to="/staff">{copy.staffLogin}</Link>
        <Link className="public-button public-button--small public-button--primary public-header__patient" to="/patient-login">{copy.patientLogin}<ArrowUpRight aria-hidden="true" /></Link>
        <button ref={toggleRef} className="public-menu-toggle" type="button" aria-label={menuOpen ? copy.closeMenu : copy.menu} aria-expanded={menuOpen} aria-controls="public-mobile-menu" onClick={() => setMenuOpen(open => !open)}>{menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}<span className="sr-only">Menu</span></button>
      </div>
    </div>
      <button className="public-menu-backdrop" tabIndex={-1} aria-label={copy.closeMenu} onClick={closeMenuAndFocus} hidden={!menuOpen} />
      <div className="public-mobile-menu" id="public-mobile-menu" ref={menuRef} role="dialog" aria-modal="true" aria-label={copy.navigationMenu} hidden={!menuOpen}>
        <nav aria-label={language === 'ar' ? 'قائمة الهاتف' : 'Mobile navigation'}>
          {links.map(([href, label]) => <a key={href} href={href} onClick={closeMenu}>{label}<ArrowUpRight aria-hidden="true" /></a>)}
        </nav>
        <div className="public-mobile-menu__actions">
          <Link to="/patient-login" className="public-button public-button--primary" onClick={closeMenu}>{copy.patientLogin}<ArrowUpRight aria-hidden="true" /></Link>
          <Link to="/staff" className="public-button public-button--outline" onClick={closeMenu}>{copy.staffLogin}<ArrowUpRight aria-hidden="true" /></Link>
          <div className="public-mobile-menu__footer-row">
            <button type="button" className="public-mobile-menu__language" onClick={changeLanguage}><Languages aria-hidden="true" />{copy.language}</button>
            <ThemeToggle className="public-mobile-theme-toggle" size={17} />
          </div>
        </div>
      </div>
  </header>;
}
