import { useEffect, useRef, useState } from 'react';
import { Box, Button, Card, Chip, Divider, Grid, Stack, TextField, Typography } from '@mui/material';
import { Pencil, Save, X } from 'lucide-react';
import SpecialtyDeleteButton from './SpecialtyDeleteButton.js';

const copy = {
  en: { code: 'Code', nameAr: 'Arabic name', nameEn: 'English name', status: 'Status', active: 'Active', inactive: 'Inactive', edit: 'Edit', save: 'Save changes', cancel: 'Cancel', saving: 'Saving…', failure: 'Unable to save specialty. Please try again.', invalid: 'Enter a code and both names before saving.' },
  ar: { code: 'رمز التخصص', nameAr: 'الاسم بالعربية', nameEn: 'الاسم بالإنجليزية', status: 'الحالة', active: 'نشط', inactive: 'غير نشط', edit: 'تعديل', save: 'حفظ التغييرات', cancel: 'إلغاء', saving: 'جارٍ الحفظ…', failure: 'تعذر حفظ التخصص. يرجى المحاولة مرة أخرى.', invalid: 'أدخل الرمز والاسمين قبل الحفظ.' }
};

export default function SpecialtyRow({ specialty, lang, onSave, isAdmin, request, onDeleted, onFeedback }) {
  const labels = copy[lang === 'ar' ? 'ar' : 'en'];
  const [draft, setDraft] = useState(specialty);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);

  // A refresh after editing another card must not erase this card's unsaved work.
  useEffect(() => {
    if (!editing) { setDraft(specialty); setError(''); }
  }, [specialty, editing]);

  const update = (field, value) => setDraft(current => ({ ...current, [field]: value }));
  const save = async (event) => {
    event.preventDefault();
    if (inFlight.current) return;
    if (![draft.code, draft.nameAr, draft.nameEn].every(value => String(value || '').trim())) {
      setError(labels.invalid);
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setError('');
    try {
      const result = await onSave({ ...draft, code: draft.code.trim(), nameAr: draft.nameAr.trim(), nameEn: draft.nameEn.trim() });
      if (result !== false) setEditing(false);
    } catch {
      setError(labels.failure);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return <Card component="article" variant="outlined" sx={{ minWidth: 0, height: '100%', overflow: 'hidden' }}>
    {editing ? <Box component="form" onSubmit={save} noValidate sx={{ p: { xs: 4, md: 5 } }}>
      <Stack spacing={2}>
        {error && <Typography role="alert" color="error" variant="body2">{error}</Typography>}
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6 }}><TextField label={labels.code} value={draft.code} onChange={event => update('code', event.target.value)} fullWidth required disabled={saving} slotProps={{ htmlInput: { dir: 'ltr', maxLength: 60 } }}/></Grid>
          <Grid size={{ xs: 12, sm: 6 }}><TextField label={labels.status} select slotProps={{ select: { native: true } }} value={String(draft.active)} onChange={event => update('active', event.target.value === 'true')} fullWidth disabled={saving}><option value="true">{labels.active}</option><option value="false">{labels.inactive}</option></TextField></Grid>
          <Grid size={{ xs: 12 }}><TextField label={labels.nameAr} value={draft.nameAr} onChange={event => update('nameAr', event.target.value)} fullWidth required disabled={saving} slotProps={{ htmlInput: { dir: 'rtl', maxLength: 100 } }}/></Grid>
          <Grid size={{ xs: 12 }}><TextField label={labels.nameEn} value={draft.nameEn} onChange={event => update('nameEn', event.target.value)} fullWidth required disabled={saving} slotProps={{ htmlInput: { dir: 'ltr', maxLength: 100 } }}/></Grid>
        </Grid>
        <Divider/>
        <Stack direction={{ xs: 'column-reverse', sm: 'row' }} spacing={1} sx={{ justifyContent: 'flex-end' }}>
          <Button type="button" variant="text" onClick={() => { setDraft(specialty); setEditing(false); setError(''); }} disabled={saving} startIcon={<X size={18}/>}>{labels.cancel}</Button>
          <Button type="submit" variant="contained" disabled={saving} startIcon={<Save size={18}/>}>{saving ? labels.saving : labels.save}</Button>
        </Stack>
      </Stack>
    </Box> : <Stack spacing={2} sx={{ p: { xs: 4, md: 5 }, height: '100%', boxSizing: 'border-box' }}>
      <Grid container spacing={2} sx={{ flex: 1 }}>
        <Grid size={{ xs: 12 }} sx={{ minWidth: 0 }}><Typography variant="caption" color="text.secondary">{labels.code}</Typography><Typography component="div" variant="body1" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}><bdi dir="ltr">{specialty.code}</bdi></Typography></Grid>
        <Grid size={{ xs: 12 }} sx={{ minWidth: 0 }}><Typography variant="caption" color="text.secondary">{labels.nameAr}</Typography><Typography component="div" variant="body1" lang="ar" dir="rtl" sx={{ overflowWrap: 'anywhere', textAlign: 'start' }}>{specialty.nameAr}</Typography></Grid>
        <Grid size={{ xs: 12 }} sx={{ minWidth: 0 }}><Typography variant="caption" color="text.secondary">{labels.nameEn}</Typography><Typography component="div" variant="body1" lang="en" dir="ltr" sx={{ overflowWrap: 'anywhere', textAlign: 'start' }}>{specialty.nameEn}</Typography></Grid>
        <Grid size={{ xs: 12 }}><Chip aria-label={`${labels.status}: ${specialty.active ? labels.active : labels.inactive}`} size="small" color={specialty.active ? 'success' : 'default'} label={specialty.active ? labels.active : labels.inactive}/></Grid>
      </Grid>
      <Divider/>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', justifyContent: 'flex-end', rowGap: 1 }}>
        <Button type="button" variant="outlined" onClick={() => setEditing(true)} startIcon={<Pencil size={18}/>}>{labels.edit}</Button>
        {isAdmin && <SpecialtyDeleteButton specialty={specialty} lang={lang} request={request} onDeleted={onDeleted} onFeedback={onFeedback}/>}
      </Stack>
    </Stack>}
  </Card>;
}
