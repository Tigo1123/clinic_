import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { patientApiRequest as apiRequest } from '../../../../services/apiClient';
import StatusBadge from '../../../../components/ui/StatusBadge';
import Dialog from '../../../../components/ui/Dialog';
import { EmptyState, ErrorState, Skeleton } from '../../../../components/feedback/States';
import { useApi, doctorName } from './shared.jsx';

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
  return <article className="patient-card"><h1>{t('appointmentDetails')}</h1><StatusBadge status={appointment.status} language={i18n.language}/><h2 style={{marginTop:'1.25rem'}}>{doctorName(appointment.doctor,i18n.language)}</h2><p><bdi dir="ltr">{appointment.appointmentDate} · {appointment.appointmentTime}</bdi></p><p>#{String(appointment.id).slice(0,8).toUpperCase()}</p>{actionError&&<div className="patient-alert error" role="alert">{actionError}</div>}{canModify&&<div className="patient-actions" style={{marginTop:'1.25rem'}}><Link className="patient-button secondary" to={`/patient/appointments/${id}/reschedule`}>{t('rescheduleAppointment')}</Link><button className="patient-button" onClick={()=>setConfirming(true)}>{t('cancelAppointment')}</button></div>}<Dialog open={confirming} onClose={()=>!cancelling&&setConfirming(false)} title={t('cancelAppointmentQuestion')} description={t('cancelWarning')}><div className="ui-dialog__details"><strong>{doctorName(appointment.doctor,i18n.language)}</strong><span dir="ltr">{appointment.appointmentDate}</span><span dir="ltr">{appointment.appointmentTime}</span></div>{actionError&&<div className="patient-alert error" role="alert">{actionError}</div>}<div className="ui-dialog__actions"><button className="ui-button ui-button--outline" onClick={()=>setConfirming(false)} disabled={cancelling}>{t('keepAppointment')}</button><button className="ui-button ui-button--danger" onClick={cancel} disabled={cancelling} aria-busy={cancelling}>{cancelling?t('loading'):t('cancelAppointment')}</button></div></Dialog></article>;
}
