import { useEffect, useMemo, useRef, useState } from 'react';
import { CacheProvider } from '@emotion/react';
import { ThemeProvider } from '@mui/material/styles';
import { Alert, Box, Button, Card, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack, Switch, Tab, Tabs, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useTheme } from '../../app/theme/ThemeContext.jsx';
import { createPatientMuiTheme, patientStyleCaches } from '../../utils/patientMuiTheme.js';
import { fetchWithAuth } from '../../services/staffApi';
import { isStaffPasswordValid } from '../../utils/staffPasswordPolicy';
import { clinicCopy, setupPayload } from './clinicSetup.js';
import AdminSchedulePanel from './AdminSchedulePanel';
import PasswordField from '../../components/PasswordField.jsx';

const resources = ['doctors', 'specialties', 'services', 'labs', 'payments', 'insurance'];
const categories = ['CONSULTATION', 'CLINICAL_PROCEDURE', 'RADIOLOGY'];
const endpoints = { insurance: '/api/billing/insurance-companies', doctors: '/api/admin/doctors', specialties: '/api/specialties', services: '/api/admin/catalog/services', labs: '/api/admin/catalog/laboratory-tests', payments: '/api/admin/catalog/payment-methods' };
const blank = { copayPercentage: '20', billingCycleDays: '30', coveredCategories: ['CONSULTATION', 'LABORATORY', 'RADIOLOGY', 'CLINICAL_PROCEDURE'], labelAr: '', labelEn: '', code: '', priceSdg: '', specialtyId: '', username: '', password: '', category: 'CONSULTATION', active: false };
async function request(url, options) {
  const response = await fetchWithAuth(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload?.error?.message || ''), { code: payload?.error?.code });
  return url.startsWith('/api/admin/doctors?') ? { items: payload, total: Number(response.headers.get('X-Total-Count')) } : payload;
}

