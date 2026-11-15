import { useMemo, useState } from 'react';
import { CacheProvider } from '@emotion/react';
import { IconButton, InputAdornment, TextField } from '@mui/material';
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../app/theme/ThemeContext.jsx';
import { createPatientMuiTheme, patientStyleCaches } from '../utils/patientMuiTheme.js';

/** Password input with an independent, accessible visibility toggle. */
export default function PasswordField({
  label,
  value,
  onChange,
  id,
  name,
  autoComplete = 'current-password',
  required = false,
  minLength,
  maxLength,
  error = false,
  helperText,
  dir,
  fullWidth = true,
  size = 'small',
  variant = 'outlined',
  disabled = false,
  sx,
  inputProps,
  onBlur,
  onFocus,
}) {
  const { t, i18n } = useTranslation();
  const { theme: mode } = useTheme();
  const direction = (i18n.resolvedLanguage || i18n.language || 'en').startsWith('ar') ? 'rtl' : 'ltr';
  const muiTheme = useMemo(() => createPatientMuiTheme(mode, direction), [mode, direction]);
  const [visible, setVisible] = useState(false);
  const [, setFocused] = useState(false);
  const handleFocus = event => { setFocused(true); onFocus?.(event); };
  const handleBlur = event => {
    const control = event.currentTarget.closest('.MuiFormControl-root');
    setFocused(Boolean(control?.contains(event.relatedTarget)));
    onBlur?.(event);
  };
  return (
    <CacheProvider value={patientStyleCaches[direction]}>
      <MuiThemeProvider theme={muiTheme}>
    <TextField
      id={id}
      name={name}
      label={label}
      value={value}
      onChange={onChange}
      type={visible ? 'text' : 'password'}
      autoComplete={autoComplete}
      required={required}
      error={error}
      helperText={helperText}
      fullWidth={fullWidth}
      size={size}
      variant={variant}
      disabled={disabled}
      dir={direction}
      sx={{
        marginBottom: '14px',
        // Match Shifa's regular auth fields (label above, 44px control, 8px radius, 1px
        // outline) while retaining MUI's label, validation and adornment logic.
        '& .MuiInputLabel-root': {
          position: 'static',
          transform: 'none !important',
          display: 'block',
          marginBottom: '6px',
          color: 'var(--color-text-muted)',
          fontSize: '12px',
          fontWeight: 500,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          lineHeight: 'normal',
          '&.Mui-focused': { color: 'var(--color-text-muted)' },
          '&.Mui-error': { color: 'var(--color-danger, var(--auth-error))' },
        },
        '& .MuiInputLabel-asterisk': { marginInlineStart: '0.2em' },
        '& .MuiOutlinedInput-root': {
          boxSizing: 'border-box',
          height: '44px !important',
          minHeight: '44px !important',
          maxHeight: '44px !important',
          borderRadius: 'var(--radius-md, 8px)',
          paddingInline: '14px',
          color: 'var(--color-text, var(--text-primary))',
          backgroundColor: 'var(--color-surface, var(--bg-surface))',
          transition: 'border-color var(--transition, 150ms ease), background-color var(--transition, 150ms ease), box-shadow var(--transition, 150ms ease)',
          '& .MuiOutlinedInput-notchedOutline': {
            top: 0,
            inset: 0,
            borderRadius: 'var(--radius-md, 8px)',
            borderColor: 'var(--color-control-border, var(--border-color))',
            borderWidth: '1px',
            '& legend': {
              display: 'none',
            },
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: 'var(--color-text-muted, var(--text-secondary))',
          },
          '&.Mui-focused': {
            backgroundColor: 'var(--color-surface, var(--bg-card))',
            boxShadow: 'none',
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: 'var(--color-primary, var(--color-primary-action))',
              borderWidth: '2px',
            },
          },
          '&.Mui-error .MuiOutlinedInput-notchedOutline': {
            borderColor: 'var(--color-danger, var(--auth-error))',
          },
          '&.Mui-disabled': {
            backgroundColor: 'var(--color-surface-muted, var(--bg-surface))',
            color: 'var(--color-text-muted, var(--text-secondary))',
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: 'var(--color-border, var(--border-color))',
            },
          },
        },
        '& .MuiOutlinedInput-input': {
          boxSizing: 'border-box',
          minWidth: 0,
          padding: '0 !important',
          height: '100%',
          border: '0 !important',
          borderRadius: 0,
          outline: '0 !important',
          boxShadow: 'none !important',
          backgroundColor: 'transparent !important',
          fontSize: '14px',
          lineHeight: '44px',
          color: 'var(--color-text, var(--text-primary))',
          '&:focus, &:focus-visible, &[aria-invalid="true"]': {
            border: '0 !important',
            outline: '0 !important',
            boxShadow: 'none !important',
            backgroundColor: 'transparent !important',
          },
        },
        '& .MuiInputAdornment-root': {
          marginInline: '4px 0',
          height: '100%',
          maxHeight: 'none',
        },
        '& .MuiIconButton-root': {
          width: 32,
          height: 32,
          padding: '6px',
          color: 'var(--color-text-muted, var(--text-secondary))',
          borderRadius: 'var(--radius-md, 8px)',
          '&:hover': { color: 'var(--color-text, var(--text-primary))', backgroundColor: 'var(--color-surface-muted)' },
          '&:focus-visible': { outline: '2px solid var(--color-primary)', outlineOffset: 1 },
          '&.Mui-disabled': { color: 'var(--color-text-muted, var(--text-secondary))', opacity: 0.55 },
        },
        '& .MuiFormHelperText-root': {
          marginInline: 0,
          marginTop: '4px',
          fontSize: '0.78rem',
          color: 'var(--color-text-muted)',
          '&.Mui-error': {
            color: 'var(--color-danger, var(--auth-error))',
          },
        },
        ...(sx || {}),
      }}
      slotProps={{
        htmlInput: {
          minLength,
          maxLength,
          dir: dir || 'ltr',
          ...inputProps,
          onFocus: handleFocus,
          onBlur: handleBlur,
        },
        inputLabel: { shrink: true },
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                type="button"
                aria-label={visible ? t('hidePassword') : t('showPassword')}
                aria-pressed={visible}
                onClick={() => setVisible(current => !current)}
                onMouseDown={event => event.preventDefault()}
                onMouseUp={event => event.preventDefault()}
                onFocus={() => setFocused(true)}
                onBlur={event => setFocused(Boolean(event.currentTarget.closest('.MuiFormControl-root')?.contains(event.relatedTarget)))}
                disabled={disabled}
              >
                {visible ? <EyeOff size={17} strokeWidth={1.8} aria-hidden="true" /> : <Eye size={17} strokeWidth={1.8} aria-hidden="true" />}
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
      </MuiThemeProvider>
    </CacheProvider>
  );
}
