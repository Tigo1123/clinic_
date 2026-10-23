import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ThemeProvider } from '../theme/ThemeContext';
import { AuthProvider } from '../auth/AuthContext';
import { FacilityBrandingProvider } from '../branding/FacilityBrandingProvider.jsx';
import PatientRoute from './PatientRoute';
import '../../styles/medical.css';

const LegacyApp = lazy(() => import('../../App'));
const LandingPage = lazy(() => import('../../features/public/LandingPage'));
const PatientLayout = lazy(() => import('../../layouts/PatientLayout'));
const RescheduleAppointment = lazy(() => import('../../features/appointments/RescheduleAppointment'));
const named = (loader, key) => lazy(() => loader().then((module) => ({ default: module[key] })));
const patientAuth = () => import('../../features/patient-auth/PatientAuthPages');
const patientPages = () => import('../../features/patient-dashboard/PatientPages');
const PatientClaim = named(patientAuth, 'PatientClaim');
const PatientForgotPassword = named(patientAuth, 'PatientForgotPassword');
const PatientLogin = named(patientAuth, 'PatientLogin');
const PatientRegister = named(patientAuth, 'PatientRegister');
const AppointmentDetails = named(patientPages, 'AppointmentDetails');
const Appointments = named(patientPages, 'Appointments');
const BookAppointment = named(patientPages, 'BookAppointment');
const Dashboard = named(patientPages, 'Dashboard');
const DoctorDetails = named(patientPages, 'DoctorDetails');
const Doctors = named(patientPages, 'Doctors');
const LabResults = named(patientPages, 'LabResults');
const MedicalRecords = named(patientPages, 'MedicalRecords');
const Prescriptions = named(patientPages, 'Prescriptions');
const Profile = named(patientPages, 'Profile');

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

export default function AppRouter(){return <BrowserRouter><ThemeProvider><AuthProvider><FacilityBrandingProvider><DocumentLanguage/><Suspense fallback={<main className="route-loading" role="status">Loading healthcare workspace…</main>}><Routes><Route path="/" element={<LandingPage/>}/><Route path="/staff/*" element={<LegacyApp initialView="login"/>}/><Route path="/patient-login" element={<PatientLogin/>}/><Route path="/forgot-password" element={<PatientForgotPassword/>}/><Route path="/register" element={<PatientRegister/>}/><Route path="/patient/claim" element={<PatientClaim/>}/><Route element={<PatientRoute/>}><Route path="/patient" element={<PatientLayout/>}><Route index element={<Dashboard/>}/><Route path="doctors" element={<Doctors/>}/><Route path="doctors/:id" element={<DoctorDetails/>}/><Route path="book/:doctorId" element={<BookAppointment/>}/><Route path="appointments" element={<Appointments/>}/><Route path="appointments/:id" element={<AppointmentDetails/>}/><Route path="appointments/:id/reschedule" element={<RescheduleAppointment/>}/><Route path="lab-results" element={<LabResults/>}/><Route path="prescriptions" element={<Prescriptions/>}/><Route path="records" element={<MedicalRecords/>}/><Route path="profile" element={<Profile/>}/></Route></Route><Route path="*" element={<LandingPage/>}/></Routes></Suspense></FacilityBrandingProvider></AuthProvider></ThemeProvider></BrowserRouter>}
