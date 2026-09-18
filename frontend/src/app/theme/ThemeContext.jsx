import { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';

const STORAGE_KEY = 'alshifa_theme';
const LEGACY_STORAGE_KEY = 'cms_theme';

const ThemeContext = createContext({
  theme: 'light',
  setTheme: () => {},
  toggleTheme: () => {},
  isDark: false
});

function getInitialTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') {
      return saved;
    }
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch {
    // Ignore storage/media query access errors
  }
  return 'light';
}

function applyThemeToDocument(theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(getInitialTheme);

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  useEffect(() => {
    // Listen to system preference changes only if user hasn't explicitly set a preference
    try {
      const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
      if (saved) return; // User already set an explicit preference
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = (e) => {
        const next = e.matches ? 'dark' : 'light';
        setThemeState(next);
        applyThemeToDocument(next);
      };
      if (media.addEventListener) {
        media.addEventListener('change', listener);
        return () => media.removeEventListener('change', listener);
      }
    } catch {
      // Ignore
    }
  }, []);

  const setTheme = useCallback((nextTheme) => {
    const resolved = nextTheme === 'dark' ? 'dark' : 'light';
    setThemeState(resolved);
    applyThemeToDocument(resolved);
    try {
      localStorage.setItem(STORAGE_KEY, resolved);
      localStorage.setItem(LEGACY_STORAGE_KEY, resolved);
    } catch {
      // Ignore storage errors
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const nextTheme = current === 'dark' ? 'light' : 'dark';
      applyThemeToDocument(nextTheme);
      try {
        localStorage.setItem(STORAGE_KEY, nextTheme);
        localStorage.setItem(LEGACY_STORAGE_KEY, nextTheme);
      } catch {
        // Ignore storage errors
      }
      return nextTheme;
    });
  }, []);

  const value = useMemo(() => ({
    theme,
    setTheme,
    toggleTheme,
    isDark: theme === 'dark'
  }), [theme, setTheme, toggleTheme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
