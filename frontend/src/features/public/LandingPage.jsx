import { useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import LandingHeader from './components/LandingHeader.jsx';
import LandingHero from './components/LandingHero.jsx';
import { AboutSection, FeatureSection, JourneySection, HowItWorksSection, BenefitsSection, SystemOverview, FinalCTA, LandingFooter } from './components/LandingSections.jsx';
import { landingCopy } from './landingCopy.js';
import { useFacilityBranding } from '../../app/branding/FacilityBrandingContext.js';
import { brandingSubline } from '../../app/branding/brandingConfig.js';
import './public.css';
import './sections.css';

// Keep a reload snapshot from being reapplied on later SPA history returns.
let landingEntryMounted = false;

export default function LandingPage() {
  const firstLandingMount = useRef(!landingEntryMounted);
  const { i18n } = useTranslation();
  const language = (i18n.resolvedLanguage || i18n.language || 'ar').split('-')[0];
  const copy = landingCopy[language] || landingCopy.en;
  const branding = useFacilityBranding();
  const brand = language === 'ar' ? branding.displayNameAr : branding.displayNameEn;
  const facilityName = language === 'ar' ? branding.facilityNameAr : branding.facilityNameEn;
  const descriptor = brandingSubline(branding, language);

  // Keep all landing content mounted and measurable for anchor navigation. Only
  // animate presentation when a section's content approaches the viewport.
  useLayoutEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return undefined;

    const revealTargets = document.querySelectorAll('.public-site [data-scroll-reveal]');
    const pendingTargets = [];
    revealTargets.forEach(target => {
      const rect = target.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top < window.innerHeight) {
        target.dataset.scrollRevealed = 'true';
        return;
      }
      const siblingIndex = Array.prototype.indexOf.call(target.parentElement.children, target);
      target.style.setProperty('--reveal-delay', `${Math.min(Math.max(siblingIndex, 0), 4) * 65}ms`);
      target.dataset.scrollRevealPending = 'true';
      pendingTargets.push(target);
    });

    if (!pendingTargets.length) return undefined;
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.dataset.scrollRevealed = 'true';
        delete entry.target.dataset.scrollRevealPending;
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0 });
    pendingTargets.forEach(target => observer.observe(target));
    return () => observer.disconnect();
  }, []);

  // Resolve initial entries after font metrics settle. Later anchor navigation and
  // history stay native; loading photos never triggers a positioning correction.
  useEffect(() => {
    const initialMount = firstLandingMount.current;
    landingEntryMounted = true;
    const navigation = performance.getEntriesByType('navigation')[0];
    let hash = window.location.hash;
    const reload = initialMount && navigation?.type === 'reload';
    if (reload && hash && window.history.state?.shifaLandingAnchor === hash) {
      // A section selected from this page should not become the refresh entry point.
      // Directly opened hash URLs have no marker and continue to land on their section.
      const state = { ...(window.history.state || {}) };
      delete state.shifaLandingAnchor;
      window.history.replaceState(state, '', `${window.location.pathname}${window.location.search}`);
      hash = '';
    }
    const rememberSectionHash = () => {
      const currentHash = window.location.hash;
      const state = { ...(window.history.state || {}) };
      if (currentHash) state.shifaLandingAnchor = currentHash;
      else delete state.shifaLandingAnchor;
      window.history.replaceState(state, '', window.location.href);
    };
    window.addEventListener('hashchange', rememberSectionHash);
    let active = true;
    let interacted = false;
    const cancelInitialPositioning = () => { interacted = true; };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    events.forEach(event => window.addEventListener(event, cancelInitialPositioning, { passive: true }));
    if (reload && !hash) window.scrollTo({ top: 0, behavior: 'instant' });
    void (async () => {
      await document.fonts?.ready;
      await new Promise(resolve => requestAnimationFrame(resolve));
      events.forEach(event => window.removeEventListener(event, cancelInitialPositioning));
      if (!active) return;
      if (interacted || window.location.hash !== hash) return;
      let target;
      try { if (hash) target = document.getElementById(decodeURIComponent(hash.slice(1))); } catch { return; }
      if (target?.closest('.public-site') && (initialMount || window.scrollY === 0)) target.scrollIntoView({ behavior: 'instant', block: 'start' });
    })();
    return () => {
      active = false;
      events.forEach(event => window.removeEventListener(event, cancelInitialPositioning));
      window.removeEventListener('hashchange', rememberSectionHash);
    };
  }, []);

  return <div className="public-site">
    <a className="public-skip-link" href="#main-content">{copy.skip}</a>
    <LandingHeader copy={copy} brand={brand} facilityName={facilityName} language={language} onLanguageChange={() => i18n.changeLanguage(language === 'ar' ? 'en' : 'ar')} />
    <main id="main-content" tabIndex={-1}>
      <LandingHero copy={copy} />
      <SystemOverview copy={copy} />
      <AboutSection copy={copy} />
      <HowItWorksSection copy={copy} />
      <FeatureSection copy={copy} />
      <JourneySection copy={copy} />
      <BenefitsSection copy={copy} />
      <FinalCTA copy={copy} />
    </main>
    <LandingFooter copy={copy} brand={brand} descriptor={descriptor} facilityName={facilityName} />
  </div>;
}
