import { createTheme } from '@mui/material/styles';
import createCache from '@emotion/cache';
import { prefixer } from 'stylis';
import rtlPlugin from '@mui/stylis-plugin-rtl';

export const patientStyleCaches = {
  ltr: createCache({ key: 'shifa-ltr' }),
  rtl: createCache({ key: 'shifa-rtl', stylisPlugins: [prefixer, rtlPlugin] }),
};

// Native color supports aliases to Shifa's existing CSS tokens; there is no
// separate MUI palette to keep in sync when switching themes.
export function createPatientMuiTheme(mode, direction) {
  return createTheme({
    direction,
    cssVariables: { nativeColor: true, cssVarPrefix: 'shifa-mui' },
    palette: {
      mode,
      primary: { main: 'var(--color-primary-action)', light: 'var(--color-primary-soft)', dark: 'var(--color-primary-action-hover)', contrastText: '#fff' },
      background: { default: 'var(--color-bg)', paper: 'var(--color-surface)' },
      text: { primary: 'var(--color-text)', secondary: 'var(--color-text-secondary)', disabled: 'var(--color-text-secondary)' },
      divider: 'var(--color-border)',
    },
    spacing: 4,
    shape: { borderRadius: 14 },
    typography: {
      fontFamily: direction === 'rtl' ? 'var(--font-ar)' : 'var(--font-en)',
      h1: { fontSize: 'clamp(1.2rem, 1.6vw, 1.6rem)', fontWeight: 750, lineHeight: 1.6 },
      h2: { fontSize: '1rem', fontWeight: 750, lineHeight: 1.6 },
      h3: { fontSize: '.875rem', fontWeight: 700, lineHeight: 1.6 },
      body1: { fontSize: '.875rem', lineHeight: 1.7 },
      body2: { fontSize: '.8rem', lineHeight: 1.7 },
      button: { textTransform: 'none', fontWeight: 700, fontSize: '.85rem' },
    },
    components: {
      MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { root: { backgroundImage: 'none', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' } } },
      MuiCard: { styleOverrides: { root: { borderRadius: 'var(--radius-lg)' } } },
      MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { minHeight: 44, borderRadius: 'var(--radius-sm)', paddingInline: 16, gap: 8, '&:focus-visible': { outline: '3px solid var(--color-primary-strong)', outlineOffset: 3 } }, contained: { color: '#fff', backgroundColor: 'var(--color-primary-action)', '&:hover': { backgroundColor: 'var(--color-primary-action-hover)' } }, text: { color: 'var(--color-primary-strong)' } } },
      MuiChip: { styleOverrides: { root: { fontFamily: 'inherit', fontWeight: 600, background: 'var(--color-primary-soft)', color: 'var(--color-primary-strong)' } } },
    },
  });
}
