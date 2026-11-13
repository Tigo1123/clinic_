import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarDays, Stethoscope, UserRound } from 'lucide-react';
import { EmptyState, ErrorState, Skeleton } from '../../../../components/feedback/States';
import { localizeDoctorSpecialty } from '../doctorSpecialty';
import { useApi, doctorName } from './shared.jsx';

export function DoctorDetails(){const{id}=useParams();const{t,i18n}=useTranslation();const{data,error,loading,reload}=useApi(`/api/patient/doctors/${id}`);if(loading)return <div className="patient-card"><Skeleton/></div>;if(error)return <ErrorState message={error} onRetry={reload}/>;if(!data)return <EmptyState title={t('doctorNotFound')}/>;return <article className="patient-card doctor-profile"><div className="doctor-profile__avatar"><UserRound/></div><div><span className="doctor-profile__label"><Stethoscope size={16}/>{t('doctors')}</span><h1>{doctorName(data,i18n.language)}</h1><p>{localizeDoctorSpecialty(data,i18n.language)}</p><strong>
      {Number(data.consultationFee).toLocaleString(
        i18n.language === 'ar' ? 'ar' : 'en'
      )}{' '}
      {i18n.language === 'ar' ? 'ج.س' : 'SDG'}
    </strong></div><Link className="patient-button" to={`/patient/book/${id}`}><CalendarDays size={18}/>{t('bookAppointment')}</Link></article>}
