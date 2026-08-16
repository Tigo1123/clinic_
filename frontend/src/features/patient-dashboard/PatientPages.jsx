import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiRequest } from '../../services/apiClient';
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
const doctorName=(doctor,lang)=>lang==='ar'?doctor?.fullNameAr:doctor?.fullNameEn;

export function Dashboard(){const{t,i18n}=useTranslation();const profile=useApi('/api/patient/me');const appointments=useApi('/api/patient/appointments?group=upcoming');const labs=useApi('/api/patient/lab-results');const prescriptions=useApi('/api/patient/prescriptions');if(profile.error?.includes('not linked'))return <><div className="patient-alert error">{profile.error}</div><Link className="patient-button" to="/patient/claim">{t('claimRecord')}</Link></>;const next=appointments.data?.[0];return <State loading={profile.loading} error={profile.error}><section className="patient-hero patient-hero--care"><div className="patient-hero__copy"><span className="patient-hero__eyebrow"><HeartPulse size={15}/>{t('welcome')}</span><h1>{profile.data?.fullNameEn}</h1><p>{t('patientHeroText')}</p><Link className="patient-button" to="/patient/doctors"><CalendarDays size={18}/>{t('bookAppointment')}</Link></div><HealthcareIllustration variant="patient"/></section><div className="section-heading-row"><h2>{t('healthServices')}</h2></div><div className="service-grid"><Service to="/patient/doctors" icon={<Stethoscope/>} label={t('doctors')}/><Service to="/patient/appointments" icon={<CalendarDays/>} label={t('myAppointments')}/><Service to="/patient/lab-results" icon={<FlaskConical/>} label={t('labResults')}/><Service to="/patient/records" icon={<FileHeart/>} label={t('medicalRecords')}/></div><div className="section-heading-row"><h2>{t('upcomingAppointments')}</h2><Link to="/patient/appointments">{t('all')}</Link></div>{next?<article className="patient-card appointment-card"><div className="appointment-card__date"><span>{new Date(`${next.appointmentDate}T00:00:00`).toLocaleDateString(i18n.language,{month:'short'})}</span><strong>{new Date(`${next.appointmentDate}T00:00:00`).getDate()}</strong></div><div><h2>{doctorName(next.doctor,i18n.language)}</h2><p>{next.doctor?.specialtyEn}</p><p>{next.appointmentTime} · <StatusBadge status={next.status}/></p></div><Link className="patient-button secondary" to={`/patient/appointments/${next.id}`}>{t('details')}</Link></article>:<Empty>{t('noAppointments')}</Empty>}<div className="section-heading-row"><h2>{t('recentPatientInfo')}</h2></div><div className="patient-grid"><Summary icon={<CalendarDays/>} title={t('upcomingAppointments')} value={appointments.data?.length||0}/><Summary icon={<FlaskConical/>} title={t('recentLabResults')} value={labs.data?.length||0}/><Summary icon={<Pill/>} title={t('prescriptions')} value={prescriptions.data?.length||0}/></div></State>}
function Service({to,icon,label}){return <Link className="service-card" to={to}><span className="service-card__icon">{icon}</span><strong>{label}</strong></Link>}
function Summary({icon,title,value}){return <div className="patient-card"><div style={{color:'var(--color-primary)'}}>{icon}</div><h3>{title}</h3><strong>{value}</strong></div>}

