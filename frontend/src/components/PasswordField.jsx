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
  const [focused, setFocused] = useState(false);
  const handleFocus = event => { setFocused(true); onFocus?.(event); };
  const handleBlur = event => {
    const control = event.currentTarget.closest('.MuiFormControl-root');
    setFocused(Boolean(control?.contains(event.relatedTarget)));
    onBlur?.(event);
  };
  const labelShrink = focused || (typeof value === 'string' ? value.length > 0 : Boolean(value));
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
        // Match Shifa's regular auth fields (48px control, 8px radius, 1px
        // outline) while retaining MUI's label, validation and adornment logic.
        '& .MuiInputLabel-root': {
          color: 'var(--text-secondary, var(--color-text-secondary, #64748b))',
          fontSize: '0.9rem',
          fontWeight: 600,
          lineHeight: 1.45,
          '&.Mui-focused': { color: 'var(--text-secondary, var(--color-text-secondary, #64748b))' },
          '&.Mui-error': { color: 'var(--auth-error, var(--color-danger, #c53030))' },
        },
        '& .MuiInputLabel-asterisk': { marginInlineStart: '0.2em' },
        '& .MuiOutlinedInput-root': {
          boxSizing: 'border-box',
          height: '48px !important',
          minHeight: '48px !important',
          maxHeight: '48px !important',
          borderRadius: '8px',
          paddingInline: '12px',
          color: 'var(--text-primary, var(--color-text, inherit))',
          backgroundColor: 'var(--bg-surface, var(--color-surface, transparent))',
          transition: 'border-color 150ms ease, background-color 150ms ease, box-shadow 150ms ease',
          '& .MuiOutlinedInput-notchedOutline': {
            inset: 0,
            borderRadius: '8px',
            borderColor: 'var(--border-color, var(--color-border, currentColor))',
            borderWidth: '1px',
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: 'var(--text-secondary, var(--color-text-secondary, #64748b))',
          },
          '&.Mui-focused': {
            backgroundColor: 'var(--bg-card, var(--color-surface, transparent))',
            boxShadow: 'none',
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: 'var(--secondary, var(--color-primary-action, #0b72a6))',
              borderWidth: '2px',
            },
          },
          '&.Mui-error .MuiOutlinedInput-notchedOutline': {
            borderColor: 'var(--auth-error, var(--color-danger, #c53030))',
          },
          '&.Mui-disabled': {
            backgroundColor: 'var(--color-surface-muted, var(--bg-surface, transparent))',
            color: 'var(--text-secondary, var(--color-text-secondary, #64748b))',
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: 'var(--border-color, var(--color-border, currentColor))',
            },
          },
        },
        '& .MuiOutlinedInput-input': {
          boxSizing: 'border-box',
          minWidth: 0,
          padding: '0 !important',
          border: '0 !important',
          borderRadius: 0,
          outline: '0 !important',
          boxShadow: 'none !important',
          backgroundColor: 'transparent !important',
          fontSize: '16px',
          lineHeight: 1.45,
          '&:focus, &:focus-visible, &[aria-invalid="true"]': {
            border: '0 !important',
            outline: '0 !important',
            boxShadow: 'none !important',
            backgroundColor: 'transparent !important',
          },
        },
        '& .MuiInputAdornment-root': { marginInline: '4px 0' },
        '& .MuiIconButton-root': {
          width: 32,
          height: 32,
          padding: '6px',
          color: 'var(--text-secondary, var(--color-text-secondary, #64748b))',
          borderRadius: '8px',
          '&:hover': { color: 'var(--text-primary, var(--color-text, #1e293b))', backgroundColor: 'var(--color-surface-muted, rgba(100, 116, 139, 0.1))' },
          '&:focus-visible': { outline: '2px solid var(--secondary, var(--color-primary-action, #0b72a6))', outlineOffset: 1 },
          '&.Mui-disabled': { color: 'var(--text-secondary, var(--color-text-secondary, #64748b))', opacity: 0.55 },
        },
        '& .MuiFormHelperText-root': { marginInline: 0 },
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
        inputLabel: { shrink: labelShrink },
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
