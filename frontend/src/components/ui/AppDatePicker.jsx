import { useMemo, useState } from 'react';
import { CacheProvider } from '@emotion/react';
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { useTranslation } from 'react-i18next';
import 'dayjs/locale/ar';
import { useTheme as useAppTheme } from '../../app/theme/ThemeContext.jsx';
import { createPatientMuiTheme, patientStyleCaches } from '../../utils/patientMuiTheme.js';
import { formatDateOnly, parseDateOnly } from '../../utils/dateOnly.js';

// Both desktop and mobile calendars portal to body, above the app's Dialog.
const pickerOverlayZIndex = 'calc(var(--z-index-dialog, 2000) + 1)';

const arabicCalendarText = {
  openDatePickerDialogue: value => value ? 'تغيير التاريخ المحدد' : 'اختر تاريخًا',
  openTimePickerDialogue: 'اختر الوقت',
  previousMonth: 'الشهر السابق', nextMonth: 'الشهر التالي',
  openPreviousView: 'فتح العرض السابق', openNextView: 'فتح العرض التالي',
  calendarViewSwitchingButtonAriaLabel: view => view === 'year' ? 'عرض السنوات مفتوح، انتقل إلى التقويم' : 'عرض التقويم مفتوح، انتقل إلى السنوات',
  datePickerToolbarTitle: 'اختر التاريخ',
  dateTimePickerToolbarTitle: 'اختر التاريخ والوقت', timePickerToolbarTitle: 'اختر الوقت',
  cancelButtonLabel: 'إلغاء', clearButtonLabel: 'مسح', okButtonLabel: 'موافق', todayButtonLabel: 'اليوم',
  fieldClearLabel: 'مسح', dateTableLabel: 'اختيار التاريخ',
  year: 'السنة', month: 'الشهر', day: 'اليوم', weekDay: 'يوم الأسبوع',
  calendarWeekNumberHeaderLabel: 'رقم الأسبوع', calendarWeekNumberHeaderText: '#',
  calendarWeekNumberAriaLabelText: weekNumber => `الأسبوع ${weekNumber}`,
  calendarWeekNumberText: weekNumber => `${weekNumber}`,
};

/** Date-only MUI picker. Values crossing the component boundary stay YYYY-MM-DD strings. */
export default function AppDatePicker({
  label, value = '', onChange, minDate, maxDate, disabled = false, required = false,
  error = false, helperText, className, name, id, fullWidth = true, size = 'small',
  lang: language,
}) {
  const { i18n } = useTranslation();
  const { theme: mode } = useAppTheme();
  const lang = language || ((i18n.resolvedLanguage || i18n.language || 'en').startsWith('ar') ? 'ar' : 'en');
  const direction = lang === 'ar' ? 'rtl' : 'ltr';
  const fieldHeight = size === 'small' ? 40 : { xs: 50, md: 48 };
  const [open, setOpen] = useState(false);
  const muiTheme = useMemo(() => createPatientMuiTheme(mode, direction), [mode, direction]);
  const localeText = useMemo(() => lang === 'ar' ? arabicCalendarText : undefined, [lang]);

  return <CacheProvider value={patientStyleCaches[direction]}>
    <MuiThemeProvider theme={muiTheme}><LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale={lang === 'ar' ? 'ar' : 'en'} localeText={localeText}>
      <DatePicker
        label={label}
        name={name}
        value={parseDateOnly(value)}
        onChange={next => onChange?.(formatDateOnly(next))}
        minDate={parseDateOnly(minDate)}
        maxDate={parseDateOnly(maxDate)}
        disabled={disabled}
        open={open}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        closeOnSelect
        desktopModeMediaQuery="(min-width: 600px)"
        format={lang === 'ar' ? 'DD/MM/YYYY' : 'MM/DD/YYYY'}
        reduceAnimations
        slotProps={{
          field: { openPickerButtonPosition: direction === 'rtl' ? 'start' : 'end' },
          textField: {
            id, required, error: error || undefined, helperText, fullWidth, size, className,
            onClick: () => { if (!disabled) setOpen(true); },
            slotProps: {
              inputLabel: {
                shrink: true,
                sx: { backgroundColor: 'var(--color-surface)', px: 0.5 },
              },
            },
            sx: {
              '& .MuiPickersInputBase-root': {
                boxSizing: 'border-box',
                height: fieldHeight,
                minHeight: fieldHeight,
                borderRadius: '11px',
                backgroundColor: 'var(--color-surface)',
                direction,
              },
              '& .MuiPickersOutlinedInput-notchedOutline': { borderColor: 'var(--color-control-border)' },
              '& .MuiPickersInputBase-sectionsContainer': {
                minWidth: 0,
                minHeight: 0,
                padding: size === 'small' ? '8px 0' : '10px 0',
                display: 'flex',
                flex: '1 1 auto',
                alignItems: 'center',
                justifyContent: direction === 'rtl' ? 'flex-end' : 'flex-start',
                color: 'var(--color-text)',
                fontSize: '0.93rem',
                lineHeight: 1.4,
                direction,
              },
              '& .MuiPickersInputBase-sectionContent': { lineHeight: 1.4 },
              '& .MuiInputAdornment-root': { marginInline: 0, alignSelf: 'center' },
              '& .MuiInputLabel-root': { color: 'var(--color-text-secondary)' },
              '& .MuiPickersInputBase-root.Mui-focused .MuiPickersOutlinedInput-notchedOutline': { borderColor: 'var(--color-primary-action)', borderWidth: 2 },
              '& .MuiPickersInputBase-root.Mui-error .MuiPickersOutlinedInput-notchedOutline': { borderColor: 'var(--color-danger)' },
            },
          },
          htmlInput: { 'aria-label': label, dir: direction },
          openPickerButton: {
            sx: {
              width: 40,
              height: 40,
              minWidth: 40,
              minHeight: 40,
              padding: 1,
              flexShrink: 0,
              color: 'var(--color-text-secondary)',
            },
          },
          dialog: { dir: direction, sx: { zIndex: pickerOverlayZIndex } },
          popper: {
            dir: direction,
            placement: direction === 'rtl' ? 'bottom-end' : 'bottom-start',
            modifiers: [{ name: 'preventOverflow', options: { boundary: 'viewport', padding: 8 } }],
            sx: {
              zIndex: pickerOverlayZIndex,
              '& .MuiPaper-root': { backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg)' },
              '& .MuiPickersDay-root': { color: 'var(--color-text)' },
              '& .MuiPickersDay-root.Mui-selected': { color: '#fff', backgroundColor: 'var(--color-primary-action)' },
              '& .MuiPickersDay-root:hover': { backgroundColor: 'var(--color-primary-soft)' },
              '& .MuiPickersCalendarHeader-label, & .MuiDayCalendar-weekDayLabel': { color: 'var(--color-text)' },
              '& .MuiIconButton-root': { color: 'var(--color-text)' },
            },
          },
        }}
        sx={{ width: fullWidth ? '100%' : undefined, minWidth: 0 }}
      />
    </LocalizationProvider></MuiThemeProvider>
  </CacheProvider>;
}

