import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { patientApiRequest as apiRequest } from '../../services/apiClient';
import StatusBadge from '../../components/ui/StatusBadge';
import { CalendarDays, FileHeart, FlaskConical, HeartPulse, Pill, Search, Stethoscope, UserRound } from 'lucide-react';
import Dialog from '../../components/ui/Dialog';
import { EmptyState, ErrorState, Skeleton } from '../../components/feedback/States';
import HealthcareIllustration from '../../components/healthcare/HealthcareIllustration';
import { clinicCalendarDays } from '../../utils/clinicTime';

function useApi(path){
  const [result,setResult]=useState({path:null,data:null,error:null,loading:true});
  const [reloadToken,setReloadToken]=useState(0);
  const reload=()=>setReloadToken(token=>token+1);
  useEffect(()=>{
    let current=true;
    setResult({path,data:null,error:null,loading:true});
    apiRequest(path)
      .then(data=>{if(current)setResult({path,data,error:null,loading:false})})
      .catch(error=>{if(current)setResult({path,data:null,error,loading:false})});
    return()=>{current=false};
  },[path,reloadToken]);
  const isCurrent=result.path===path;
  return{data:isCurrent?result.data:null,error:isCurrent?result.error?.message||'':'',errorStatus:isCurrent?result.error?.status:null,loading:!isCurrent||result.loading,reload};
}
function State({loading,error,children}){if(loading)return <div className="patient-card"><Skeleton/></div>;if(error)return <ErrorState message={error}/>;return children}
function Empty({children}){return <div className="patient-card patient-empty">{children}</div>}
const doctorName=(doctor,lang)=>
  lang==='ar'
    ? (doctor?.fullNameAr || doctor?.fullNameEn)
    : (doctor?.fullNameEn || doctor?.fullNameAr);

const patientGreeting = (profile, language) => {
  const lang = language?.startsWith('ar') ? 'ar' : 'en';
  const hour = new Date().getHours();

  const name =
    lang === 'ar'
      ? (profile?.fullNameAr || profile?.fullNameEn || '')
      : (profile?.fullNameEn || profile?.fullNameAr || '');

  if (lang === 'ar') {
    return hour >= 5 && hour < 12
      ? `صباح الخير${name ? ` ${name}` : ''}`
      : `مساء الخير${name ? ` ${name}` : ''}`;
  }

  return hour >= 5 && hour < 12
    ? `Good morning${name ? `, ${name}` : ''}`
    : `Good evening${name ? `, ${name}` : ''}`;
};