export function Doctors(){const{t,i18n}=useTranslation();const{data,error,loading}=useApi('/api/patient/doctors');const[query,setQuery]=useState('');const[specialty,setSpecialty]=useState('');const specialties=[...new Set((data||[]).map(d=>i18n.language==='ar'?d.specialtyAr:d.specialtyEn).filter(Boolean))];const filtered=(data||[]).filter(d=>{const name=doctorName(d,i18n.language)||'';const spec=i18n.language==='ar'?d.specialtyAr:d.specialtyEn;return(!query||`${name} ${spec}`.toLowerCase().includes(query.toLowerCase()))&&(!specialty||spec===specialty)});return <State loading={loading} error={error}><header className="doctor-search-header"><div><span>{t('healthServices')}</span><h1>{t('doctors')}</h1></div><label className="doctor-search"><Search size={19}/><span className="sr-only">{t('search')}</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={t('search')}/></label></header>{specialties.length>0&&<div className="specialty-chips" aria-label={t('selectSpecialty')}><button className={!specialty?'selected':''} onClick={()=>setSpecialty('')}>{t('all')}</button>{specialties.map(s=><button className={specialty===s?'selected':''} onClick={()=>setSpecialty(s)} key={s}>{s}</button>)}</div>}<div className="section-heading-row"><h2>{t('doctors')}</h2><span>{filtered.length}</span></div>{!filtered.length?<Empty>{t('noDoctors')}</Empty>:<div className="doctor-list">{filtered.map(d=><article className="patient-card doctor-card" key={d.id}><div className="doctor-card__avatar"><UserRound/></div><div className="doctor-card__body"><h2>{doctorName(d,i18n.language)}</h2><p>{i18n.language==='ar'?d.specialtyAr:d.specialtyEn}</p><strong>
      {Number(d.consultationFee).toLocaleString(
        i18n.language === 'ar' ? 'ar' : 'en'
      )}{' '}
      {i18n.language === 'ar' ? 'ج.س' : 'SDG'}
    </strong><div className="patient-actions"><Link className="patient-button secondary" to={`/patient/doctors/${d.id}`}>{t('details')}</Link><Link className="patient-button" to={`/patient/book/${d.id}`}>{t('book')}</Link></div></div></article>)}</div>}</State>}
export function DoctorDetails(){const{id}=useParams();const{t,i18n}=useTranslation();const{data,error,loading,reload}=useApi(`/api/patient/doctors/${id}`);if(loading)return <div className="patient-card"><Skeleton/></div>;if(error)return <ErrorState message={error} onRetry={reload}/>;if(!data)return <EmptyState title={t('doctorNotFound')}/>;return <article className="patient-card doctor-profile"><div className="doctor-profile__avatar"><UserRound/></div><div><span className="doctor-profile__label"><Stethoscope size={16}/>{t('doctors')}</span><h1>{doctorName(data,i18n.language)}</h1><p>{i18n.language==='ar'?data.specialtyAr:data.specialtyEn}</p><strong>
      {Number(data.consultationFee).toLocaleString(
        i18n.language === 'ar' ? 'ar' : 'en'
      )}{' '}
      {i18n.language === 'ar' ? 'ج.س' : 'SDG'}
    </strong></div><Link className="patient-button" to={`/patient/book/${id}`}><CalendarDays size={18}/>{t('bookAppointment')}</Link></article>}
export function BookAppointment(){const{doctorId}=useParams();const{t,i18n}=useTranslation();const nav=useNavigate();const[date,setDate]=useState(''),[slots,setSlots]=useState([]),[time,setTime]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false);const days=clinicCalendarDays(7);useEffect(()=>{if(date)apiRequest(`/api/appointments/slots?doctorId=${doctorId}&date=${date}`).then(setSlots).catch(e=>setError(e.message));else setSlots([])},[doctorId,date]);async function submit(e){e.preventDefault();setLoading(true);setError('');try{const app=await apiRequest('/api/patient/appointments',{method:'POST',body:JSON.stringify({doctorId,appointmentDate:date,appointmentTime:time})});nav(`/patient/appointments/${app.id}`)}catch(e){setError(e.message)}finally{setLoading(false)}}return <section className="patient-card"><h1>{t('bookAppointment')}</h1><form onSubmit={submit}><div className="section-heading-row"><h2>{t('selectDate')}</h2></div><div className="date-strip">{days.map(day=>{const value=day.date;return <button type="button" className={`date-chip ${date===value?'selected':''}`} key={value} onClick={()=>{setDate(value);setTime('')}} aria-pressed={date===value}><span>{day.calendarDate.toLocaleDateString(i18n.language,{weekday:'short',timeZone:'UTC'})}</span><strong>{day.calendarDate.getUTCDate()}</strong></button>})}</div>{date&&<fieldset className="patient-card"><legend>{t('selectTime')}</legend><div className="slot-grid">{slots.map(slot=><button type="button" className={`slot-chip ${time===slot?'selected':''}`} key={slot} onClick={()=>setTime(slot)} aria-pressed={time===slot}>{slot}</button>)}</div>{!slots.length&&<p>{t('noSlots')}</p>}</fieldset>}{error&&<div className="patient-alert error">{error}</div>}<button className="patient-button" style={{width:'100%'}} disabled={!time||loading}>{loading?t('loading'):t('confirmBooking')}</button></form></section>}

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

