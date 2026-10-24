import { useEffect, useId, useMemo, useState } from 'react';
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
  useEffect(() => { if (!value) setVisible(false); }, [value]);
  const generatedId = useId();
  const fieldId = id || generatedId;
  return (
    <CacheProvider value={patientStyleCaches[direction]}>
      <MuiThemeProvider theme={muiTheme}>
    <div className="shifa-password-field" dir={direction}>
    <label className="shifa-password-label" htmlFor={fieldId}>{label}</label>
    <TextField
      id={fieldId}
      name={name}
      value={value}
      onChange={onChange}
      onFocus={onFocus}
      onBlur={onBlur}
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
        // The fieldset owns the only border; the label stays above the control.
        '& .MuiOutlinedInput-root': {
          boxSizing: 'border-box',
          border: '0 !important',
          height: '50px !important',
          minHeight: '50px !important',
          maxHeight: '50px !important',
          borderRadius: '8px',
          paddingInline: '12px',
          color: 'var(--text-primary, var(--color-text, inherit))',
          backgroundColor: 'var(--bg-surface, var(--color-surface, transparent))',
          transition: 'border-color 150ms ease, background-color 150ms ease, box-shadow 150ms ease',
          '& .MuiOutlinedInput-notchedOutline': {
            inset: 0,
            '& legend': { display: 'none' },
            borderRadius: '8px',
            borderColor: 'var(--color-control-border, var(--border-color, currentColor))',
            borderWidth: '1px',
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: 'var(--text-secondary, var(--color-text-secondary, #64748b))',
          },
          '&.Mui-focused, &:focus-within': {
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
              borderColor: 'var(--color-control-border, var(--border-color, currentColor))',
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
          flexShrink: 0,
          width: 44,
          height: 44,
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
        },
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
                disabled={disabled}
              >
                {visible ? <EyeOff size={17} strokeWidth={1.8} aria-hidden="true" /> : <Eye size={17} strokeWidth={1.8} aria-hidden="true" />}
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
    </div>
      </MuiThemeProvider>
    </CacheProvider>
  );
}