const normalizeDoctorSearch = (value = '') =>
  String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ى/g, 'ي')
    .replace(/(^|\s)(دكتور|دكتورة|د\.?|doctor|dr\.?)\s*/gi, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function Dashboard(){const{t,i18n}=useTranslation();const profile=useApi('/api/patient/me');const appointments=useApi('/api/patient/appointments?group=upcoming');const labs=useApi('/api/patient/lab-results');const prescriptions=useApi('/api/patient/prescriptions');if(profile.error?.includes('not linked'))return <><div className="patient-alert error">{profile.error}</div><Link className="patient-button" to="/patient/claim">{t('claimRecord')}</Link></>;const next=appointments.data?.[0];return <State loading={profile.loading} error={profile.error}><section className="patient-hero patient-hero--care"><div className="patient-hero__copy"><span className="patient-hero__eyebrow"><HeartPulse size={15}/>{t('welcome')}</span><h1>{patientGreeting(profile.data, i18n.language)}</h1><p>{t('patientHeroText')}</p><Link className="patient-button" to="/patient/doctors"><CalendarDays size={18}/>{t('bookAppointment')}</Link></div><HealthcareIllustration variant="patient"/></section><div className="section-heading-row"><h2>{t('healthServices')}</h2></div><div className="service-grid"><Service to="/patient/doctors" icon={<Stethoscope/>} label={t('doctors')}/><Service to="/patient/appointments" icon={<CalendarDays/>} label={t('myAppointments')}/><Service to="/patient/lab-results" icon={<FlaskConical/>} label={t('labResults')}/><Service to="/patient/records" icon={<FileHeart/>} label={t('medicalRecords')}/></div><div className="section-heading-row"><h2>{t('upcomingAppointments')}</h2><Link to="/patient/appointments">{t('all')}</Link></div>{next?<article className="patient-card appointment-card"><div className="appointment-card__date"><span>{new Date(`${next.appointmentDate}T00:00:00`).toLocaleDateString(i18n.language,{month:'short'})}</span><strong>{new Date(`${next.appointmentDate}T00:00:00`).getDate()}</strong></div><div><h2>{doctorName(next.doctor,i18n.language)}</h2><p>{next.doctor?.specialtyEn}</p><p>{next.appointmentTime} · <StatusBadge status={next.status}/></p></div><Link className="patient-button secondary" to={`/patient/appointments/${next.id}`}>{t('details')}</Link></article>:<Empty>{t('noAppointments')}</Empty>}<div className="section-heading-row"><h2>{t('recentPatientInfo')}</h2></div><div className="patient-grid"><Summary to="/patient/appointments" icon={<CalendarDays/>} title={t('upcomingAppointments')} value={appointments.data?.length||0}/><Summary to="/patient/lab-results" icon={<FlaskConical/>} title={t('recentLabResults')} value={labs.data?.length||0}/><Summary to="/patient/prescriptions" icon={<Pill/>} title={t('prescriptions')} value={prescriptions.data?.length||0}/></div></State>}
function Service({to,icon,label}){return <Link className="service-card" to={to}><span className="service-card__icon">{icon}</span><strong>{label}</strong></Link>}
function Summary({to,icon,title,value}){return <Link className="patient-card health-summary-card" to={to}><div style={{color:'var(--color-primary)'}}>{icon}</div><h3>{title}</h3><strong>{value}</strong></Link>}

export function Doctors(){
  const { t, i18n } = useTranslation();
  const { data, error, loading } = useApi('/api/patient/doctors');
  const [query, setQuery] = useState('');
  const [specialty, setSpecialty] = useState('');

  const specialties = [
    ...new Set(
      (data || [])
        .map((doctor) =>
          i18n.language === 'ar'
            ? doctor.specialtyAr
            : doctor.specialtyEn
        )
        .filter(Boolean)
    )
  ];

  const normalizedQuery = normalizeDoctorSearch(query);

  const filtered = (data || []).filter((doctor) => {
    const displayedSpecialty =
      i18n.language === 'ar'
        ? doctor.specialtyAr
        : doctor.specialtyEn;

    const searchableText = normalizeDoctorSearch(
      [
        doctor.fullNameAr,
        doctor.fullNameEn,
        doctor.specialtyAr,
        doctor.specialtyEn
      ]
        .filter(Boolean)
        .join(' ')
    );

    const matchesQuery =
      !normalizedQuery ||
      searchableText.includes(normalizedQuery);

    const matchesSpecialty =
      !specialty ||
      displayedSpecialty === specialty;

    return matchesQuery && matchesSpecialty;
  });

  return (
    <State loading={loading} error={error}>
      <header className="doctor-search-header">
        <div>
          <span>{t('healthServices')}</span>
          <h1>{t('doctors')}</h1>
        </div>

        <label className="doctor-search">
          <Search size={19}/>
          <span className="sr-only">{t('search')}</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('search')}
          />
        </label>
      </header>

      {specialties.length > 0 && (
        <div
          className="specialty-chips"
          aria-label={t('selectSpecialty')}
        >
          <button
            className={!specialty ? 'selected' : ''}
            onClick={() => setSpecialty('')}
          >
            {t('all')}
          </button>

          {specialties.map((item) => (
            <button
              className={specialty === item ? 'selected' : ''}
              onClick={() => setSpecialty(item)}
              key={item}
            >
              {item}
            </button>
          ))}
        </div>
      )}

      <div className="section-heading-row">
        <h2>{t('doctors')}</h2>
        <span>{filtered.length}</span>
      </div>

      {!filtered.length ? (
        <Empty>{t('noDoctors')}</Empty>
      ) : (
        <div className="doctor-list">
          {filtered.map((doctor) => (
            <article
              className="patient-card doctor-card"
              key={doctor.id}
            >
              <div className="doctor-card__avatar">
                <UserRound/>
              </div>

              <div className="doctor-card__body">
                <h2>{doctorName(doctor, i18n.language)}</h2>

                <p>
                  {i18n.language === 'ar'
                    ? doctor.specialtyAr
                    : doctor.specialtyEn}
                </p>

                <strong>
                  {Number(doctor.consultationFee).toLocaleString(
                    i18n.language === 'ar' ? 'ar' : 'en'
                  )}{' '}
                  {i18n.language === 'ar' ? 'ج.س' : 'SDG'}
                </strong>

                <div className="patient-actions">
                  <Link
                    className="patient-button secondary"
                    to={`/patient/doctors/${doctor.id}`}
                  >
                    {t('details')}
                  </Link>

                  <Link
                    className="patient-button"
                    to={`/patient/book/${doctor.id}`}
                  >
                    {t('book')}
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </State>
  );
}

export function DoctorDetails(){const{id}=useParams();const{t,i18n}=useTranslation();const{data,error,loading,reload}=useApi(`/api/patient/doctors/${id}`);if(loading)return <div className="patient-card"><Skeleton/></div>;if(error)return <ErrorState message={error} onRetry={reload}/>;if(!data)return <EmptyState title={t('doctorNotFound')}/>;return <article className="patient-card doctor-profile"><div className="doctor-profile__avatar"><UserRound/></div><div><span className="doctor-profile__label"><Stethoscope size={16}/>{t('doctors')}</span><h1>{doctorName(data,i18n.language)}</h1><p>{i18n.language==='ar'?data.specialtyAr:data.specialtyEn}</p><strong>
      {Number(data.consultationFee).toLocaleString(
        i18n.language === 'ar' ? 'ar' : 'en'
      )}{' '}
      {i18n.language === 'ar' ? 'ج.س' : 'SDG'}
    </strong></div><Link className="patient-button" to={`/patient/book/${id}`}><CalendarDays size={18}/>{t('bookAppointment')}</Link></article>}
export function BookAppointment(){const{doctorId}=useParams();const{t,i18n}=useTranslation();const nav=useNavigate();const[date,setDate]=useState(''),[slots,setSlots]=useState([]),[time,setTime]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false),[successAppointmentId,setSuccessAppointmentId]=useState('');const days=clinicCalendarDays(7);useEffect(()=>{if(date)apiRequest(`/api/appointments/slots?doctorId=${doctorId}&date=${date}`).then(setSlots).catch(e=>setError(e.message));else setSlots([])},[doctorId,date]);async function submit(e){e.preventDefault();setLoading(true);setError('');try{const app=await apiRequest('/api/patient/appointments',{method:'POST',body:JSON.stringify({doctorId,appointmentDate:date,appointmentTime:time})});setSuccessAppointmentId(app.id)}catch(e){setError(e.message)}finally{setLoading(false)}}if(successAppointmentId)return <section className="patient-card"><div className="patient-alert success"><strong>{t('bookingSuccess')}</strong><p style={{margin:'.6rem 0 0'}}>{t('bookingAttendanceNotice')}</p></div><Link className="patient-button" to={`/patient/appointments/${successAppointmentId}`} style={{marginTop:'1rem'}}>{t('viewAppointment')}</Link></section>;return <section className="patient-card"><h1>{t('bookAppointment')}</h1><form onSubmit={submit}><div className="section-heading-row"><h2>{t('selectDate')}</h2></div><div className="date-strip">{days.map(day=>{const value=day.date;return <button type="button" className={`date-chip ${date===value?'selected':''}`} key={value} onClick={()=>{setDate(value);setTime('')}} aria-pressed={date===value}><span>{day.calendarDate.toLocaleDateString(i18n.language,{weekday:'short',timeZone:'UTC'})}</span><strong>{day.calendarDate.getUTCDate()}</strong></button>})}</div>{date&&<fieldset className="patient-card"><legend>{t('selectTime')}</legend><div className="slot-grid">{slots.map(slot=><button type="button" className={`slot-chip ${time===slot?'selected':''}`} key={slot} onClick={()=>setTime(slot)} aria-pressed={time===slot}>{slot}</button>)}</div>{!slots.length&&<p>{t('noSlots')}</p>}</fieldset>}{error&&<div className="patient-alert error">{error}</div>}<button className="patient-button" style={{width:'100%'}} disabled={!time||loading}>{loading?t('loading'):t('confirmBooking')}</button></form></section>}

export function Appointments(){const{t,i18n}=useTranslation();const[group,setGroup]=useState('upcoming');const{data,error,loading}=useApi(`/api/patient/appointments?group=${group}`);return <State loading={loading} error={error}><h1>{t('myAppointments')}</h1><div className="patient-tabs">{['upcoming','past','cancelled','all'].map(x=><button className={`patient-button ${group===x?'':'secondary'}`} onClick={()=>setGroup(x)} key={x}>{t(x)}</button>)}</div>{!data?.length?<Empty>{t('noAppointments')}</Empty>:<div className="patient-list">{data.map(a=><article className="patient-card patient-row" key={a.id}><div><h2>{doctorName(a.doctor,i18n.language)}</h2><p>{a.appointmentDate} · {a.appointmentTime}</p><StatusBadge status={a.status}/></div><Link className="patient-button secondary" to={`/patient/appointments/${a.id}`}>{t('details')}</Link></article>)}</div>}</State>}
export function AppointmentDetails(){
  const{id}=useParams();
  const{t,i18n}=useTranslation();
  const{data:appointment,error,errorStatus,loading,reload}=useApi(`/api/patient/appointments/${id}`);
  const[actionError,setActionError]=useState('');
  const[confirming,setConfirming]=useState(false);
  const[cancelling,setCancelling]=useState(false);

  useEffect(()=>{setActionError('');setConfirming(false);setCancelling(false)},[id]);

  async function cancel(){
    setCancelling(true);
    setActionError('');
    try{await apiRequest(`/api/patient/appointments/${id}/cancel`,{method:'POST'});setConfirming(false);reload()}
    catch(requestError){setActionError(requestError.message)}
    finally{setCancelling(false)}
  }

  if(loading)return <div className="patient-card"><Skeleton/></div>;
  if(errorStatus===404)return <EmptyState title={t('appointmentNotFound')} message={t('appointmentNotFoundMessage')}/>;
  if(error)return <ErrorState message={error} onRetry={reload}/>;
  if(!appointment)return <EmptyState title={t('appointmentNotFound')} message={t('appointmentNotFoundMessage')}/>;

  const canModify=['PENDING','SCHEDULED','CONFIRMED'].includes(appointment.status);
  return <article className="patient-card"><h1>{t('appointmentDetails')}</h1><StatusBadge status={appointment.status}/><h2 style={{marginTop:'1.25rem'}}>{doctorName(appointment.doctor,i18n.language)}</h2><p>{appointment.appointmentDate} · {appointment.appointmentTime}</p><p>#{String(appointment.id).slice(0,8).toUpperCase()}</p>{actionError&&<div className="patient-alert error">{actionError}</div>}{canModify&&<div className="patient-actions" style={{marginTop:'1.25rem'}}><Link className="patient-button secondary" to={`/patient/appointments/${id}/reschedule`}>{t('rescheduleAppointment')}</Link><button className="patient-button" onClick={()=>setConfirming(true)}>{t('cancelAppointment')}</button></div>}<Dialog open={confirming} onClose={()=>!cancelling&&setConfirming(false)} title={t('cancelAppointmentQuestion')} description={t('cancelWarning')}><div className="ui-dialog__details"><strong>{doctorName(appointment.doctor,i18n.language)}</strong><span>{appointment.appointmentDate}</span><span>{appointment.appointmentTime}</span></div>{actionError&&<div className="patient-alert error" role="alert">{actionError}</div>}<div className="ui-dialog__actions"><button className="ui-button ui-button--outline" autoFocus onClick={()=>setConfirming(false)} disabled={cancelling}>{t('keepAppointment')}</button><button className="ui-button ui-button--danger" onClick={cancel} disabled={cancelling} aria-busy={cancelling}>{cancelling?t('loading'):t('cancelAppointment')}</button></div></Dialog></article>;
}

export function LabResults() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';

  const getTestName = (test) => {
    if (test?.service) {
      return lang === 'ar'
        ? test.service.labelAr || test.service.labelEn
        : test.service.labelEn || test.service.labelAr;
    }

    return test?.customTestName || t('customLabTest');
  };

  const getReferenceRange = (test) => {
    const min = test?.referenceRangeMin;
    const max = test?.referenceRangeMax;

    if (min == null && max == null) {
      return t('notAvailable');
    }

    if (min != null && max != null) {
      return `${min} – ${max}`;
    }

    if (min != null) {
      return `${t('greaterThanOrEqual')} ${min}`;
    }

    return `${t('lessThanOrEqual')} ${max}`;
  };

  const formatDate = (value) => {
    if (!value) return t('notAvailable');

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return t('notAvailable');
    }

    return date.toLocaleDateString(
      lang === 'ar' ? 'ar' : 'en',
      {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      }
    );
  };

  const formatDateTime = (value) => {
    if (!value) return t('notAvailable');

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return t('notAvailable');
    }

    return date.toLocaleString(
      lang === 'ar' ? 'ar' : 'en',
      {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }
    );
  };

  return (
    <Collection
      path="/api/patient/lab-results"
      titleKey="labResults"
      render={(item) => {
        const doctor = item?.doctor;
        const doctorDisplayName = doctor
          ? doctorName(doctor, lang)
          : t('notAvailable');

        return (
          <div className="patient-lab-result">
            <div className="patient-lab-result__header">
              <div>
                <span className="patient-lab-result__eyebrow">
                  {t('laboratoryReport')}
                </span>

                <h2>
                  {t('labOrderDate')}: {formatDate(item.orderDate)}
                </h2>
              </div>

              <span className="patient-lab-result__released">
                {t('released')}
              </span>
            </div>

            <div className="patient-lab-result__meta">
              <div>
                <span>{t('doctor')}</span>
                <strong>{doctorDisplayName}</strong>
              </div>

              <div>
                <span>{t('releasedAt')}</span>
                <strong>{formatDateTime(item.releasedAt)}</strong>
              </div>

              <div>
                <span>{t('testsCount')}</span>
                <strong>{item.tests?.length || 0}</strong>
              </div>
            </div>

            <div className="patient-lab-tests">
              {(item.tests || []).map((test) => {
                const abnormal = Boolean(test.isOutOfRange);

                return (
                  <article
                    className={`patient-lab-test ${
                      abnormal
                        ? 'patient-lab-test--abnormal'
                        : 'patient-lab-test--normal'
                    }`}
                    key={test.id}
                  >
                    <div className="patient-lab-test__heading">
                      <div>
                        <span className="patient-lab-test__category">
                          {test.service?.category || t('customLabTest')}
                        </span>

                        <h3>{getTestName(test)}</h3>
                      </div>

                      <span
                        className={`patient-lab-status ${
                          abnormal
                            ? 'patient-lab-status--abnormal'
                            : 'patient-lab-status--normal'
                        }`}
                      >
                        {abnormal
                          ? t('abnormalResult')
                          : t('normalResult')}
                      </span>
                    </div>

                    <div className="patient-lab-test__result">
                      <span>{t('result')}</span>
                      <strong>{test.resultValue || t('notAvailable')}</strong>
                    </div>

                    <div className="patient-lab-test__details">
                      <div>
                        <span>{t('referenceRange')}</span>
                        <strong>{getReferenceRange(test)}</strong>
                      </div>

                      <div>
                        <span>{t('resultStatus')}</span>
                        <strong>
                          {abnormal
                            ? t('outsideReferenceRange')
                            : t('withinReferenceRange')}
                        </strong>
                      </div>
                    </div>

                    {test.attachmentPath && (
                      <div className="patient-lab-test__actions">
                        <a
                          className="patient-button secondary"
                          href={test.attachmentPath}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {t('viewLabAttachment')}
                        </a>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>

            <p className="patient-lab-disclaimer">
              {t('labResultDisclaimer')}
            </p>
          </div>
        );
      }}
    />
  );
}

export function Prescriptions(){
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';

  return (
    <Collection
      path="/api/patient/prescriptions"
      titleKey="prescriptions"
      render={item=>(
        <>
          <h2>{new Date(item.prescriptionDate).toLocaleDateString(i18n.language)}</h2>
          {item.medicines.map(m=>(
            <p key={m.id}>
              {lang === 'ar'
                ? m.medicine.labelAr || m.medicine.labelEn
                : m.medicine.labelEn || m.medicine.labelAr
              }
              {' — '}
              {m.dosage}, {m.duration}
            </p>
          ))}
        </>
      )}
    />
  );
}
export function MedicalRecords(){
  const { t, i18n } = useTranslation();
  const {
    data,
    error,
    loading
  } = useApi('/api/patient/medical-records');

  const [selectedRecord, setSelectedRecord] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const lang =
    i18n.language?.startsWith('ar')
      ? 'ar'
      : 'en';

  const openRecord = async (recordId) => {
    setDetailLoading(true);
    setDetailError('');
    setSelectedRecord({ id: recordId });

    try {
      const details = await apiRequest(
        `/api/patient/medical-records/${recordId}`
      );

      setSelectedRecord(details);
    } catch (requestError) {
      setDetailError(
        requestError?.message ||
        (
          lang === 'ar'
            ? 'تعذر تحميل تفاصيل السجل الطبي.'
            : 'Unable to load medical record details.'
        )
      );
    } finally {
      setDetailLoading(false);
    }
  };

  const closeRecord = () => {
    setSelectedRecord(null);
    setDetailError('');
    setDetailLoading(false);
  };

  return (
    <State loading={loading} error={error}>
      <h1>{t('medicalRecords')}</h1>

      {!data?.length ? (
        <Empty>{t('noRecords')}</Empty>
      ) : (
        <div className="patient-list">
          {data.map((item) => (
            <button
              type="button"
              className="patient-card medical-record-card"
              key={item.id}
              onClick={() => openRecord(item.id)}
            >
              <div className="medical-record-card__header">
                <div>
                  <span className="medical-record-card__date">
                    <CalendarDays size={17}/>

                    {new Date(item.visitDate)
                      .toLocaleDateString(i18n.language)}
                  </span>

                  <h2>
                    {doctorName(
                      item.doctor,
                      i18n.language
                    )}
                  </h2>

                  <p>
                    {lang === 'ar'
                      ? (
                          item.doctor?.specialtyAr ||
                          item.doctor?.specialtyEn
                        )
                      : (
                          item.doctor?.specialtyEn ||
                          item.doctor?.specialtyAr
                        )}
                  </p>
                </div>

                <span className="medical-record-card__open">
                  {lang === 'ar'
                    ? 'عرض التفاصيل'
                    : 'View details'}
                </span>
              </div>

              <div className="medical-record-card__summary">
                <p>
                  <strong>
                    {t('diagnosisLabel')}:
                  </strong>{' '}
                  {item.diagnosis || '—'}
                </p>

                <p>
                  <strong>
                    {t('treatmentLabel')}:
                  </strong>{' '}
                  {item.treatment || '—'}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      <Dialog
        open={Boolean(selectedRecord)}
        title={
          lang === 'ar'
            ? 'تفاصيل السجل الطبي'
            : 'Medical Record Details'
        }
        description={
          lang === 'ar'
            ? 'تفاصيل الزيارة والتشخيص والعلاج والوصفات والنتائج المتاحة لك.'
            : 'Visit details, diagnosis, treatment, prescriptions and released results.'
        }
        onClose={closeRecord}
      >
        {detailLoading ? (
          <div style={{ padding: '1rem 0' }}>
            <Skeleton/>
          </div>
        ) : detailError ? (
          <div className="patient-alert error">
            {detailError}
          </div>
        ) : selectedRecord?.visitDate ? (
          <div className="medical-record-details">

            <section>
              <h3>
                {lang === 'ar'
                  ? 'معلومات الزيارة'
                  : 'Visit Information'}
              </h3>

              <p>
                <strong>
                  {lang === 'ar'
                    ? 'التاريخ:'
                    : 'Date:'}
                </strong>{' '}

                {new Date(
                  selectedRecord.visitDate
                ).toLocaleString(i18n.language)}
              </p>

              <p>
                <strong>
                  {lang === 'ar'
                    ? 'الطبيب:'
                    : 'Doctor:'}
                </strong>{' '}

                {doctorName(
                  selectedRecord.doctor,
                  i18n.language
                )}
              </p>

              <p>
                <strong>
                  {lang === 'ar'
                    ? 'التخصص:'
                    : 'Specialty:'}
                </strong>{' '}

                {lang === 'ar'
                  ? (
                      selectedRecord.doctor
                        ?.specialtyAr ||
                      selectedRecord.doctor
                        ?.specialtyEn
                    )
                  : (
                      selectedRecord.doctor
                        ?.specialtyEn ||
                      selectedRecord.doctor
                        ?.specialtyAr
                    )}
              </p>
            </section>

            <section>
              <h3>
                {lang === 'ar'
                  ? 'التقييم الطبي'
                  : 'Clinical Assessment'}
              </h3>

              <p>
                <strong>
                  {lang === 'ar'
                    ? 'الأعراض:'
                    : 'Symptoms:'}
                </strong>{' '}

                {selectedRecord.symptoms || '—'}
              </p>

              <p>
                <strong>
                  {t('diagnosisLabel')}:
                </strong>{' '}

                {selectedRecord.diagnosis || '—'}
              </p>

              <p>
                <strong>
                  {t('treatmentLabel')}:
                </strong>{' '}

                {selectedRecord.treatment || '—'}
              </p>
            </section>

            {selectedRecord.vitalSigns &&
              Object.keys(
                selectedRecord.vitalSigns
              ).length > 0 && (
              <section>
                <h3>
                  {lang === 'ar'
                    ? 'العلامات الحيوية'
                    : 'Vital Signs'}
                </h3>

                <div className="medical-vitals-grid">
                  {Object.entries(
                    selectedRecord.vitalSigns
                  ).map(([key, value]) => (
                    <div key={key}>
                      <span>
                        {key.replaceAll('_', ' ')}
                      </span>

                      <strong>
                        {value || '—'}
                      </strong>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h3>
                {lang === 'ar'
                  ? 'الوصفات الطبية'
                  : 'Prescriptions'}
              </h3>

              {!selectedRecord.prescriptions
                ?.some(
                  (prescription) =>
                    prescription.medicines?.length
                ) ? (
                <p>
                  {lang === 'ar'
                    ? 'لا توجد أدوية في هذه الزيارة.'
                    : 'No medicines were prescribed during this visit.'}
                </p>
              ) : (
                selectedRecord.prescriptions
                  .flatMap(
                    (prescription) =>
                      prescription.medicines || []
                  )
                  .map((medicine) => (
                    <div
                      key={medicine.id}
                      className="medical-detail-item"
                    >
                      <strong>
                        {lang === 'ar'
                          ? (
                              medicine.medicine
                                ?.labelAr ||
                              medicine.medicine
                                ?.labelEn ||
                              medicine.customDrugName
                            )
                          : (
                              medicine.medicine
                                ?.labelEn ||
                              medicine.medicine
                                ?.labelAr ||
                              medicine.customDrugName
                            )}
                      </strong>

                      <p>
                        {lang === 'ar'
                          ? 'الجرعة'
                          : 'Dosage'}
                        :{' '}
                        {medicine.dosage || '—'}
                      </p>

                      <p>
                        {lang === 'ar'
                          ? 'المدة'
                          : 'Duration'}
                        :{' '}
                        {medicine.duration || '—'}
                      </p>

                      {(medicine.instructionsAr ||
                        medicine.instructionsEn) && (
                        <p>
                          {lang === 'ar'
                            ? 'التعليمات'
                            : 'Instructions'}
                          :{' '}

                          {lang === 'ar'
                            ? (
                                medicine.instructionsAr ||
                                medicine.instructionsEn
                              )
                            : (
                                medicine.instructionsEn ||
                                medicine.instructionsAr
                              )}
                        </p>
                      )}
                    </div>
                  ))
              )}
            </section>

            <section>
              <h3>
                {lang === 'ar'
                  ? 'نتائج المختبر'
                  : 'Laboratory Results'}
              </h3>

              {!selectedRecord
                .releasedLabResults?.length ? (
                <p>
                  {lang === 'ar'
                    ? 'لا توجد نتائج مختبر مفرج عنها لهذه الزيارة.'
                    : 'No released laboratory results are available for this visit.'}
                </p>
              ) : (
                selectedRecord.releasedLabResults
                  .map((result) => (
                    <div
                      key={result.id}
                      className="medical-detail-item"
                    >
                      <strong>
                        {lang === 'ar'
                          ? (
                              result.testNameAr ||
                              result.testNameEn
                            )
                          : (
                              result.testNameEn ||
                              result.testNameAr
                            )}
                      </strong>

                      <p>
                        {lang === 'ar'
                          ? 'النتيجة'
                          : 'Result'}
                        :{' '}
                        {result.resultValue || '—'}
                      </p>

                      {(result.referenceRangeMin ||
                        result.referenceRangeMax) && (
                        <p>
                          {lang === 'ar'
                            ? 'المدى المرجعي'
                            : 'Reference range'}
                          :{' '}

                          {result.referenceRangeMin || '—'}
                          {' – '}
                          {result.referenceRangeMax || '—'}
                        </p>
                      )}

                      {result.isOutOfRange && (
                        <span
                          className="badge badge-warning"
                        >
                          {lang === 'ar'
                            ? 'خارج المعدل المرجعي'
                            : 'Outside reference range'}
                        </span>
                      )}
                    </div>
                  ))
              )}
            </section>

            {selectedRecord.attachmentPath && (
              <section>
                <a
                  className="patient-button secondary"
                  href={selectedRecord.attachmentPath}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {lang === 'ar'
                    ? 'فتح المرفق'
                    : 'Open Attachment'}
                </a>
              </section>
            )}

            <button
              type="button"
              className="patient-button secondary"
              onClick={closeRecord}
              style={{ width: '100%' }}
            >
              {lang === 'ar'
                ? 'إغلاق'
                : 'Close'}
            </button>
          </div>
        ) : null}
      </Dialog>
    </State>
  );
}

function Collection({path,titleKey,render}){const{t}=useTranslation();const{data,error,loading}=useApi(path);return <State loading={loading} error={error}><h1>{t(titleKey)}</h1>{!data?.length?<Empty>{t('noRecords')}</Empty>:data.map(item=><article className="patient-card" key={item.id}>{render(item)}</article>)}</State>}
export function Profile() {
  const { t, i18n } = useTranslation();
  const {
    data,
    error,
    loading,
    reload
  } = useApi('/api/patient/me');

  const lang = i18n.language === 'ar' ? 'ar' : 'en';

  const [form, setForm] = useState(null);
  const [message, setMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  const [emailChangeOpen, setEmailChangeOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailChallengeId, setEmailChallengeId] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [emailChanging, setEmailChanging] = useState(false);
  const [emailChangeError, setEmailChangeError] = useState('');
  const [emailChangeMessage, setEmailChangeMessage] = useState('');

  const [phoneChangeOpen, setPhoneChangeOpen] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [phoneChallengeId, setPhoneChallengeId] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneChanging, setPhoneChanging] = useState(false);
  const [phoneChangeError, setPhoneChangeError] = useState('');
  const [phoneChangeMessage, setPhoneChangeMessage] = useState('');

  useEffect(() => {
    if (!data) return;

    setForm({
      addressStateId: data.addressStateId,
      addressDetails: data.addressDetails || '',
      emergencyContact: data.emergencyContact || '',
      bloodType: data.bloodType || '',
      preferredLanguage: data.preferredLanguage
    });
  }, [data]);

  async function save(event) {
    event.preventDefault();

    if (!form || saving) return;

    setSaving(true);
    setMessage('');
    setSaveError('');

    try {
      await apiRequest('/api/patient/me', {
        method: 'PATCH',
        body: JSON.stringify({
          addressStateId: form.addressStateId,
          addressDetails: form.addressDetails || null,
          emergencyContact: form.emergencyContact,
          bloodType: form.bloodType || null,
          preferredLanguage: form.preferredLanguage
        })
      });

      setMessage(
        lang === 'ar'
          ? 'تم حفظ التغييرات بنجاح.'
          : 'Profile changes saved successfully.'
      );

      try {
        await reload();
      } catch (reloadError) {
        console.error('Patient profile reload error:', reloadError);
      }
    } catch (requestError) {
      console.error('Patient profile save error:', requestError);

      setSaveError(
        requestError?.message ||
          (
            lang === 'ar'
              ? 'تعذر حفظ التغييرات. يرجى المحاولة مرة أخرى.'
              : 'Unable to save profile changes. Please try again.'
          )
      );
    } finally {
      setSaving(false);
    }
  }

  async function requestEmailChange(event) {
    event.preventDefault();

    setEmailChanging(true);
    setEmailChangeError('');
    setEmailChangeMessage('');

    try {
      const result = await apiRequest(
        '/api/patient/me/email-change/request',
        {
          method: 'POST',
          body: JSON.stringify({
            email: newEmail.trim()
          })
        }
      );

      setEmailChallengeId(result.challengeId);

      setEmailChangeMessage(
        lang === 'ar'
          ? 'تم إرسال رمز تحقق إلى البريد الإلكتروني الجديد.'
          : 'A verification code was sent to the new email address.'
      );
    } catch (requestError) {
      setEmailChangeError(
        requestError?.message ||
          (
            lang === 'ar'
              ? 'تعذر إرسال رمز التحقق.'
              : 'Unable to send verification code.'
          )
      );
    } finally {
      setEmailChanging(false);
    }
  }

  async function verifyEmailChange(event) {
    event.preventDefault();

    setEmailChanging(true);
    setEmailChangeError('');

    try {
      await apiRequest(
        '/api/patient/me/email-change/verify',
        {
          method: 'POST',
          body: JSON.stringify({
            challengeId: emailChallengeId,
            code: emailCode
          })
        }
      );

      setEmailChangeMessage(
        lang === 'ar'
          ? 'تم تغيير البريد الإلكتروني والتحقق منه بنجاح.'
          : 'Email address changed and verified successfully.'
      );

      setEmailChangeOpen(false);
      setEmailChallengeId('');
      setEmailCode('');
      setNewEmail('');

      try {
        await reload();
      } catch (reloadError) {
        console.error('Patient profile reload error:', reloadError);
      }
    } catch (requestError) {
      setEmailChangeError(
        requestError?.message ||
          (
            lang === 'ar'
              ? 'تعذر التحقق من رمز البريد الإلكتروني.'
              : 'Unable to verify the email change code.'
          )
      );
    } finally {
      setEmailChanging(false);
    }
  }

  async function requestPhoneChange(event) {
    event.preventDefault();

    setPhoneChanging(true);
    setPhoneChangeError('');
    setPhoneChangeMessage('');

    try {
      const result = await apiRequest(
        '/api/patient/me/phone-change/request',
        {
          method: 'POST',
          body: JSON.stringify({
            phone: newPhone.trim()
          })
        }
      );

      setPhoneChallengeId(result.challengeId);

      setPhoneChangeMessage(
        lang === 'ar'
          ? `تم إرسال رمز تأكيد إلى بريدك الإلكتروني الموثق${result.deliveredTo ? ` (${result.deliveredTo})` : ''}.`
          : `An authorization code was sent to your verified email${result.deliveredTo ? ` (${result.deliveredTo})` : ''}.`
      );
    } catch (requestError) {
      setPhoneChangeError(
        requestError?.message ||
          (
            lang === 'ar'
              ? 'تعذر بدء عملية تغيير رقم الهاتف.'
              : 'Unable to start the phone number change.'
          )
      );
    } finally {
      setPhoneChanging(false);
    }
  }

  async function verifyPhoneChange(event) {
    event.preventDefault();

    setPhoneChanging(true);
    setPhoneChangeError('');

    try {
      await apiRequest(
        '/api/patient/me/phone-change/verify',
        {
          method: 'POST',
          body: JSON.stringify({
            challengeId: phoneChallengeId,
            code: phoneCode
          })
        }
      );

      setPhoneChangeMessage(
        lang === 'ar'
          ? 'تم تغيير رقم الهاتف. سيظل الرقم غير موثق حتى يتم التحقق منه عبر SMS.'
          : 'Phone number changed. It will remain unverified until SMS verification is available.'
      );

      setPhoneChangeOpen(false);
      setPhoneChallengeId('');
      setPhoneCode('');
      setNewPhone('');

      try {
        await reload();
      } catch (reloadError) {
        console.error('Patient profile reload error:', reloadError);
      }
    } catch (requestError) {
      setPhoneChangeError(
        requestError?.message ||
          (
            lang === 'ar'
              ? 'تعذر التحقق من رمز تغيير رقم الهاتف.'
              : 'Unable to verify the phone change code.'
          )
      );
    } finally {
      setPhoneChanging(false);
    }
  }

  return (
    <State
      loading={loading}
      error={error}
    >
      {form && data && (
        <>
          <section className="patient-card">
            <h1>{t('profile')}</h1>

            <h2>
              {lang === 'ar'
                ? data.fullNameAr || data.fullNameEn
                : data.fullNameEn || data.fullNameAr}
            </h2>

            <div
              style={{
                display: 'grid',
                gap: '.35rem',
                marginBottom: '1.25rem'
              }}
            >
              <p style={{ margin: 0 }}>
                <strong>
                  {lang === 'ar'
                    ? 'رقم الهاتف:'
                    : 'Phone:'}
                </strong>{' '}
                {data.phone || (
                  lang === 'ar'
                    ? 'غير متوفر'
                    : 'Not available'
                )}
              </p>

              <p style={{ margin: 0 }}>
                <strong>
                  {lang === 'ar'
                    ? 'البريد الإلكتروني:'
                    : 'Email:'}
                </strong>{' '}
                {data.email || (
                  lang === 'ar'
                    ? 'غير متوفر'
                    : 'Not available'
                )}
              </p>
            </div>

            <form onSubmit={save}>
              <label className="patient-field">
                {t('addressState')}

                <select
                  value={form.addressStateId || ''}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      addressStateId: Number(event.target.value)
                    })
                  }
                >
                  <option value="">
                    {t('selectState')}
                  </option>

                  <option value="1">{t('stateKhartoum')}</option>
                  <option value="2">{t('stateGezira')}</option>
                  <option value="3">{t('stateRedSea')}</option>
                  <option value="4">{t('stateKassala')}</option>
                  <option value="5">{t('stateGedaref')}</option>
                  <option value="6">{t('stateSennar')}</option>
                  <option value="7">{t('stateBlueNile')}</option>
                  <option value="8">{t('stateWhiteNile')}</option>
                  <option value="9">{t('stateRiverNile')}</option>
                  <option value="10">{t('stateNorthern')}</option>
                  <option value="11">{t('stateWestKordofan')}</option>
                  <option value="12">{t('stateNorthKordofan')}</option>
                  <option value="13">{t('stateSouthKordofan')}</option>
                  <option value="14">{t('stateNorthDarfur')}</option>
                  <option value="15">{t('stateWestDarfur')}</option>
                  <option value="16">{t('stateSouthDarfur')}</option>
                  <option value="17">{t('stateEastDarfur')}</option>
                  <option value="18">{t('stateCentralDarfur')}</option>
                </select>
              </label>

              <label className="patient-field">
                {lang === 'ar'
                  ? 'فصيلة الدم'
                  : 'Blood Type'}

                <select
                  value={form.bloodType || ''}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      bloodType: event.target.value
                    })
                  }
                >
                  <option value="">
                    {lang === 'ar'
                      ? 'اختر فصيلة الدم'
                      : 'Select blood type'}
                  </option>

                  <option value="A+">A+</option>
                  <option value="A-">A-</option>
                  <option value="B+">B+</option>
                  <option value="B-">B-</option>
                  <option value="AB+">AB+</option>
                  <option value="AB-">AB-</option>
                  <option value="O+">O+</option>
                  <option value="O-">O-</option>
                </select>
              </label>

              <label className="patient-field">
                {t('addressDetails')}

                <input
                  value={form.addressDetails}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      addressDetails: event.target.value
                    })
                  }
                />
              </label>

              <label className="patient-field">
                {t('emergencyContact')}

                <input
                  value={form.emergencyContact}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      emergencyContact: event.target.value
                    })
                  }
                />
              </label>

              {saveError && (
                <div
                  className="patient-alert error"
                  role="alert"
                >
                  {saveError}
                </div>
              )}

              {message && (
                <div
                  className="patient-alert success"
                  role="status"
                >
                  {message}
                </div>
              )}

              <button
                className="patient-button"
                disabled={saving}
              >
                {saving
                  ? t('loading')
                  : t('save')}
              </button>
            </form>
          </section>

          <section className="patient-card">
            <h2>{t('accountSecurity')}</h2>

            {/* Email */}
            <div
              style={{
                padding: '1rem 0',
                borderBottom: '1px solid var(--border-color)'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  flexWrap: 'wrap',
                  alignItems: 'center'
                }}
              >
                <div>
                  <strong>
                    {lang === 'ar'
                      ? 'البريد الإلكتروني'
                      : 'Email'}
                  </strong>

                  <p style={{ margin: '.3rem 0' }}>
                    {data.email || '-'}
                  </p>

                  <StatusBadge
                    status={
                      data.emailVerified
                        ? 'CONFIRMED'
                        : 'PENDING'
                    }
                  />
                </div>

                <button
                  type="button"
                  className="patient-button secondary"
                  onClick={() => {
                    setEmailChangeOpen((current) => !current);
                    setEmailChangeError('');
                    setEmailChangeMessage('');
                  }}
                >
                  {lang === 'ar'
                    ? 'تغيير البريد'
                    : 'Change Email'}
                </button>
              </div>

              {emailChangeOpen && (
                <div style={{ marginTop: '1rem' }}>
                  {!emailChallengeId ? (
                    <form onSubmit={requestEmailChange}>
                      <label className="patient-field">
                        {lang === 'ar'
                          ? 'البريد الإلكتروني الجديد'
                          : 'New email address'}

                        <input
                          type="email"
                          value={newEmail}
                          onChange={(event) =>
                            setNewEmail(event.target.value)
                          }
                          required
                        />
                      </label>

                      <button
                        className="patient-button"
                        disabled={emailChanging || !newEmail.trim()}
                      >
                        {emailChanging
                          ? t('loading')
                          : (
                              lang === 'ar'
                                ? 'إرسال رمز التحقق'
                                : 'Send Verification Code'
                            )}
                      </button>
                    </form>
                  ) : (
                    <form onSubmit={verifyEmailChange}>
                      <label className="patient-field">
                        {lang === 'ar'
                          ? 'رمز التحقق'
                          : 'Verification code'}

                        <input
                          inputMode="numeric"
                          maxLength={6}
                          value={emailCode}
                          onChange={(event) =>
                            setEmailCode(
                              event.target.value.replace(/\D/g, '')
                            )
                          }
                          required
                        />
                      </label>

                      <button
                        className="patient-button"
                        disabled={
                          emailChanging ||
                          emailCode.length !== 6
                        }
                      >
                        {emailChanging
                          ? t('loading')
                          : (
                              lang === 'ar'
                                ? 'تأكيد البريد الجديد'
                                : 'Confirm New Email'
                            )}
                      </button>
                    </form>
                  )}

                  {emailChangeError && (
                    <div className="patient-alert error">
                      {emailChangeError}
                    </div>
                  )}

                  {emailChangeMessage && (
                    <div className="patient-alert success">
                      {emailChangeMessage}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Phone */}
            <div style={{ padding: '1rem 0' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  flexWrap: 'wrap',
                  alignItems: 'center'
                }}
              >
                <div>
                  <strong>
                    {lang === 'ar'
                      ? 'رقم الهاتف'
                      : 'Phone'}
                  </strong>

                  <p style={{ margin: '.3rem 0' }}>
                    {data.phone || '-'}
                  </p>

                  <StatusBadge
                    status={
                      data.phoneVerified
                        ? 'CONFIRMED'
                        : 'PENDING'
                    }
                  />
                </div>

                <button
                  type="button"
                  className="patient-button secondary"
                  onClick={() => {
                    setPhoneChangeOpen((current) => !current);
                    setPhoneChangeError('');
                    setPhoneChangeMessage('');
                  }}
                >
                  {lang === 'ar'
                    ? 'تغيير رقم الهاتف'
                    : 'Change Phone'}
                </button>
              </div>

              {phoneChangeOpen && (
                <div style={{ marginTop: '1rem' }}>
                  {!phoneChallengeId ? (
                    <form onSubmit={requestPhoneChange}>
                      <label className="patient-field">
                        {lang === 'ar'
                          ? 'رقم الهاتف الجديد'
                          : 'New phone number'}

                        <input
                          value={newPhone}
                          onChange={(event) =>
                            setNewPhone(event.target.value)
                          }
                          placeholder="+249..."
                          required
                        />
                      </label>

                      <button
                        className="patient-button"
                        disabled={phoneChanging || !newPhone.trim()}
                      >
                        {phoneChanging
                          ? t('loading')
                          : (
                              lang === 'ar'
                                ? 'إرسال رمز التأكيد'
                                : 'Send Authorization Code'
                            )}
                      </button>
                    </form>
                  ) : (
                    <form onSubmit={verifyPhoneChange}>
                      <label className="patient-field">
                        {lang === 'ar'
                          ? 'رمز التأكيد المرسل إلى بريدك'
                          : 'Authorization code sent to your email'}

                        <input
                          inputMode="numeric"
                          maxLength={6}
                          value={phoneCode}
                          onChange={(event) =>
                            setPhoneCode(
                              event.target.value.replace(/\D/g, '')
                            )
                          }
                          required
                        />
                      </label>

                      <button
                        className="patient-button"
                        disabled={
                          phoneChanging ||
                          phoneCode.length !== 6
                        }
                      >
                        {phoneChanging
                          ? t('loading')
                          : (
                              lang === 'ar'
                                ? 'تأكيد تغيير الرقم'
                                : 'Confirm Phone Change'
                            )}
                      </button>
                    </form>
                  )}

                  {phoneChangeError && (
                    <div className="patient-alert error">
                      {phoneChangeError}
                    </div>
                  )}

                  {phoneChangeMessage && (
                    <div className="patient-alert success">
                      {phoneChangeMessage}
                    </div>
                  )}

                  <p
                    style={{
                      marginTop: '.75rem',
                      fontSize: '.85rem',
                      opacity: .75
                    }}
                  >
                    {lang === 'ar'
                      ? 'يتم تأكيد طلب تغيير الرقم عبر بريدك الموثق حالياً. سيظل الرقم الجديد بحالة قيد التحقق حتى يتوفر التحقق عبر SMS.'
                      : 'The change is authorized through your currently verified email. The new phone remains pending until SMS verification is available.'}
                  </p>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </State>
  );
}
