import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { writeFile, unlink } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';
import { parseDateOnly, formatDateOnly, todayDateOnly } from '../src/utils/dateOnly.js';

test('date-only values remain canonical calendar days without UTC conversion', () => {
  const value = '2013-05-07';
  assert.equal(formatDateOnly(parseDateOnly(value)), value);
  assert.equal(parseDateOnly('2013-02-30'), null);
  assert.equal(parseDateOnly('07/05/2013'), null);
  const originalTimezone = process.env.TZ;
  try {
    for (const timezone of ['UTC', 'Africa/Kigali', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
      process.env.TZ = timezone;
      assert.equal(formatDateOnly(parseDateOnly(value)), value, timezone);
    }
  } finally { if (originalTimezone === undefined) delete process.env.TZ; else process.env.TZ = originalTimezone; }
});

test('shared MUI picker opens from its field, supports keyboard entry, localized layout, theme and viewport collision handling', () => {
  const picker = readFileSync(new URL('../src/components/ui/AppDatePicker.jsx', import.meta.url), 'utf8');
  assert.match(picker, /@mui\/x-date-pickers\/DatePicker/);
  assert.match(picker, /onClick: \(\) => \{ if \(!disabled\) setOpen\(true\); \}/);
  assert.doesNotMatch(picker, /readOnly: true/);
  assert.match(picker, /adapterLocale=\{lang === 'ar' \? 'ar' : 'en'\}/);
  assert.match(picker, /placement: direction === 'rtl' \? 'bottom-end' : 'bottom-start'/);
  assert.match(picker, /preventOverflow/);
  assert.match(picker, /desktopModeMediaQuery="\(min-width: 600px\)"/);
  assert.match(picker, /const fieldHeight = size === 'small' \? 40 : \{ xs: 50, md: 48 \}/);
  assert.match(picker, /openPickerButtonPosition: direction === 'rtl' \? 'start' : 'end'/);
  assert.match(picker, /openPickerButton:\s*\{\s*sx:\s*\{/);
  assert.match(picker, /shrink: true/);
  assert.match(picker, /MuiPickersInputBase-sectionsContainer/);
  assert.match(picker, /MuiPickersOutlinedInput-notchedOutline/);
  assert.match(picker, /var\(--color-surface\)/);
  assert.match(picker, /var\(--color-primary-action\)/);
  assert.match(picker, /arabicCalendarText/);
});

test('DOB fields cap selection at today and use the shared picker', () => {
  const pages = readFileSync(new URL('../src/features/patient-auth/PatientAuthPages.jsx', import.meta.url), 'utf8');
  assert.match(pages, /AppDatePicker id=\{id\} label=\{label\} value=\{value\} onChange=\{onChange\} minDate="1900-01-01" maxDate=\{todayDateOnly\(\)\} size="medium"/);
  assert.equal(parseDateOnly(todayDateOnly())?.format('YYYY-MM-DD'), todayDateOnly());
});

test('all frontend date-only form controls are routed through AppDatePicker', () => {
  const files = [
    '../src/features/admin/AdminSchedulePanel.jsx', '../src/features/admin/AuditLogPanel.jsx',
    '../src/features/appointments/RescheduleAppointment.jsx', '../src/features/doctor/DoctorDashboard.jsx',
    '../src/features/pharmacy/PharmacyDashboard.jsx', '../src/features/pharmacy/PharmacyManagement.jsx',
    '../src/features/reception/ReceptionDashboard.jsx', '../src/features/patient-auth/PatientAuthPages.jsx'
  ];
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /<input\b[^>]*\btype=["']date["']/s, file);
  }
});

test('AppDatePicker field opens its calendar and returns selected dates in canonical format', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true });
  const React = await import('react');
  const { act, createElement } = React;
  const { createRoot } = await import('react-dom/client');
  let componentSource = readFileSync(new URL('../src/components/ui/AppDatePicker.jsx', import.meta.url), 'utf8');
  componentSource = componentSource
    .replace("import 'dayjs/locale/ar';", '')
    .replace(/import \{ CacheProvider \}[^;]+;/, 'const CacheProvider = ({children}) => children;')
    .replace(/import \{ ThemeProvider as MuiThemeProvider \}[^;]+;/, 'const MuiThemeProvider = ({children,theme}) => { globalThis.mockMuiTheme=theme; return children; };')
    .replace(/import \{ DatePicker \}[^;]+;/, 'const DatePicker = props => <div data-open={props.open} data-format={props.format} data-dir={props.slotProps.popper.dir} data-locale={globalThis.mockAdapterLocale} data-button-position={props.slotProps.field.openPickerButtonPosition} data-button-size={props.slotProps.openPickerButton.sx.width} data-label-shrink={props.slotProps.textField.slotProps.inputLabel.shrink}><input aria-label={props.label} onClick={props.onOpen} onKeyDown={event => { if (event.key === "Enter") props.onOpen(); }} /><button type="button" onClick={() => props.onChange(globalThis.mockPickedDate)}>Choose date</button></div>;')
    .replace(/import \{ LocalizationProvider \}[^;]+;/, 'const LocalizationProvider = ({children,adapterLocale}) => { globalThis.mockAdapterLocale=adapterLocale; return children; };')
    .replace(/import \{ AdapterDayjs \}[^;]+;/, 'const AdapterDayjs = {};')
    .replace(/import \{ useTranslation \}[^;]+;/, 'const useTranslation = () => ({i18n:{language:globalThis.mockLanguage}});')
    .replace(/import \{ useTheme as useAppTheme \}[^;]+;/, 'const useAppTheme = () => ({theme:globalThis.mockMode});')
    .replace(/import \{ createPatientMuiTheme, patientStyleCaches \}[^;]+;/, 'const createPatientMuiTheme = (mode,direction) => ({mode,direction}); const patientStyleCaches = {rtl:{},ltr:{}};')
    .replace(/import \{ formatDateOnly, parseDateOnly \}[^;]+;/, `import {formatDateOnly,parseDateOnly} from ${JSON.stringify(new URL('../src/utils/dateOnly.js', import.meta.url).href)};`);
  const componentPath = new URL(`.app-date-picker-${process.pid}.mjs`, import.meta.url);
  await writeFile(componentPath, (await transformWithOxc(componentSource, 'AppDatePicker.jsx', { jsx: { runtime: 'automatic' } })).code);
  let AppDatePicker;
  try { AppDatePicker = (await import(componentPath.href)).default; } finally { await unlink(componentPath); }
  globalThis.mockLanguage = 'ar'; globalThis.mockMode = 'dark';
  globalThis.mockPickedDate = { isValid: () => true, format: () => '2013-05-07' };
  let selected = '';
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(createElement(AppDatePicker, { label: 'تاريخ الميلاد', value: '', onChange: value => { selected = value; } })));
  const input = document.querySelector('input[aria-label="تاريخ الميلاد"]');
  await act(async () => input.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
  assert.equal(document.querySelector('[data-open="true"]')?.dataset.format, 'DD/MM/YYYY');
  assert.equal(document.querySelector('[data-open="true"]')?.dataset.dir, 'rtl');
  assert.equal(document.querySelector('[data-open="true"]')?.dataset.locale, 'ar');
  assert.equal(document.querySelector('[data-open="true"]')?.dataset.buttonPosition, 'start');
  assert.equal(document.querySelector('[data-open="true"]')?.dataset.buttonSize, '40');
  assert.equal(document.querySelector('[data-open="true"]')?.dataset.labelShrink, 'true');
  assert.equal(globalThis.mockMuiTheme.mode, 'dark');
  assert.equal(globalThis.mockMuiTheme.direction, 'rtl');
  await act(async () => document.querySelector('button').click());
  assert.equal(selected, '2013-05-07');
  // An invalid manual edit must clear the canonical form value so a previous
  // valid date cannot silently be submitted instead of the visible edit.
  globalThis.mockPickedDate = { isValid: () => false };
  await act(async () => document.querySelector('button').click());
  assert.equal(selected, '');
  globalThis.mockPickedDate = null;
  await act(async () => document.querySelector('button').click());
  assert.equal(selected, '');
  globalThis.mockLanguage = 'en'; globalThis.mockMode = 'light';
  await act(async () => root.render(createElement(AppDatePicker, { label: 'Date of birth', value: '2013-05-07', onChange: value => { selected = value; } })));
  assert.equal(document.querySelector('[data-format="MM/DD/YYYY"]')?.dataset.dir, 'ltr');
  assert.equal(document.querySelector('[data-format="MM/DD/YYYY"]')?.dataset.buttonPosition, 'end');
  assert.equal(globalThis.mockMuiTheme.mode, 'light');
  await act(async () => root.unmount());
  dom.window.close();
  delete globalThis.mockLanguage; delete globalThis.mockMode; delete globalThis.mockPickedDate; delete globalThis.mockMuiTheme; delete globalThis.mockAdapterLocale;
});
