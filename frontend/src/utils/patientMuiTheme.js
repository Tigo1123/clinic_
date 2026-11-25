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
      secondary: { main: 'var(--color-secondary)', light: 'var(--color-primary-soft)', dark: 'var(--color-primary)', contrastText: 'var(--color-text)' },
      background: { default: 'var(--color-bg)', paper: 'var(--color-surface)' },
      text: { primary: 'var(--color-text)', secondary: 'var(--color-text-secondary)', disabled: 'var(--color-text-muted)' },
      divider: 'var(--color-border)',
      error: { main: 'var(--color-danger)', light: 'var(--color-danger-soft)', contrastText: 'var(--color-on-danger, #fff)' },
      warning: { main: 'var(--color-warning)', light: 'var(--color-warning-soft)', contrastText: 'var(--color-warning-text-on-soft, #6B3A05)' },
      success: { main: 'var(--color-success)', light: 'var(--color-success-soft)', contrastText: '#fff' },
      info: { main: 'var(--color-info)', light: 'var(--color-primary-soft)', contrastText: '#fff' },
    },
    spacing: 4,
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: direction === 'rtl' ? 'var(--font-ar)' : 'var(--font-en)',
      h1: { fontSize: '1.75rem', fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.25 },
      h2: { fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.3 },
      h3: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.4 },
      body1: { fontSize: '0.9375rem', lineHeight: 1.5 },
      body2: { fontSize: '0.8125rem', lineHeight: 1.5 },
      button: { textTransform: 'none', fontWeight: 600, fontSize: '0.9375rem' },
    },
    components: {
      MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { root: { backgroundImage: 'none', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg, 12px)', boxShadow: 'var(--shadow-sm)' } } },
      MuiCard: { styleOverrides: { root: { borderRadius: 'var(--radius-lg, 12px)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)', backgroundImage: 'none', backgroundColor: 'var(--color-surface)' } } },
      MuiDialog: { styleOverrides: { paper: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg, 12px)', boxShadow: 'var(--shadow-lg)', backgroundColor: 'var(--color-surface)', backgroundImage: 'none' } } },
      MuiDialogTitle: { styleOverrides: { root: { fontWeight: 600, color: 'var(--color-text)', borderBottom: '1px solid var(--color-divider)' } } },
      MuiDialogActions: { styleOverrides: { root: { padding: '14px 20px', borderTop: '1px solid var(--color-divider)', gap: 8 } } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            backgroundColor: 'var(--color-surface)',
            color: 'var(--color-text)',
            borderRadius: 'var(--radius-md, 8px)',
            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--color-control-border)' },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--color-text-secondary)' },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--color-primary-strong)', borderWidth: '2px' },
            '&.Mui-focused': { boxShadow: '0 0 0 3px var(--color-focus-ring)' },
            '&.Mui-disabled': { backgroundColor: 'var(--color-surface-muted)' },
          },
        },
      },
      MuiInputLabel: { styleOverrides: { root: { color: 'var(--color-text-secondary)', fontWeight: 500, '&.Mui-focused': { color: 'var(--color-primary-strong)' } } } },
      MuiTabs: { styleOverrides: { root: { borderBottom: '1px solid var(--color-divider)' }, indicator: { backgroundColor: 'var(--color-primary-action)', height: 2 } } },
      MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600, minHeight: 44, color: 'var(--color-text-muted)', '&.Mui-selected': { color: 'var(--color-primary-strong)' }, '&:focus-visible': { outline: '3px solid var(--color-primary-strong)', outlineOffset: -2 } } } },
      MuiAlert: {
        styleOverrides: {
          root: { borderRadius: 'var(--radius-md, 8px)', border: '1px solid var(--color-border)' },
          standardSuccess: { backgroundColor: 'var(--color-success-soft)', color: 'var(--color-success)', borderColor: 'var(--color-primary-soft-border)' },
          standardWarning: { backgroundColor: 'var(--color-warning-soft)', color: 'var(--color-warning-text-on-soft, var(--color-warning))', borderColor: 'var(--color-warning-soft-border)' },
          standardError: { backgroundColor: 'var(--color-danger-soft)', color: 'var(--color-danger-text-on-soft, var(--color-danger))', borderColor: 'var(--color-danger-soft-border)' },
          standardInfo: { backgroundColor: 'var(--color-primary-soft)', color: 'var(--color-primary-on-soft, var(--color-primary))', borderColor: 'var(--color-primary-soft-border)' },
        },
      },
      MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { minHeight: 44, borderRadius: 'var(--radius-md, 8px)', paddingInline: 18, gap: 8, textTransform: 'none', fontWeight: 600, '&:focus-visible': { outline: '3px solid var(--color-primary-strong)', outlineOffset: 2 } }, contained: { color: '#fff', backgroundColor: 'var(--color-primary-action)', '&:hover': { backgroundColor: 'var(--color-primary-action-hover)' } }, outlined: { borderColor: 'var(--color-control-border)', color: 'var(--color-text)', backgroundColor: 'var(--color-surface)', '&:hover': { backgroundColor: 'var(--color-surface-muted)', borderColor: 'var(--color-text-secondary)' } }, text: { color: 'var(--color-primary-strong)' } } },
      MuiChip: { styleOverrides: { root: { fontFamily: 'inherit', fontWeight: 500, borderRadius: 'var(--radius-pill)', background: 'var(--color-primary-soft)', color: 'var(--color-primary-strong)', border: '1px solid var(--color-primary-soft-border, transparent)' } } },
    },
  });
}
