import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { fetchWithAuth } from '../../../../services/staff/staffApi';
import { clinicDateString } from '../../../../utils/clinicTime';
import { formatQueueDateLabel, shiftQueueDate } from '../receptionHelpers';
import QueueAppointmentRow from './QueueAppointmentRow';

export default function AppointmentQueue({
  lang, doctor, date, onDateChange, revision, onRetry, pendingActionIds, highlightedAppointmentId = null, ...rowProps
}) {
  const ar = lang === 'ar';
  const today = clinicDateString();
  const dateLabel = formatQueueDateLabel(date, lang, today);
  const path = doctor ? `/api/appointments/queue/${doctor.id}?date=${date}` : '';
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!path) return;
    let current = true;
    async function load() {
      try {
        const response = await fetchWithAuth(path);
        if (!response.ok) throw new Error('Queue request failed');
        const appointments = await response.json();
        if (!Array.isArray(appointments)) throw new Error('Invalid queue response');
        if (current) setResult({ path, appointments });
      } catch {
        if (current) setResult({ path, error: true });
      }
    }
    load();
    return () => { current = false; };
  }, [path, revision]);

  const appointments = result?.path === path ? result.appointments : undefined;
  const failed = result?.path === path && result.error;
  const Prev = ar ? ChevronRight : ChevronLeft;
  const Next = ar ? ChevronLeft : ChevronRight;
  const waiting = appointments?.filter(item => item.status === 'CHECKED_IN').length;

  return (
    <section className="ui-panel reception-queue-table-panel" aria-labelledby="reception-queue-title">
      <div className="reception-table-header-row">
        <h2 id="reception-queue-title" className="reception-panel-title">
          {ar ? 'مواعيد' : 'Appointments'} · {dateLabel}
        </h2>
        {appointments && <span className="reception-panel-count">
          {appointments.length} {ar ? 'مواعيد' : 'appointments'} · {waiting} {ar ? 'بانتظار الطبيب' : 'waiting'}
        </span>}
      </div>
      <div className="reception-day-stepper">
        <button type="button" className="reception-stepper-btn" aria-label={ar ? 'اليوم السابق' : 'Previous day'}
          onClick={() => onDateChange(shiftQueueDate(date, -1))}><Prev size={18} /></button>
        <input type="date" className="form-input" aria-label={ar ? 'تاريخ المواعيد' : 'Appointment date'}
          value={date} onChange={event => { if (event.target.value) onDateChange(event.target.value); }} />
        <button type="button" className="reception-stepper-btn" aria-label={ar ? 'اليوم التالي' : 'Next day'}
          onClick={() => onDateChange(shiftQueueDate(date, 1))}><Next size={18} /></button>
        <button type="button" className="btn btn-secondary" disabled={date === today}
          onClick={() => onDateChange(today)}>{ar ? 'اليوم' : 'Today'}</button>
      </div>
      {!doctor ? <p className="reception-panel-empty">{ar ? 'اختر طبيبًا لعرض المواعيد.' : 'Select a doctor to view appointments.'}</p>
        : failed ? <div role="alert" className="patient-alert error">
          {ar ? 'تعذر تحميل المواعيد.' : 'Could not load appointments.'}{' '}
          <button type="button" onClick={onRetry}>{ar ? 'إعادة المحاولة' : 'Retry'}</button>
        </div>
        : !appointments ? <p role="status">{ar ? 'جارٍ تحميل المواعيد…' : 'Loading appointments…'}</p>
        : appointments.length === 0 ? <p className="reception-panel-empty">
          {ar ? 'لا توجد مواعيد مجدولة لهذا الطبيب في' : 'No appointments scheduled for this doctor on'} {dateLabel}.
        </p>
        : <div className="reception-queue-rows-container">
          {appointments.map((app, index) => <QueueAppointmentRow key={app.id} app={app} index={index}
            lang={lang} selectedDoctor={doctor} isActionPending={pendingActionIds.has(app.id)}
            isHighlighted={highlightedAppointmentId === app.id} {...rowProps} />)}
        </div>}
    </section>
  );
}