export default function ClinicSetupPanel({ lang = 'en', t, initialTab = 'doctors' }) {
  const direction = lang === 'ar' ? 'rtl' : 'ltr';
  const copy = clinicCopy[lang === 'ar' ? 'ar' : 'en'];
  const { theme: mode } = useTheme();
  const theme = useMemo(() => createPatientMuiTheme(mode, direction), [mode, direction]);
  const [resource, setResource] = useState(initialTab);
  const [items, setItems] = useState([]);
  const [specialties, setSpecialties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [version, setVersion] = useState(0);
  const [editor, setEditor] = useState(null);
  const [draft, setDraft] = useState(blank);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [scheduleDoctor, setScheduleDoctor] = useState(null);
  const [statusTarget, setStatusTarget] = useState(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const [actionError, setActionError] = useState('');
  const requestVersion = useRef(0);
  useEffect(() => {
    const token = ++requestVersion.current;
    let cancelled = false;
    setLoading(true); setError(''); setItems([]);
    const catalog = resource === 'services' || resource === 'labs' || resource === 'doctors';
    const query = catalog ? `?page=${page}&pageSize=12&search=${encodeURIComponent(search)}${resource === 'labs' ? '&category=LABORATORY' : ''}${status ? `&status=${status}` : ''}` : '';
    Promise.all([request(endpoints[resource] + query), resource === 'doctors' ? request('/api/specialties') : Promise.resolve([])])
      .then(([data, choices]) => {
        if (cancelled || token !== requestVersion.current) return;
        const values = catalog ? data.items : data;
        const filtered = catalog ? values : values.filter(item => {
          const active = resource === 'doctors' ? item.status === 'ACTIVE' && item.account?.status === 'ACTIVE' : item.active ?? item.status === 'ACTIVE';
          return (!status || active === (status === 'ACTIVE')) && [item.code, item.fullNameAr, item.fullNameEn, item.nameAr, item.nameEn, item.labelAr, item.labelEn].some(value => String(value || '').toLocaleLowerCase().includes(search.toLocaleLowerCase()));
        });
        setItems(catalog ? filtered : filtered.slice((page - 1) * 12, page * 12)); setTotal(catalog ? data.total : filtered.length); setSpecialties(choices);
      }).catch(() => { if (!cancelled && token === requestVersion.current) setError(copy.failed); })
      .finally(() => { if (!cancelled && token === requestVersion.current) setLoading(false); });
    return () => { cancelled = true; };
  }, [resource, search, status, page, version, copy.failed]);
  const open = item => {
    setEditor({ item, resource }); setFormError(''); setSuccess('');
    setDraft(item ? { ...blank, copayPercentage: String(item.copayPercentage ?? 20), billingCycleDays: String(item.billingCycleDays ?? 30), coveredCategories: item.coveredCategories || blank.coveredCategories, labelAr: item.fullNameAr || item.nameAr || item.labelAr, labelEn: item.fullNameEn || item.nameEn || item.labelEn, code: item.code || '', priceSdg: String(item.consultationFee ?? item.priceSdg ?? ''), specialtyId: item.specialtyId || '', category: item.category || 'CONSULTATION', active: resource === 'doctors' ? item.status === 'ACTIVE' && item.account?.status === 'ACTIVE' : item.active ?? item.status === 'ACTIVE' } : { ...blank, active: resource === 'specialties' });
  };
  const close = () => { if (!saving) { setEditor(null); setDraft(blank); setFormError(''); setConfirm(false); } };
  const field = (name, label, options = {}) => {
    const Component = options.type === 'password' ? PasswordField : TextField;
    return <Component key={name} name={name} label={label} value={draft[name]} onChange={event => setDraft(current => ({ ...current, [name]: name === 'code' && resource === 'labs' ? event.target.value.normalize('NFKC').toLowerCase() : event.target.value }))} fullWidth required disabled={saving} {...options}/>;
  };
  const submit = event => {
    event.preventDefault();
    if (saving) return;
    const needsPrice = ['doctors', 'services', 'labs'].includes(resource);
    if (!draft.labelAr.trim() || !draft.labelEn.trim() || (needsPrice && (!/^[1-9]\d*$/.test(draft.priceSdg) || Number(draft.priceSdg) > 1_000_000_000)) || (resource === 'doctors' && (!draft.specialtyId || (!editor.item && !isStaffPasswordValid(draft.password))))) { setFormError(copy.invalid); return; }
    setFormError(''); setConfirm(true);
  };
  const save = async () => {
    setSaving(true); setConfirm(false);
    try {
      const editing = Boolean(editor.item);
      const url = resource === 'doctors' && !editing ? '/api/auth/users' : endpoints[resource] + (editing ? `/${resource === 'payments' ? editor.item.code : editor.item.id}` : '');
      await request(url, { method: editing ? (resource === 'insurance' ? 'PUT' : 'PATCH') : 'POST', body: JSON.stringify(setupPayload(resource, draft, editing)) });
      setEditor(null); setDraft(blank); setSuccess(copy.saved); setVersion(value => value + 1);
    } catch (failure) {
      setFormError(['CATALOG_DUPLICATE', 'SPECIALTY_NAME_EXISTS', 'SPECIALTY_CODE_EXISTS', 'USERNAME_ALREADY_REGISTERED'].includes(failure.code) ? (lang === 'ar' ? 'يوجد مدخل بهذا الرمز أو الاسم. عدّل البيانات وحاول مجدداً.' : 'An entry with this code or name already exists. Update the fields and retry.') : copy.saveFailed);
    } finally { setSaving(false); }
  };
  const changeStatus = async () => {
    if (statusSaving) return;
    setStatusSaving(true); setActionError('');
    try {
      await request(`${endpoints.labs}/${statusTarget.id}`, { method: 'PATCH', body: JSON.stringify({ status: statusTarget.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }) });
      setStatusTarget(null); setSuccess(copy.saved); setVersion(value => value + 1);
    } catch { setActionError(copy.saveFailed); setStatusTarget(null); }
    finally { setStatusSaving(false); }
  };
  const labActions = item => <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
    <Button disabled={statusSaving} onClick={() => open(item)}>{copy.edit}</Button>
    <Button disabled={statusSaving} color={item.status === 'ACTIVE' ? 'warning' : 'primary'} onClick={() => {
      if (item.status !== 'ACTIVE' && (item.priceSdg == null || Number(item.priceSdg) <= 0 || !item.code)) { open(item); return; }
      setStatusTarget(item);
    }}>{item.status === 'ACTIVE' ? copy.deactivate : copy.activate}</Button>
  </Stack>;
  return <CacheProvider value={patientStyleCaches[direction]}><ThemeProvider theme={theme}>
    <Stack dir={direction} spacing={4} className="clinic-setup-panel">
      <Typography component="h2" variant="h1">{resource === 'labs' ? copy.labTitle : copy.title}</Typography>
      <Tabs value={resource} variant="scrollable" scrollButtons="auto" aria-label={copy.title} onChange={(_, value) => { setResource(value); setPage(1); setSearch(''); setStatus(''); setSuccess(''); setScheduleDoctor(null); }}>{resources.map(value => <Tab key={value} value={value} label={copy[value]}/>)}</Tabs>
      <Alert severity="info" role="note">{resource === 'doctors' ? copy.scheduleHelp : resource === 'payments' ? copy.paymentHelp : resource === 'insurance' ? copy.insuranceHelp : copy.catalogHelp}</Alert>
      {actionError && <Alert severity="error">{actionError}</Alert>}
      {success && <Alert severity="success">{success}</Alert>}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3}>
        <TextField label={copy.search} value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} fullWidth/>
        <TextField select label={copy.status} value={status} onChange={event => { setStatus(event.target.value); setPage(1); }} slotProps={{ select: { native: true }, inputLabel: { shrink: true } }} sx={{ minWidth: 170 }}><option value="">{copy.all}</option><option value="ACTIVE">{copy.active}</option><option value="INACTIVE">{copy.inactive}</option></TextField>
        {resource !== 'payments' && <Button variant="contained" onClick={() => open(null)} sx={{ flexShrink: 0 }}>{resource === 'labs' ? copy.addTest : `${copy.add} ${copy[resource]}`}</Button>}
      </Stack>
      {loading ? <Box role="status" aria-label={lang === 'ar' ? 'جارٍ التحميل' : 'Loading'}><CircularProgress size={26}/></Box> : error ? <Alert severity="error" action={<Button onClick={() => setVersion(value => value + 1)}>{copy.retry}</Button>}>{error}</Alert> : !items.length ? <Card sx={{ p: 6 }}><Typography>{resource === 'labs' ? (search || status ? copy.noTests : copy.emptyTests) : copy.empty}</Typography></Card> : <>
        {resource === 'labs' && <Box sx={{ display: { xs: 'none', md: 'block' }, minWidth: 0 }}>
          <Table aria-label={copy.labs} sx={{ tableLayout: 'fixed', '& th, & td': { overflowWrap: 'anywhere', px: 2 } }}>
            <TableHead><TableRow>{[copy.code, copy.labelAr, copy.labelEn, copy.price, copy.status, copy.actions].map(label => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead>
            <TableBody>{items.map(item => <TableRow key={item.id}>
              <TableCell><bdi>{item.code || '—'}</bdi></TableCell><TableCell lang="ar" dir="rtl">{item.labelAr}</TableCell><TableCell lang="en" dir="ltr">{item.labelEn}</TableCell>
              <TableCell><bdi>{item.priceSdg == null ? copy.unpriced : `${Number(item.priceSdg).toLocaleString(lang === 'ar' ? 'ar' : 'en')} SDG`}</bdi></TableCell>
              <TableCell><Chip size="small" color={item.status === 'ACTIVE' ? 'success' : 'default'} label={item.status === 'ACTIVE' ? copy.active : copy.inactive}/></TableCell><TableCell>{labActions(item)}</TableCell>
            </TableRow>)}</TableBody>
          </Table>
        </Box>}
        <Box sx={{ display: resource === 'labs' ? { xs: 'grid', md: 'none' } : 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'repeat(2,minmax(0,1fr))' }, gap: 3 }}>{items.map(item => <Card component="article" key={item.id || item.code} sx={{ p: 4, minWidth: 0 }}>
        <Stack spacing={2}>
          <Typography component="h3" variant="h2" sx={{ overflowWrap: 'anywhere' }}>{lang === 'ar' ? item.fullNameAr || item.nameAr || item.labelAr : item.fullNameEn || item.nameEn || item.labelEn}</Typography>
          <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 1 }}><Chip size="small" label={(resource === 'doctors' ? item.status === 'ACTIVE' && item.account?.status === 'ACTIVE' : item.active ?? item.status === 'ACTIVE') ? copy.active : copy.inactive}/>{item.code && <Typography variant="body2"><bdi>{item.code}</bdi></Typography>}{resource === 'doctors' && !item.hasSchedule && <Chip size="small" label={copy.noSchedule}/>}</Stack>
          {resource === 'labs' && <Typography variant="body2" dir={lang === 'ar' ? 'ltr' : 'rtl'} sx={{ overflowWrap: 'anywhere' }}>{lang === 'ar' ? item.labelEn : item.labelAr}</Typography>}
          {resource === 'labs' && item.priceSdg == null && <Typography variant="body2">{copy.unpriced}</Typography>}
          {item.priceSdg != null && <Typography variant="body2">{copy.price}: <bdi>{item.priceSdg}</bdi></Typography>}
          {resource === 'doctors' && <Typography variant="body2">{copy.account}: {item.account?.status === 'ACTIVE' ? copy.active : copy.inactive}</Typography>}
          {resource === 'labs' ? labActions(item) : <Stack direction="row" spacing={2}><Button onClick={() => open(item)}>{copy.edit}</Button>{resource === 'doctors' && <Button onClick={() => setScheduleDoctor(item.id)}>{copy.schedule}</Button>}</Stack>}
        </Stack>
      </Card>)}</Box></>}
      {!loading && total > 12 && <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}><Button disabled={page === 1} onClick={() => setPage(value => value - 1)}>{copy.previous}</Button><Typography><bdi>{page} / {Math.ceil(total / 12)}</bdi></Typography><Button disabled={page * 12 >= total} onClick={() => setPage(value => value + 1)}>{copy.next}</Button></Stack>}
      {scheduleDoctor && <AdminSchedulePanel key={scheduleDoctor} initialDoctorId={scheduleDoctor} lang={lang} t={t}/>}
    </Stack>
    <Dialog open={Boolean(editor)} onClose={close} fullWidth maxWidth="sm" dir={direction} aria-labelledby="clinic-editor-title">
      <Box component="form" onSubmit={submit}><DialogTitle id="clinic-editor-title">{editor?.item ? copy.edit : copy.add} — {copy[resource]}</DialogTitle><DialogContent><Stack spacing={4} sx={{ pt: 2 }}>
        {formError && <Alert severity="error">{formError}</Alert>}
        {field('labelAr', copy.labelAr, { slotProps: { htmlInput: { dir: 'rtl', maxLength: resource === 'specialties' ? 100 : 150 } } })}
        {field('labelEn', copy.labelEn, { slotProps: { htmlInput: { dir: 'ltr', maxLength: resource === 'specialties' ? 100 : 150 } } })}
        {resource !== 'doctors' && resource !== 'payments' && resource !== 'insurance' && field('code', copy.code, { onBlur: () => setDraft(current => ({ ...current, code: current.code.trim() })), slotProps: { htmlInput: { dir: 'ltr', maxLength: 60, pattern: '[a-z0-9]+(-[a-z0-9]+)*' } } })}
        {resource === 'insurance' && <>
          {field('copayPercentage', lang === 'ar' ? 'نسبة مساهمة المريض %' : 'Patient copay %', { type: 'number', slotProps: { htmlInput: { min: 0, max: 100, step: 0.01 } } })}
          {field('billingCycleDays', lang === 'ar' ? 'دورة الفوترة بالأيام' : 'Billing cycle days', { type: 'number', slotProps: { htmlInput: { min: 1, max: 365 } } })}
          {[...categories, 'LABORATORY'].map(category => <FormControlLabel key={category} label={copy[category]} control={<Switch checked={draft.coveredCategories.includes(category)} onChange={event => setDraft(current => ({ ...current, coveredCategories: event.target.checked ? [...current.coveredCategories, category] : current.coveredCategories.filter(value => value !== category) }))} />}/>)}
        </>}
        {resource === 'doctors' && <TextField select label={copy.specialty} value={draft.specialtyId} onChange={event => setDraft(current => ({ ...current, specialtyId: event.target.value }))} fullWidth required disabled={saving} slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}><option value="">{copy.choose}</option>{specialties.filter(item => item.active || item.id === draft.specialtyId).map(item => <option key={item.id} value={item.id} disabled={!item.active}>{lang === 'ar' ? item.nameAr : item.nameEn}</option>)}</TextField>}
        {['doctors', 'services', 'labs'].includes(resource) && field('priceSdg', copy.price, { slotProps: { htmlInput: { inputMode: 'numeric', pattern: '[1-9][0-9]*', dir: 'ltr' } } })}
        {resource === 'services' && <TextField select label={copy.category} value={draft.category} onChange={event => setDraft(current => ({ ...current, category: event.target.value }))} disabled={saving || Boolean(editor?.item)} slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}>{[...categories, ...(draft.category === 'LABORATORY' ? ['LABORATORY'] : [])].map(value => <option key={value} value={value}>{copy[value]}</option>)}</TextField>}
        {resource === 'doctors' && !editor?.item && <>{field('username', copy.username, { type: 'email', autoComplete: 'off' })}{field('password', copy.password, { type: 'password', autoComplete: 'new-password', helperText: copy.passwordHelp })}</>}
        {(resource !== 'doctors' || editor?.item) && <FormControlLabel control={<Switch checked={draft.active} onChange={event => setDraft(current => ({ ...current, active: event.target.checked }))} disabled={saving}/>} label={copy.active}/>}
        {resource === 'doctors' && <Typography variant="body2">{copy.scheduleHelp}</Typography>}
      </Stack></DialogContent><DialogActions><Button onClick={close} disabled={saving}>{copy.cancel}</Button><Button type="submit" variant="contained" disabled={saving}>{copy.save}</Button></DialogActions></Box>
    </Dialog>
    <Dialog open={Boolean(statusTarget)} onClose={() => { if (!statusSaving) setStatusTarget(null); }} fullWidth maxWidth="xs" dir={direction} aria-labelledby="lab-status-title">
      <DialogTitle id="lab-status-title">{statusTarget?.status === 'ACTIVE' ? copy.deactivate : copy.activate}</DialogTitle><DialogContent><Typography>{lang === 'ar' ? statusTarget?.labelAr : statusTarget?.labelEn}</Typography><Typography>{copy.labStatusHelp}</Typography></DialogContent>
      <DialogActions><Button disabled={statusSaving} onClick={() => setStatusTarget(null)}>{copy.cancel}</Button><Button disabled={statusSaving} onClick={changeStatus} variant="contained">{copy.confirm}</Button></DialogActions>
    </Dialog>
    <Dialog open={confirm} onClose={() => setConfirm(false)} fullWidth maxWidth="xs" dir={direction} aria-labelledby="clinic-confirm-title"><DialogTitle id="clinic-confirm-title">{copy.confirm}</DialogTitle><DialogContent><Typography>{copy.confirmText}</Typography></DialogContent><DialogActions><Button onClick={() => setConfirm(false)}>{copy.cancel}</Button><Button onClick={save} variant="contained">{copy.save}</Button></DialogActions></Dialog>
  </ThemeProvider></CacheProvider>;
}
