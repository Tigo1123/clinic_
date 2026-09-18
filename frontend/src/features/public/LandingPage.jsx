import { useTranslation } from 'react-i18next';
import LandingHeader from './components/LandingHeader.jsx';
import LandingHero from './components/LandingHero.jsx';
import { FeatureSection, JourneySection, HumanCareSection, ProductPreviewSection, RoleSection, SystemOverview, FinalCTA, LandingFooter } from './components/LandingSections.jsx';
import { landingCopy } from './landingCopy.js';
import './public.css';
import './sections.css';

export default function LandingPage() {
  const { t, i18n } = useTranslation();
  const language = (i18n.resolvedLanguage || i18n.language || 'ar').split('-')[0];
  const copy = landingCopy[language] || landingCopy.en;
  const brand = t('brandName');

  return <div className="public-site">
    <a className="public-skip-link" href="#main-content">{copy.skip}</a>
    <LandingHeader copy={copy} brand={brand} language={language} onLanguageChange={() => i18n.changeLanguage(language === 'ar' ? 'en' : 'ar')} />
    <main id="main-content">
      <LandingHero copy={copy} />
      <SystemOverview copy={copy} />
      <FeatureSection copy={copy} />
      <JourneySection copy={copy} />
      <HumanCareSection copy={copy} />
      <ProductPreviewSection copy={copy} />
      <RoleSection copy={copy} />
      <FinalCTA copy={copy} />
    </main>
    <LandingFooter copy={copy} brand={brand} />
  </div>;
}
