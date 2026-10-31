import { useTranslation } from 'react-i18next';
import { useTheme } from '../../app/theme/ThemeContext.jsx';
import { shifaLogoAlternative, shifaLogoAsset } from './shifaLogoAssets.js';
import './shifaLogo.css';

export default function ShifaLogo({ compact = false, responsive = false, className = '' }) {
  const { i18n } = useTranslation();
  const { theme } = useTheme();
  const language = (i18n.resolvedLanguage || i18n.language || 'en').split('-')[0] === 'ar' ? 'ar' : 'en';
  const full = shifaLogoAsset({ language, theme });
  const mark = shifaLogoAsset({ language, theme, compact: true });

  if (compact) return <img className={`shifa-logo shifa-logo--compact ${className}`.trim()} src={mark} alt="" aria-hidden="true" />;
  if (!responsive) return <img className={`shifa-logo ${className}`.trim()} src={full} alt={shifaLogoAlternative(language)} />;
  return <span className={`shifa-logo-responsive ${className}`.trim()} role="img" aria-label={shifaLogoAlternative(language)}>
    <img className="shifa-logo-responsive__full" src={full} alt="" aria-hidden="true" />
    <img className="shifa-logo-responsive__compact" src={mark} alt="" aria-hidden="true" />
  </span>;
}
