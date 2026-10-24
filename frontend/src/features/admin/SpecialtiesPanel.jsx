import { useMemo, useRef } from 'react';
import { CacheProvider } from '@emotion/react';
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import { Alert, Box, Button, Card, Grid, Stack, TextField, Typography } from '@mui/material';
import { Plus } from 'lucide-react';
import { useTheme } from '../../app/theme/ThemeContext.jsx';
import { createPatientMuiTheme, patientStyleCaches } from '../../utils/patientMuiTheme.js';
import SpecialtyRow from './SpecialtyRow.jsx';

const copy = {
  en: { title: 'Specialty management', subtitle: 'Create and maintain the specialties used in doctor profiles and patient booking.', addTitle: 'Add specialty', code: 'Specialty code', nameAr: 'Arabic name', nameEn: 'English name', add: 'Add specialty', adding: 'Adding…', empty: 'No specialties have been added yet.' },
  ar: { title: 'إدارة التخصصات', subtitle: 'إضافة التخصصات المستخدمة في ملفات الأطباء وحجز المرضى وإدارتها.', addTitle: 'إضافة تخصص', code: 'رمز التخصص', nameAr: 'الاسم بالعربية', nameEn: 'الاسم بالإنجليزية', add: 'إضافة التخصص', adding: 'جارٍ الإضافة…', empty: 'لم تتم إضافة أي تخصصات بعد.' }
};

export default function SpecialtiesPanel({ lang, specialties, draft, setDraft, error, feedback, pending, onCreate, onSave, isAdmin, request, onDeleted, onFeedback }) {
  const labels = copy[lang === 'ar' ? 'ar' : 'en'];
  const direction = lang === 'ar' ? 'rtl' : 'ltr';
  const { theme: mode } = useTheme();
  const theme = useMemo(() => createPatientMuiTheme(mode, direction), [mode, direction]);
  const createLock = useRef(false);
  const submitCreate = event => {
    event.preventDefault();
    if (createLock.current || pending) return;
    createLock.current = true;
    Promise.resolve(onCreate(event)).finally(() => { createLock.current = false; });
  };
  return <CacheProvider value={patientStyleCaches[direction]}><MuiThemeProvider theme={theme}><Box dir={direction} sx={{ width: '100%', maxWidth: 1440, minWidth: 0, overflowWrap: 'anywhere', mx: 'auto', boxSizing: 'border-box', px: { xs: 0, md: 1 }, pb: 3 }}>
    <Stack spacing={{ xs: 2, md: 3 }}>
      <Box>
        <Typography component="h2" variant="h4" fontWeight={750} sx={{ fontSize: { xs: '1.45rem', md: '1.85rem' } }}>{labels.title}</Typography>
        <Typography color="text.secondary" sx={{ mt: .75 }}>{labels.subtitle}</Typography>
      </Box>
      {error && <Alert severity="error" role="alert">{error}</Alert>}
      {feedback && <Alert severity={feedback.type === 'error' ? 'error' : 'success'} role={feedback.type === 'error' ? 'alert' : 'status'}>{feedback.message}</Alert>}
      <Card component="section" variant="outlined" aria-labelledby="specialty-create-title" sx={{ minWidth: 0, p: { xs: 4, sm: 5, md: 6 } }}>
        <Stack component="form" onSubmit={submitCreate} spacing={2}>
          <Typography id="specialty-create-title" component="h3" variant="h6" fontWeight={700}>{labels.addTitle}</Typography>
          <Grid container spacing={2} sx={{ alignItems: 'center' }}>
            <Grid size={{ xs: 12, sm: 6, lg: 3 }}><TextField label={labels.code} value={draft.code} onChange={event => setDraft(current => ({ ...current, code: event.target.value }))} fullWidth required disabled={pending} slotProps={{ htmlInput: { dir: 'ltr', maxLength: 60 } }} autoComplete="off"/></Grid>
            <Grid size={{ xs: 12, sm: 6, lg: 3 }}><TextField label={labels.nameAr} value={draft.nameAr} onChange={event => setDraft(current => ({ ...current, nameAr: event.target.value }))} fullWidth required disabled={pending} slotProps={{ htmlInput: { dir: 'rtl', maxLength: 100 } }} autoComplete="off"/></Grid>
            <Grid size={{ xs: 12, sm: 6, lg: 3 }}><TextField label={labels.nameEn} value={draft.nameEn} onChange={event => setDraft(current => ({ ...current, nameEn: event.target.value }))} fullWidth required disabled={pending} slotProps={{ htmlInput: { dir: 'ltr', maxLength: 100 } }} autoComplete="off"/></Grid>
            <Grid size={{ xs: 12, sm: 6, lg: 3 }}><Button type="submit" variant="contained" fullWidth disabled={pending} startIcon={<Plus size={18}/>} sx={{ minHeight: 56, whiteSpace: 'normal' }}>{pending ? labels.adding : labels.add}</Button></Grid>
          </Grid>
        </Stack>
      </Card>
      {!specialties.length ? <Card variant="outlined" sx={{ p: 3 }}><Typography color="text.secondary">{labels.empty}</Typography></Card> : <Grid container spacing={{ xs: 1.5, md: 2 }}>
        {specialties.map(specialty => <Grid key={specialty.id} size={{ xs: 12, md: 6, xl: 4 }} sx={{ minWidth: 0 }}>
          <SpecialtyRow specialty={specialty} lang={lang} onSave={onSave} isAdmin={isAdmin} request={request} onDeleted={onDeleted} onFeedback={onFeedback}/>
        </Grid>)}
      </Grid>}
    </Stack>
  </Box></MuiThemeProvider></CacheProvider>;
}
