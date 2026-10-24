import { useEffect, useMemo, useRef, useState } from 'react';
import { CacheProvider } from '@emotion/react';
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import { Alert, Box, Button, Card, Chip, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Grid, IconButton, InputAdornment, Menu, MenuItem, Skeleton, Stack, TextField, Typography, useMediaQuery } from '@mui/material';
import { MoreVertical, Plus, Search, X } from 'lucide-react';
import PasswordField from '../../components/PasswordField.jsx';
import { useTheme } from '../../app/theme/ThemeContext.jsx';
import { createPatientMuiTheme, patientStyleCaches } from '../../utils/patientMuiTheme.js';
import { useStaffPagedList } from '../../hooks/useStaffPagedList.js';
import { fetchWithAuth } from '../../services/staffApi';
import { filterStaffUsers } from '../../utils/staffRoles.js';
import { buildStaffCreationPayload } from '../../utils/staffCreationPayload.js';
import { getStaffPasswordChecks, isStaffPasswordValid, STAFF_PASSWORD_MAX_LENGTH } from '../../utils/staffPasswordPolicy.js';
import { staffCopy, staffRoles, staffErrorMessage } from './staffMessages.js';
import './staffAccounts.css';

const emptyDraft = () => ({ username: '', password: '', role: 'RECEPTIONIST', fullNameAr: '', fullNameEn: '', specialtyId: '', consultationFee: '' });
const emptyReset = () => ({ newPassword: '', confirmPassword: '', currentAdminPassword: '', mfaCode: '' });
function PasswordRules({ value, text }) {
  const checks = getStaffPasswordChecks(value);
  return <Box role="list" aria-label={text.password} sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
    {Object.entries(checks).map(([key, valid]) => <Typography role="listitem" key={key} variant="caption" color={valid && value ? 'success.main' : 'text.secondary'}>{valid && value ? '✓ ' : '· '}{text[key]}</Typography>)}
    <Typography variant="caption" color="text.secondary">{text.symbols}</Typography>
  </Box>;
}
export default function StaffAccountsPanel({ user, lang, specialties = [] }) {
  const text = staffCopy[lang === 'ar' ? 'ar' : 'en'];
  const direction = lang === 'ar' ? 'rtl' : 'ltr';
  const { theme: mode } = useTheme();
  const theme = useMemo(() => createPatientMuiTheme(mode, direction), [mode, direction]);
  const desktop = useMediaQuery('(min-width:900px)');
  const wide = useMediaQuery('(min-width:1200px)');
  const [search, setSearch] = useState(''); const [debouncedSearch, setDebouncedSearch] = useState('');
  const [role, setRole] = useState(''); const [status, setStatus] = useState('');
  useEffect(() => { const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250); return () => clearTimeout(timer); }, [search]);
  const query = new URLSearchParams({ ...(debouncedSearch ? { search: debouncedSearch } : {}), ...(role ? { role } : {}), ...(status ? { status } : {}) }).toString();
  const list = useStaffPagedList(`/api/auth/users${query ? `?${query}` : ''}`);
  const rows = filterStaffUsers(list.data).filter(row => row.status !== 'DELETED' && (!role || row.role === role) && (!status || row.status === status) && row.username.toLowerCase().includes(search.trim().toLowerCase()));
  const [draft, setDraft] = useState(emptyDraft);
  const [passwordRevision, setPasswordRevision] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const toggleCreate = () => {
    if (showCreate) setDraft(current => ({ ...current, password: '' }));
    setShowCreate(current => !current);
  };
  const [createError, setCreateError] = useState(''); const [feedback, setFeedback] = useState('');
  const [pending, setPending] = useState(null); const mutation = useRef(false);
  const [menu, setMenu] = useState(null); const [dialog, setDialog] = useState(null);
  const [actionError, setActionError] = useState(''); const [actionCode, setActionCode] = useState('');
  const [reset, setReset] = useState(emptyReset);
  const update = (field, value) => setDraft(current => ({ ...current, [field]: value }));
  const updateReset = (field, value) => setReset(current => ({ ...current, [field]: value }));
  const busy = Boolean(pending);
  const closeDialog = () => { if (mutation.current) return; setDialog(null); setActionError(''); setActionCode(''); setReset(emptyReset()); };
  const openAction = (kind, target) => { setMenu(null); setActionError(''); setActionCode(''); setReset(emptyReset()); setDialog({ kind, target }); };
  const create = async event => {
    event.preventDefault();
    if (mutation.current || list.loading) return;
    setPasswordRevision(revision => revision + 1);
    setCreateError(''); setFeedback('');
    if (!isStaffPasswordValid(draft.password)) { setCreateError(text.invalidPassword); return; }
    if (!event.currentTarget.checkValidity()) { setCreateError(text.invalidForm); return; }
    mutation.current = true; setPending('create');
    try {
      const response = await fetchWithAuth('/api/auth/users', { method: 'POST', body: JSON.stringify(buildStaffCreationPayload({ ...draft, username: draft.username.trim(), preferredLanguage: lang === 'ar' ? 'ar' : 'en' })) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setCreateError(staffErrorMessage(data, lang, response.status)); return; }
      setDraft(emptyDraft());
      list.setData(current => [data.user, ...current.filter(row => row.id !== data.user.id)]);
      setFeedback(text.created);
    } catch { setCreateError(text.network); }
    finally { mutation.current = false; setPending(null); }
  };
  const performAction = async event => {
    event.preventDefault();
    if (!dialog || mutation.current || list.loading) return;
    setActionError(''); setActionCode('');
    if (dialog.kind === 'reset') {
      setPasswordRevision(revision => revision + 1);
      if (!isStaffPasswordValid(reset.newPassword)) { setActionError(text.invalidPassword); return; }
      if (reset.newPassword !== reset.confirmPassword) { setActionError(text.mismatch); return; }
      if (!event.currentTarget.checkValidity()) { setActionError(text.invalidForm); return; }
    }
    const { target, kind } = dialog;
    mutation.current = true; setPending('action');
    try {
      const base = `/api/auth/users/${encodeURIComponent(target.id)}`;
      const options = kind === 'delete' ? { method: 'DELETE' } : kind === 'reset' ? { method: 'POST', body: JSON.stringify({ newPassword: reset.newPassword, currentAdminPassword: reset.currentAdminPassword, ...(user?.mfaEnabled ? { mfaCode: reset.mfaCode } : {}) }) } : kind === 'revoke' ? { method: 'POST' } : { method: 'PUT', body: JSON.stringify({ status: kind === 'disable' ? 'INACTIVE' : 'ACTIVE' }) };
      const response = await fetchWithAuth(base + (kind === 'delete' ? '' : kind === 'reset' ? '/reset-password' : kind === 'revoke' ? '/revoke-sessions' : '/status'), options);
      const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
      if (!response.ok) { setActionError(staffErrorMessage(data, lang, response.status)); setActionCode(data?.error?.code || ''); return; }
      if (kind === 'delete') list.setData(current => current.filter(row => row.id !== target.id));
      else if (kind === 'disable' || kind === 'enable') list.setData(current => current.map(row => row.id === target.id ? { ...row, status: kind === 'disable' ? 'INACTIVE' : 'ACTIVE' } : row));
      setDialog(null); setReset(emptyReset());
      setFeedback(kind === 'delete' ? text.deleted : kind === 'reset' ? text.resetDone : kind === 'revoke' ? text.revoked : text.saved);
      // Removing a matching row shifts offset pages. Refill loaded pages so
      // the next Load more cannot skip the former first row of the next page.
      if (list.hasMore && (kind === 'delete' || (status && (kind === 'disable' || kind === 'enable')))) await list.reload();
    } catch { setActionError(text.network); }
    finally {
      setReset(current => ({ ...current, currentAdminPassword: '', mfaCode: '' }));
      mutation.current = false; setPending(null);
    }
  };
  const statusChip = row => <Chip size="small" label={row.status === 'ACTIVE' ? text.active : text.inactive} sx={{ bgcolor: row.status === 'ACTIVE' ? 'success.light' : 'action.hover', color: row.status === 'ACTIVE' ? 'success.dark' : 'text.secondary' }}/>;
  const roleChip = row => <Chip size="small" variant="outlined" label={text[row.role]} sx={{ height: 'auto', minHeight: 26, maxWidth: '100%', '& .MuiChip-label': { whiteSpace: 'normal', py: 1 } }}/>;
  const actions = row => <IconButton type="button" aria-label={`${text.more}: ${row.username}`} aria-haspopup="menu" disabled={busy || list.loading || row.id === user?.id} onClick={event => setMenu({ anchor: event.currentTarget, target: row })} sx={{ width: 44, height: 44 }}><MoreVertical size={20}/></IconButton>;
  const input = (field, label, props = {}) => <TextField fullWidth size="small" label={label} value={draft[field]} onChange={event => update(field, event.target.value)} disabled={busy} {...props}/>;
  const dialogTitle = dialog ? text[`${dialog.kind}Title`] : '';

  return <CacheProvider value={patientStyleCaches[direction]}><MuiThemeProvider theme={theme}>
    <Box className="staff-accounts-panel" dir={direction} sx={{ maxWidth: 1440, mx: 'auto', width: '100%', minWidth: 0, overflowWrap: 'anywhere' }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 3, mb: 4 }}>
        <Box><Typography component="h2" variant="h5" fontWeight={750}>{text.title}</Typography><Typography variant="body2" color="text.secondary">{text.subtitle}</Typography></Box>
        {!wide && <Button type="button" startIcon={showCreate ? <X size={18}/> : <Plus size={18}/>} onClick={toggleCreate} aria-expanded={showCreate} aria-controls="staff-create-body">{showCreate ? text.closeForm : text.add}</Button>}
      </Stack>
      {feedback && <Alert severity="success" role="status" sx={{ mb: 3 }}>{feedback}</Alert>}
      <Grid container spacing={4} sx={{ alignItems: 'flex-start' }}>
        <Grid size={{ xs: 12, lg: 8 }} sx={{ minWidth: 0, order: { xs: 1, lg: 0 } }}>
          <Card component="section" variant="outlined" aria-labelledby="staff-directory-title" sx={{ p: { xs: 3, sm: 4 }, minWidth: 0 }}>
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 2, mb: 4 }}><Typography component="h3" variant="subtitle1" fontWeight={700} id="staff-directory-title">{text.directory}</Typography><Typography variant="caption" color="text.secondary">{rows.length}{list.hasMore ? '+' : ''} {text.count}{list.hasMore ? ` · ${text.loaded}` : ''}</Typography></Stack>
            <Grid container spacing={3} sx={{ mb: 4 }}>
              <Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth size="small" label={text.search} type="search" value={search} disabled={busy} onChange={event => setSearch(event.target.value)} slotProps={{ htmlInput: { dir: 'ltr', maxLength: 254 }, input: { startAdornment: <InputAdornment position="start"><Search size={18}/></InputAdornment> } }}/></Grid>
              <Grid size={{ xs: 6, sm: 3 }}><TextField fullWidth size="small" select label={text.role} value={role} disabled={busy} onChange={event => setRole(event.target.value)} slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}><option value="">{text.allRoles}</option>{staffRoles.map(value => <option key={value} value={value}>{text[value]}</option>)}</TextField></Grid>
              <Grid size={{ xs: 6, sm: 3 }}><TextField fullWidth size="small" select label={text.status} value={status} disabled={busy} onChange={event => setStatus(event.target.value)} slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}><option value="">{text.allStatuses}</option><option value="ACTIVE">{text.active}</option><option value="INACTIVE">{text.inactive}</option></TextField></Grid>
            </Grid>
            {list.error && <Alert severity="error" role="alert" action={<Button type="button" onClick={list.reload} disabled={list.loading}>{text.retry}</Button>}>{text.loadError}</Alert>}
            {list.loading && !list.data.length ? <Box role="status" aria-label={text.loading}>{[0, 1, 2].map(key => <Skeleton key={key} height={64}/>)}</Box> : !rows.length && !list.error ? <Typography sx={{ py: 6 }} color="text.secondary">{search || role || status ? text.noResults : text.empty}</Typography> : desktop ? <Box component="table" className="staff-directory-table" sx={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
              <thead><tr><th>{text.username}</th><th style={{ width: '24%' }}>{text.role}</th><th style={{ width: '18%' }}>{text.status}</th><th style={{ width: 52 }}><span className="staff-visually-hidden">{text.more}</span></th></tr></thead>
              <tbody>{rows.map(row => <tr key={row.id} data-staff-id={row.id}><td><bdi dir="ltr">{row.username}</bdi>{row.id === user?.id && <Typography variant="caption" component="div" color="text.secondary">{text.you}</Typography>}</td><td>{roleChip(row)}</td><td>{statusChip(row)}</td><td>{actions(row)}</td></tr>)}</tbody>
            </Box> : <Stack divider={<Divider/>}>{rows.map(row => <Box key={row.id} data-staff-id={row.id} sx={{ py: 3 }}>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 2 }}><Typography variant="body2" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}><bdi dir="ltr">{row.username}</bdi>{row.id === user?.id && <Typography component="span" variant="caption" sx={{ mx: 2 }}>{text.you}</Typography>}</Typography>{actions(row)}</Stack>
              <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', rowGap: 2 }}>{roleChip(row)}{statusChip(row)}</Stack>
            </Box>)}</Stack>}
            {list.hasMore && <Button type="button" onClick={list.loadMore} disabled={list.loading || busy} sx={{ mt: 3 }}>{list.loading ? text.loading : text.loadMore}</Button>}
          </Card>
        </Grid>
        <Grid size={{ xs: 12, lg: 4 }} sx={{ minWidth: 0, order: { xs: 0, lg: 1 } }}>
          <Card component="section" variant="outlined" aria-labelledby="staff-create-title" sx={{ p: 4 }}>
            <Typography component="h3" variant="subtitle1" fontWeight={700} id="staff-create-title">{text.add}</Typography>
            <Collapse in={wide || showCreate} unmountOnExit timeout={0}>
              <Box component="form" id="staff-create-body" onSubmit={create} noValidate sx={{ mt: 4 }}>
                <Stack spacing={4}>
                  {createError && <Alert severity="error" role="alert">{createError}</Alert>}
                  {input('username', text.username, { type: 'email', required: true, autoComplete: 'off', slotProps: { htmlInput: { dir: 'ltr', maxLength: 254 } } })}
                  <PasswordField required key={`create-${passwordRevision}`} id="staff-create-password" autoComplete="new-password" maxLength={STAFF_PASSWORD_MAX_LENGTH} label={text.password} value={draft.password} onChange={event => update('password', event.target.value)} disabled={busy}/>
                  <PasswordRules value={draft.password} text={text}/>
                  {input('role', text.role, { select: true, slotProps: { select: { native: true }, inputLabel: { shrink: true } }, children: staffRoles.map(value => <option key={value} value={value}>{text[value]}</option>) })}
                  {draft.role === 'DOCTOR' && <>
                    {input('fullNameAr', text.fullNameAr, { required: true, slotProps: { htmlInput: { dir: 'rtl', maxLength: 150 } } })}
                    {input('fullNameEn', text.fullNameEn, { required: true, slotProps: { htmlInput: { dir: 'ltr', maxLength: 150 } } })}
                    {input('specialtyId', text.specialty, { select: true, required: true, slotProps: { select: { native: true }, inputLabel: { shrink: true } }, children: [<option key="" value="">{text.chooseSpecialty}</option>, ...specialties.filter(item => item.active).map(item => <option key={item.id} value={item.id}>{lang === 'ar' ? item.nameAr : item.nameEn}</option>)] })}
                    {input('consultationFee', text.fee, { required: true, type: 'number', slotProps: { htmlInput: { min: 1, max: 1000000000, step: 1 } } })}
                  </>}
                  <Button type="submit" variant="contained" fullWidth disabled={busy || list.loading} aria-busy={pending === 'create'}>{pending === 'create' ? text.creating : text.create}</Button>
                </Stack>
              </Box>
            </Collapse>
          </Card>
        </Grid>
      </Grid>
      <Menu className="staff-action-menu" open={Boolean(menu)} anchorEl={menu?.anchor} onClose={() => setMenu(null)} dir={direction} anchorOrigin={{ vertical: 'bottom', horizontal: direction === 'rtl' ? 'left' : 'right' }} transformOrigin={{ vertical: 'top', horizontal: direction === 'rtl' ? 'left' : 'right' }} slotProps={{ paper: { sx: { maxWidth: 'calc(100vw - 32px)' } } }}>
        <MenuItem onClick={() => openAction('reset', menu.target)}>{text.reset}</MenuItem>
        {menu?.target.status === 'ACTIVE' && <MenuItem onClick={() => openAction('revoke', menu.target)}>{text.revoke}</MenuItem>}
        <MenuItem onClick={() => openAction(menu.target.status === 'ACTIVE' ? 'disable' : 'enable', menu.target)}>{menu?.target.status === 'ACTIVE' ? text.disable : text.enable}</MenuItem>
        <Divider/><MenuItem onClick={() => openAction('delete', menu.target)} sx={{ color: 'error.main' }}>{text.delete}</MenuItem>
      </Menu>
      <Dialog className="staff-action-dialog" open={Boolean(dialog)} onClose={closeDialog} dir={direction} fullWidth maxWidth="sm" slotProps={{ paper: { sx: { m: 2, width: 'calc(100% - 16px)', overflowWrap: 'anywhere' } } }} aria-labelledby="staff-action-title" aria-describedby="staff-action-description">
        <DialogTitle id="staff-action-title">{dialogTitle}</DialogTitle>
        <Box component="form" onSubmit={performAction} noValidate>
          <DialogContent>
            <Stack spacing={4}>
              <Typography id="staff-action-description" variant="body2">{dialog ? text[`${dialog.kind}Description`] : ''}</Typography>
              <Typography variant="body2"><bdi dir="ltr">{dialog?.target.username}</bdi></Typography>
              {actionError && <Alert role="alert" severity="error">{actionError}</Alert>}
              {dialog?.kind === 'reset' && <>
                <PasswordField required key={`new-password-${passwordRevision}`} id="staff-reset-new-password" autoComplete="new-password" maxLength={STAFF_PASSWORD_MAX_LENGTH} label={text.newPassword} value={reset.newPassword} onChange={event => updateReset('newPassword', event.target.value)} disabled={busy}/>
                <PasswordRules value={reset.newPassword} text={text}/>
                <PasswordField required key={`confirm-password-${passwordRevision}`} id="staff-reset-confirm-password" autoComplete="new-password" maxLength={STAFF_PASSWORD_MAX_LENGTH} label={text.confirmPassword} value={reset.confirmPassword} onChange={event => updateReset('confirmPassword', event.target.value)} disabled={busy}/>
                <PasswordField required key={`admin-password-${passwordRevision}`} id="staff-reset-admin-password" maxLength={STAFF_PASSWORD_MAX_LENGTH} label={text.adminPassword} value={reset.currentAdminPassword} onChange={event => updateReset('currentAdminPassword', event.target.value)} disabled={busy} autoComplete="current-password"/>
                {user?.mfaEnabled && <TextField id="staff-reset-mfa-code" fullWidth size="small" label={text.mfa} required value={reset.mfaCode} disabled={busy} onChange={event => updateReset('mfaCode', event.target.value.replace(/\D/g, '').slice(0, 6))} autoComplete="one-time-code" slotProps={{ htmlInput: { inputMode: 'numeric', pattern: '[0-9]{6}', dir: 'ltr' } }}/>}
              </>}
            </Stack>
          </DialogContent>
          <DialogActions sx={{ p: 4, gap: 2, flexWrap: 'wrap' }}>
            <Button type="button" disabled={busy} onClick={closeDialog}>{text.cancel}</Button>
            {actionCode === 'STAFF_HAS_HISTORY' ? dialog?.target.status === 'ACTIVE' && <Button type="button" variant="outlined" onClick={() => openAction('disable', dialog.target)}>{text.disable}</Button> : <Button type="submit" variant="contained" color={dialog?.kind === 'delete' || dialog?.kind === 'disable' ? 'error' : 'primary'} sx={dialog?.kind === 'delete' || dialog?.kind === 'disable' ? { bgcolor: 'error.main', color: 'error.contrastText', '&:hover': { bgcolor: 'error.dark' } } : {}} disabled={busy || list.loading} aria-busy={pending === 'action'}>{busy ? text.pending : dialog?.kind === 'delete' ? text.confirmDelete : text[dialog?.kind]}</Button>}
          </DialogActions>
        </Box>
      </Dialog>
    </Box>
  </MuiThemeProvider></CacheProvider>;
}
