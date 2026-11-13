import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ThemeProvider } from '../theme/ThemeContext';
import { AuthProvider } from '../auth/AuthContext';
import { FacilityBrandingProvider } from '../branding/FacilityBrandingProvider.jsx';
import PatientRoute from './PatientRoute';
import '../../styles/medical.css';

const StaffPortal = lazy(() => import('../../features/staff/StaffPortal'));
const LandingPage = lazy(() => import('../../features/public/LandingPage'));
const PatientLayout = lazy(() => import('../../features/patient/portal/PatientLayout'));

const loadPatientAuthPages = () => import('../../features/patient/auth/PatientAuthPages');
const PatientClaim = lazy(() => loadPatientAuthPages().then(m => ({ default: m.PatientClaim })));
const PatientForgotPassword = lazy(() => loadPatientAuthPages().then(m => ({ default: m.PatientForgotPassword })));
const PatientLogin = lazy(() => loadPatientAuthPages().then(m => ({ default: m.PatientLogin })));
const PatientRegister = lazy(() => loadPatientAuthPages().then(m => ({ default: m.PatientRegister })));

const loadPatientPages = () => import('../../features/patient/portal/PatientPages');
const AppointmentDetails = lazy(() => loadPatientPages().then(m => ({ default: m.AppointmentDetails })));
const Appointments = lazy(() => loadPatientPages().then(m => ({ default: m.Appointments })));
const BookAppointment = lazy(() => loadPatientPages().then(m => ({ default: m.BookAppointment })));
const Dashboard = lazy(() => loadPatientPages().then(m => ({ default: m.Dashboard })));
const DoctorDetails = lazy(() => loadPatientPages().then(m => ({ default: m.DoctorDetails })));
const Doctors = lazy(() => loadPatientPages().then(m => ({ default: m.Doctors })));
const LabResults = lazy(() => loadPatientPages().then(m => ({ default: m.LabResults })));
const MedicalRecords = lazy(() => loadPatientPages().then(m => ({ default: m.MedicalRecords })));
const Prescriptions = lazy(() => loadPatientPages().then(m => ({ default: m.Prescriptions })));
const Profile = lazy(() => loadPatientPages().then(m => ({ default: m.Profile })));

const RescheduleAppointment = lazy(() => import('../../features/patient/portal/RescheduleAppointment'));

function DocumentLanguage() {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage || i18n.language || 'en';
  useEffect(() => {
    const shortLanguage = language.startsWith('ar') ? 'ar' : 'en';
    document.documentElement.lang = shortLanguage;
    document.documentElement.dir = shortLanguage === 'ar' ? 'rtl' : 'ltr';
  }, [language]);
  return null;
}

export default function AppRouter(){return <BrowserRouter><ThemeProvider><AuthProvider><FacilityBrandingProvider><DocumentLanguage/><Suspense fallback={<main className="route-loading" role="status">Loading healthcare workspace…</main>}><Routes><Route path="/" element={<LandingPage/>}/><Route path="/staff/*" element={<StaffPortal initialView="login"/>}/><Route path="/patient-login" element={<PatientLogin/>}/><Route path="/forgot-password" element={<PatientForgotPassword/>}/><Route path="/register" element={<PatientRegister/>}/><Route path="/patient/claim" element={<PatientClaim/>}/><Route element={<PatientRoute/>}><Route path="/patient" element={<PatientLayout/>}><Route index element={<Dashboard/>}/><Route path="doctors" element={<Doctors/>}/><Route path="doctors/:id" element={<DoctorDetails/>}/><Route path="book/:doctorId" element={<BookAppointment/>}/><Route path="appointments" element={<Appointments/>}/><Route path="appointments/:id" element={<AppointmentDetails/>}/><Route path="appointments/:id/reschedule" element={<RescheduleAppointment/>}/><Route path="lab-results" element={<LabResults/>}/><Route path="prescriptions" element={<Prescriptions/>}/><Route path="records" element={<MedicalRecords/>}/><Route path="profile" element={<Profile/>}/></Route></Route><Route path="*" element={<LandingPage/>}/></Routes></Suspense></FacilityBrandingProvider></AuthProvider></ThemeProvider></BrowserRouter>}
