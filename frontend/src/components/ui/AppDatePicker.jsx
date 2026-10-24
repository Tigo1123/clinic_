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
  const [open, setOpen] = useState(false);
  const muiTheme = useMemo(() => createPatientMuiTheme(mode, direction), [mode, direction]);
  const localeText = useMemo(() => lang === 'ar' ? arabicCalendarText : undefined, [lang]);

  return <CacheProvider value={patientStyleCaches[direction]}>
    <MuiThemeProvider theme={muiTheme}><LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale={lang === 'ar' ? 'ar' : 'en'} localeText={localeText}>
      <DatePicker
        label={label}
        name={name}
        value={parseDateOnly(value)}
        onChange={next => { if (next == null) onChange?.(''); else if (next.isValid()) onChange?.(formatDateOnly(next)); }}
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
          textField: {
            id, required, error: Boolean(error), helperText, fullWidth, size, className,
            onClick: () => { if (!disabled) setOpen(true); },
            sx: {
              '& .MuiInputBase-root': { backgroundColor: 'var(--color-surface)', minHeight: 44 },
              '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--color-border)' },
              '& .MuiInputBase-input': { color: 'var(--color-text)', textAlign: direction === 'rtl' ? 'right' : 'left' },
              '& .MuiInputLabel-root': { color: 'var(--color-text-secondary)' },
              '& .Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--color-primary-action)' },
            },
          },
          htmlInput: { 'aria-label': label, dir: direction },
          popper: {
            dir: direction,
            placement: direction === 'rtl' ? 'bottom-end' : 'bottom-start',
            modifiers: [{ name: 'preventOverflow', options: { boundary: 'viewport', padding: 8 } }],
            sx: {
              zIndex: theme => theme.zIndex.modal + 1,
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

