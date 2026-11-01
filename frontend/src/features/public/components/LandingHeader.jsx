import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Languages, Menu } from 'lucide-react';
import { Link } from 'react-router-dom';
import ThemeToggle from '../../../components/ui/ThemeToggle.jsx';
import ShifaLogo from '../../../components/brand/ShifaLogo.jsx';
import PwaInstallButton from '../../../components/pwa/PwaInstallButton.jsx';

export default function LandingHeader({ copy, brand, facilityName, language, onLanguageChange }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const toggleRef = useRef(null);
  const links = [
    ['#how-it-works', copy.howItWorks],
    ['#features', copy.featuresNav],
    ['#journey', copy.journeyNav],
    ['#about', copy.about],
    ['#why-shifa', copy.whyShifa]
  ];

  useEffect(() => {
    if (!menuOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const desktopQuery = window.matchMedia('(min-width: 1201px)');
    const background = [...document.querySelectorAll('.public-header__inner, .public-site > main, .public-site > footer, .public-skip-link')];
    const previousInert = background.map(node => node.inert);
    background.forEach(node => { node.inert = true; });
    document.body.style.overflow = 'hidden';
    menuRef.current?.querySelector('a')?.focus();
    const handleResize = () => { if (desktopQuery.matches) setMenuOpen(false); };
    desktopQuery.addEventListener('change', handleResize);

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        requestAnimationFrame(() => toggleRef.current?.focus());
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
      background.forEach((node, index) => { node.inert = previousInert[index]; });
      document.removeEventListener('keydown', handleKeyDown);
      desktopQuery.removeEventListener('change', handleResize);
    };
  }, [menuOpen]);

  function closeMenu() { setMenuOpen(false); }
  function closeMenuAndFocus() { closeMenu(); requestAnimationFrame(() => toggleRef.current?.focus()); }
  function changeLanguage() { onLanguageChange(); closeMenuAndFocus(); }
  function navigateToSection(event, href) {
    // Let the dialog release its scroll lock before native fragment navigation.
    // Otherwise the anchor starts scrolling while the page is still locked.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    closeMenu();
    requestAnimationFrame(() => {
      document.querySelector(href)?.focus({ preventScroll: true });
      if (window.location.hash === href) document.querySelector(href)?.scrollIntoView();
      else window.location.hash = href;
    });
  }

  return <header className="public-header">
    <div className="public-header__inner">
      <div className="public-header__brand-group">
        <a className="public-brand" href="#home" onClick={closeMenu} aria-label={brand}>
          <ShifaLogo className="public-brand__logo" />
          {facilityName && <span className="public-brand__facility">{facilityName}</span>}
        </a>
        <PwaInstallButton onInteract={closeMenu} />
      </div>
      <nav className="public-nav" aria-label={language === 'ar' ? 'التنقل الرئيسي' : 'Main navigation'}>
        {links.map(([href, label]) => <a key={href} href={href}>{label}</a>)}
      </nav>
      <div className="public-header__actions">
        <ThemeToggle className="public-theme-toggle" size={17} />
        <button className="public-language" type="button" onClick={changeLanguage} aria-label={copy.language} title={copy.language}><Languages aria-hidden="true" /><span>{language === 'ar' ? 'EN' : 'عربي'}</span></button>
        <Link className="public-staff-link" to="/staff">{copy.staffLogin}</Link>
        <Link className="public-button public-button--small public-button--outline public-header__patient" to="/patient-login">{copy.patientLogin}<ArrowUpRight aria-hidden="true" /></Link>
        <button ref={toggleRef} className="public-menu-toggle" type="button" aria-label={copy.menu} aria-expanded={menuOpen} aria-controls="public-mobile-menu" onClick={() => setMenuOpen(open => !open)}><Menu aria-hidden="true" /></button>
      </div>
    </div>
      <button className="public-menu-backdrop" tabIndex={-1} aria-label={copy.closeMenu} onClick={closeMenuAndFocus} hidden={!menuOpen} />
      <div className="public-mobile-menu" id="public-mobile-menu" ref={menuRef} role="dialog" aria-modal="true" aria-label={copy.navigationMenu} hidden={!menuOpen}>
        <div className="public-mobile-menu__heading"><strong>{copy.navigationMenu}</strong><button type="button" className="public-menu-close" onClick={closeMenuAndFocus}>{copy.closeMenu}</button></div>
        <nav aria-label={language === 'ar' ? 'قائمة الهاتف' : 'Mobile navigation'}>
          {links.map(([href, label]) => <a key={href} href={href} onClick={event => navigateToSection(event, href)}>{label}<ArrowUpRight aria-hidden="true" /></a>)}
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
