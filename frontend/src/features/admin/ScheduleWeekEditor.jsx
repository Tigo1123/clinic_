import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, Collapse, Divider, FormControlLabel, Grid, IconButton, Stack, Switch, TextField, Typography } from '@mui/material';
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { formatScheduleTime, scheduleTimeMessage, normalizeScheduleTime } from './scheduleTime.js';

const scheduleWeekdays = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const blankSchedulePeriod = dayOfWeek => ({ dayOfWeek, startTime: '09:00', endTime: '17:00', slotDurationMinutes: 30, active: true, breaks: [] });
function ClockRange({ period, lang }) {
  return <Box component="span" dir="ltr" style={{ direction: 'ltr' }} sx={{ display: 'inline-flex', whiteSpace: 'nowrap', columnGap: 1 }}><bdi dir="ltr">{formatScheduleTime(period.startTime, lang)}</bdi><span>{' – '}</span><bdi dir="ltr">{formatScheduleTime(period.endTime, lang)}</bdi></Box>;
}

export default function ScheduleWeekEditor({ periods, setPeriods, errors, reveal, validatePeriod, lang, label, t, disabled }) {
  const [expanded, setExpanded] = useState(null);
  const [editing, setEditing] = useState(null);
  const snapshot = useRef(null);
  const lastReveal = useRef(null);
  const update = (index, patch) => setPeriods(current => current.map((period, i) => i === index ? { ...period, ...patch } : period));
  const edit = index => { snapshot.current = structuredClone(periods[index]); setEditing(index); };
  useEffect(() => {
    if (reveal && lastReveal.current !== reveal) {
      lastReveal.current = reveal;
      setExpanded(reveal.day);
      if (editing !== reveal.index) snapshot.current = structuredClone(periods[reveal.index]);
      setEditing(reveal.index);
      requestAnimationFrame(() => document.getElementById(`schedule-period-${reveal.index}`)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }));
    }
    // Reveal is an explicit save/validation action, not a response to each keystroke.
  }, [reveal, periods, editing]);
  const addPeriod = day => {
    const previous = periods.filter(p => p.dayOfWeek === day && p.active !== false).sort((a, b) => a.endTime.localeCompare(b.endTime)).at(-1);
    let period = blankSchedulePeriod(day);
    if (previous?.endTime && previous.endTime < '23:00') {
      const start = Number(previous.endTime.slice(0, 2)) * 60 + Number(previous.endTime.slice(3));
      const end = Math.min(start + 120, 1439);
      period = { ...period, startTime: previous.endTime, endTime: `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}` };
    }
    snapshot.current = null;
    setPeriods(current => [...current, period]); setEditing(periods.length); setExpanded(day);
  };
  const cancel = index => {
    if (snapshot.current) update(index, snapshot.current);
    else setPeriods(current => current.filter((_, i) => i !== index));
    setEditing(null);
  };
  const toggleDay = (day, working) => {
    if (!periods.some(period => period.dayOfWeek === day)) {
      setPeriods(current => [...current, blankSchedulePeriod(day)]);
    } else setPeriods(current => current.map(period => period.dayOfWeek === day ? { ...period, active: working } : period));
  };
  const addBreak = index => {
    const period = periods[index];
    const startTime = normalizeScheduleTime(period.startTime);
    const endTime = normalizeScheduleTime(period.endTime);
    const from = startTime ? Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3)) : 720;
    const to = endTime ? Number(endTime.slice(0, 2)) * 60 + Number(endTime.slice(3)) : 780;
    const start = from + Math.max(0, Math.floor((to - from) / 2));
    const clock = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
    update(index, { breaks: [...(period.breaks || []), { startTime: clock(start), endTime: clock(Math.min(start + 30, to)), active: true }] });
  };
  const field = (index, name, title) => <TextField size="small" fullWidth required label={title} type="time" value={periods[index][name]} onChange={event => update(index, { [name]: event.target.value })}
    error={Boolean(errors[index])} slotProps={{ inputLabel: { shrink: true }, htmlInput: { dir: 'ltr', step: 60, 'aria-describedby': `schedule-period-error-${index} schedule-time-help` } }}/>;

  return <>
    <Box className="schedule-week-summary" role="list" aria-label={label('scheduleWeekSummary', 'Week at a glance')} sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(3, minmax(0, 1fr))', sm: 'repeat(4, minmax(0, 1fr))', lg: 'repeat(7, minmax(0, 1fr))' }, gap: 2, mb: 3 }}>
      {scheduleWeekdays.map(day => {
        const active = periods.filter(period => period.dayOfWeek === day && period.active !== false);
        return <Box key={day} role="listitem" sx={{ minWidth: 0, p: 2, borderRadius: 1, bgcolor: 'action.hover' }}>
          <Typography variant="caption" fontWeight={700}>{label(`weekday${day}`, day)}</Typography>
          <Typography component="div" variant="body2" color={active.length ? 'text.primary' : 'text.secondary'}>{active.length ? active.map((period, i) => <Box key={i} dir="ltr" sx={{ fontSize: '.75rem', whiteSpace: 'normal' }}>{period.startTime}–{period.endTime}</Box>) : label('scheduleDayOff', 'Off')}</Typography>
        </Box>;
      })}
    </Box>
    <Stack spacing={2} className="schedule-days">
      {scheduleWeekdays.map(day => {
        const entries = periods.map((period, index) => ({ period, index })).filter(({ period }) => period.dayOfWeek === day);
        const active = entries.filter(({ period }) => period.active !== false);
        const dayError = entries.some(({ index }) => errors[index]);
        const open = expanded === day;
        return <Box component="section" className="schedule-day" data-day={day} key={day} aria-labelledby={`schedule-day-${day}`} sx={{ border: 1, borderColor: dayError ? 'error.main' : 'divider', borderRadius: 1, minWidth: 0 }}>
          <Box className="schedule-day-heading" sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr) auto 44px', sm: 'minmax(100px, .6fr) 110px minmax(0, 2fr) 44px' }, alignItems: 'center', gap: 2, px: 3, py: 1 }}>
            <Typography component="h4" variant="body1" id={`schedule-day-${day}`} fontWeight={700}>{label(`weekday${day}`, day)}</Typography>
            <FormControlLabel sx={{ m: 0, minHeight: 44 }} control={<Switch size="small" checked={active.length > 0} disabled={disabled} onChange={event => toggleDay(day, event.target.checked)} slotProps={{ input: { 'aria-label': `${label('workingDay', 'Working day')}: ${label(`weekday${day}`, day)}` } }}/>} label={<Typography variant="body2">{label(active.length ? 'scheduleWorking' : 'scheduleDayOff', active.length ? 'Working' : 'Off')}</Typography>}/>
            <Box sx={{ gridRow: { xs: 2, sm: 1 }, gridColumn: { xs: '1 / -1', sm: 3 }, minWidth: 0, display: !active.length && !dayError ? { xs: 'none', sm: 'block' } : 'block' }}>
              {active.map(({ period, index }) => <Typography component="div" className="schedule-day-range" key={index} variant="body2" color="text.secondary"><ClockRange period={period} lang={lang}/><Box component="span" sx={{ mx: 2 }}>·</Box>{period.slotDurationMinutes} {label('scheduleMinutes', 'min')}{(period.breaks || []).some(br => br.active !== false) && <Box component="span" sx={{ mx: 2 }}>· {label('breaks', 'Breaks')}: {period.breaks.filter(br => br.active !== false).length}</Box>}</Typography>)}
              {dayError && !open && <Typography variant="caption" color="error">{label('scheduleReviewDay', 'Review this day')}</Typography>}
            </Box>
            <IconButton type="button" disabled={disabled} onClick={() => setExpanded(open ? null : day)} aria-label={`${label(open ? 'scheduleCollapseDay' : 'scheduleEditDay', open ? 'Close' : 'Edit')}: ${label(`weekday${day}`, day)}`} aria-expanded={open} aria-controls={`schedule-day-details-${day}`} sx={{ gridRow: 1, gridColumn: { xs: 3, sm: 4 }, width: 44, height: 44 }}>{open ? <ChevronUp size={20}/> : <ChevronDown size={20}/>}</IconButton>
          </Box>
          <Collapse in={open} unmountOnExit timeout={0}>
            <Box id={`schedule-day-details-${day}`} sx={{ px: 3, pb: 3 }}>
              <Divider sx={{ mb: 3 }}/>
              <Stack spacing={3}>
                {!entries.length && <Typography variant="body2" color="text.secondary">{label('scheduleNoPeriods', 'No working periods. Add one to open this day.')}</Typography>}
                {entries.map(({ period, index }) => <Box className="admin-period" id={`schedule-period-${index}`} data-index={index} key={period.id || index} sx={{ border: 1, borderColor: errors[index] ? 'error.main' : 'divider', borderRadius: 1, p: 3, minWidth: 0 }}>
                  {editing === index ? <Stack spacing={3}>
                    <Grid container spacing={3} className="admin-period-grid">
                      <Grid size={{ xs: 12, sm: 4 }}>{field(index, 'startTime', label('startTime', 'Start'))}</Grid>
                      <Grid size={{ xs: 12, sm: 4 }}>{field(index, 'endTime', label('endTime', 'End'))}</Grid>
                      <Grid size={{ xs: 12, sm: 4 }}><TextField size="small" fullWidth type="number" required label={label('slotDuration', 'Slot duration')} value={period.slotDurationMinutes} onChange={event => update(index, { slotDurationMinutes: Number(event.target.value) })} error={errors[index] === 'SCHEDULE_INVALID_DURATION'} slotProps={{ htmlInput: { min: 1, max: 1440, step: 1 } }}/></Grid>
                    </Grid>
                    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
                      <Typography className="admin-period-time-summary" variant="body2"><ClockRange period={period} lang={lang}/></Typography>
                      <FormControlLabel sx={{ m: 0 }} control={<Switch size="small" checked={period.active !== false} onChange={event => update(index, { active: event.target.checked })}/>} label={label('schedulePeriodActive', 'Period active')}/>
                    </Stack>
                    <Box className="admin-breaks">
                      {(period.breaks || []).map((br, bi) => <Box key={br.id || bi} className="admin-break" sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) 44px', alignItems: 'center', gap: 2, mb: 2 }}>
                        <TextField fullWidth size="small" type="time" label={label('scheduleBreakStart', 'Break start')} required value={br.startTime} onChange={event => update(index, { breaks: period.breaks.map((b, i) => i === bi ? { ...b, startTime: event.target.value } : b) })} slotProps={{ inputLabel: { shrink: true }, htmlInput: { dir: 'ltr', step: 60 } }}/>
                        <TextField fullWidth size="small" type="time" label={label('scheduleBreakEnd', 'Break end')} required value={br.endTime} onChange={event => update(index, { breaks: period.breaks.map((b, i) => i === bi ? { ...b, endTime: event.target.value } : b) })} slotProps={{ inputLabel: { shrink: true }, htmlInput: { dir: 'ltr', step: 60 } }}/>
                        <IconButton type="button" aria-label={label('removeBreak', 'Remove break')} onClick={() => update(index, { breaks: period.breaks.filter((_, i) => i !== bi) })} sx={{ width: 44, height: 44 }}><Trash2 size={17}/></IconButton>
                      </Box>)}
                      <Button type="button" size="small" startIcon={<Plus size={16}/>} onClick={() => addBreak(index)}>{label('addBreak', 'Add break')}</Button>
                    </Box>
                    <Stack direction="row" spacing={2} sx={{ justifyContent: 'flex-end' }}>
                      <Button type="button" onClick={() => cancel(index)}>{label('scheduleCancelEdit', 'Cancel')}</Button>
                      <Button type="button" variant="outlined" onClick={() => { if (validatePeriod(index)) setEditing(null); }}>{label('scheduleDoneEdit', 'Done')}</Button>
                    </Stack>
                  </Stack> : <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', gap: 2 }}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2"><ClockRange period={period} lang={lang}/> · {period.slotDurationMinutes} {label('scheduleMinutes', 'min')} {period.active === false && <Chip size="small" label={label('scheduleDayOff', 'Off')}/>}</Typography>
                      {(period.breaks || []).map((br, bi) => br.active !== false && <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }} key={bi}>
                        <Typography variant="caption" color="text.secondary">{label('scheduleBreakLabel', 'Break')}: <ClockRange period={br} lang={lang}/></Typography>
                        <IconButton type="button" aria-label={label('removeBreak', 'Remove break')} onClick={() => update(index, { breaks: period.breaks.filter((_, i) => i !== bi) })} sx={{ width: 44, height: 44 }}><Trash2 size={15}/></IconButton>
                      </Stack>)}
                    </Box>
                    <Stack direction="row" spacing={1}>
                      <Button type="button" startIcon={<Pencil size={16}/>} onClick={() => edit(index)}>{label('scheduleEditPeriod', 'Edit period')}</Button>
                      <IconButton type="button" aria-label={label('removePeriod', 'Remove period')} onClick={() => { setPeriods(current => current.filter((_, i) => i !== index)); setEditing(null); }} sx={{ width: 44, height: 44 }}><Trash2 size={17}/></IconButton>
                    </Stack>
                  </Stack>}
                  {errors[index] && <Alert id={`schedule-period-error-${index}`} severity="error" role="alert" sx={{ mt: 2 }}>{scheduleTimeMessage(errors[index], lang, t)}</Alert>}
                </Box>)}
              </Stack>
              <Button type="button" startIcon={<Plus size={16}/>} onClick={() => addPeriod(day)} sx={{ mt: 2 }}>{label('addWorkingDay', 'Add working period')}</Button>
            </Box>
          </Collapse>
        </Box>;
      })}
    </Stack>
  </>;
}
