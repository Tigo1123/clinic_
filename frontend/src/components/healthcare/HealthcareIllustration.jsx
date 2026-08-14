import { Activity, BarChart3, CalendarDays, ClipboardList, FlaskConical, HeartPulse, Microscope, PackageCheck, Pill, Stethoscope, TestTube2, UserRoundCheck, Users } from 'lucide-react';

const scenes={
  patient:[CalendarDays,HeartPulse,Stethoscope],doctor:[Stethoscope,Activity,ClipboardList],laboratory:[Microscope,TestTube2,FlaskConical],pharmacy:[Pill,PackageCheck,ClipboardList],reception:[UserRoundCheck,CalendarDays,Users],admin:[BarChart3,Activity,HeartPulse]
};

export default function HealthcareIllustration({variant='patient',className=''}){
  const [Primary,Secondary,Tertiary]=scenes[variant]||scenes.patient;
  return <div className={`healthcare-illustration healthcare-illustration--${variant} ${className}`} aria-hidden="true">
    <span className="healthcare-illustration__orb healthcare-illustration__orb--one"/><span className="healthcare-illustration__orb healthcare-illustration__orb--two"/>
    <div className="healthcare-illustration__card healthcare-illustration__card--main"><Primary/></div>
    <div className="healthcare-illustration__card healthcare-illustration__card--small"><Secondary/></div>
    <div className="healthcare-illustration__badge"><Tertiary/></div>
  </div>;
}