export function LabResults(){
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';

  return (
    <Collection
      path="/api/patient/lab-results"
      titleKey="labResults"
      render={item=>(
        <>
          <h2>{new Date(item.orderDate).toLocaleDateString(i18n.language)}</h2>
          {item.tests.map(test=>(
            <p key={test.id}>
              {lang === 'ar'
                ? test.service.labelAr || test.service.labelEn
                : test.service.labelEn || test.service.labelAr
              }:{' '}
              <strong>{test.resultValue}</strong>
            </p>
          ))}
        </>
      )}
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

  return (
    <Collection
      path="/api/patient/medical-records"
      titleKey="medicalRecords"
      render={item=>(
        <>
          <h2>{new Date(item.visitDate).toLocaleDateString(i18n.language)}</h2>
          <p><strong>{t('diagnosisLabel')}:</strong>{' '}{item.diagnosis}</p>
          <p><strong>{t('treatmentLabel')}:</strong>{' '}{item.treatment}</p>
        </>
      )}
    />
  );
}
function Collection({path,titleKey,render}){const{t}=useTranslation();const{data,error,loading}=useApi(path);return <State loading={loading} error={error}><h1>{t(titleKey)}</h1>{!data?.length?<Empty>{t('noRecords')}</Empty>:data.map(item=><article className="patient-card" key={item.id}>{render(item)}</article>)}</State>}
export function Profile(){const{t}=useTranslation();const{data,error,loading,reload}=useApi('/api/patient/me');const[form,setForm]=useState(null),[message,setMessage]=useState('');const[saving,setSaving]=useState(false);useEffect(()=>{if(data)setForm({addressStateId:data.addressStateId,addressDetails:data.addressDetails||'',emergencyContact:data.emergencyContact||'',preferredLanguage:data.preferredLanguage})},[data]);async function save(e){e.preventDefault();setSaving(true);try{await apiRequest('/api/patient/me',{method:'PATCH',body:JSON.stringify(form)});setMessage(t('saved'));reload()}finally{setSaving(false)}}return <State loading={loading} error={error}>{form&&<><section className="patient-card"><h1>{t('profile')}</h1><h2>{data.fullNameEn}</h2><p>{data.phone}{data.email?` · ${data.email}`:''}</p><form onSubmit={save}><label className="patient-field">{t('addressState')}<select
  value={form.addressStateId || ''}
  onChange={e=>setForm({...form,addressStateId:Number(e.target.value)})}
>
  <option value="">{t('selectState')}</option>
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
</select></label><label className="patient-field">{t('addressDetails')}<input value={form.addressDetails} onChange={e=>setForm({...form,addressDetails:e.target.value})}/></label><label className="patient-field">{t('emergencyContact')}<input value={form.emergencyContact} onChange={e=>setForm({...form,emergencyContact:e.target.value})}/></label>{message&&<div className="patient-alert success">{message}</div>}<button className="patient-button" disabled={saving}>{saving?t('loading'):t('save')}</button></form></section><section className="patient-card"><h2>{t('accountSecurity')}</h2><p>{t('phone')}: <StatusBadge status={data.phoneVerified?'CONFIRMED':'PENDING'}/></p>{data.email&&<p>{t('emailOptional')}: <StatusBadge status={data.emailVerified?'CONFIRMED':'PENDING'}/></p>}</section></>}</State>}
