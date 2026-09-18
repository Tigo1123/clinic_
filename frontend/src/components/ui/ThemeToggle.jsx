import { Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../app/theme/ThemeContext';

export default function ThemeToggle({ className = '', size = 16, style }) {
  const { theme, toggleTheme } = useTheme();
  const { i18n } = useTranslation();

  const isAr = (i18n.resolvedLanguage || i18n.language || 'ar').startsWith('ar');

  // Labels: If currently dark, clicking switches to light mode; if light, switches to dark mode.
  const label = theme === 'dark'
    ? (isAr ? 'الوضع الفاتح' : 'Light mode')
    : (isAr ? 'الوضع الداكن' : 'Dark mode');

  return (
    <button
      type="button"
      className={`theme-toggle-btn ${className}`.trim()}
      style={style}
      onClick={toggleTheme}
      aria-label={label}
      title={label}
    >
      {theme === 'dark' ? (
        <Sun size={size} aria-hidden="true" />
      ) : (
        <Moon size={size} aria-hidden="true" />
      )}
    </button>
  );
}
