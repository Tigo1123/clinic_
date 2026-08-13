import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import PatientRoute from './PatientRoute';
import PatientLayout from '../../layouts/PatientLayout';
import { PatientClaim, PatientLogin, PatientRegister } from '../../features/patient-auth/PatientAuthPages';
import { AppointmentDetails, Appointments, BookAppointment, Dashboard, DoctorDetails, Doctors, LabResults, MedicalRecords, Prescriptions, Profile } from '../../features/patient-dashboard/PatientPages';
import RescheduleAppointment from '../../features/appointments/RescheduleAppointment';
import '../../styles/medical.css';

const LegacyApp = lazy(() => import('../../App'));
const LandingPage = lazy(() => import('../../features/public/LandingPage'));

export default function AppRouter(){return <BrowserRouter><AuthProvider><Suspense fallback={<main className="route-loading" role="status">Loading healthcare workspace…</main>}><Routes><Route path="/" element={<LandingPage/>}/><Route path="/staff/*" element={<LegacyApp initialView="login"/>}/><Route path="/patient-login" element={<PatientLogin/>}/><Route path="/register" element={<PatientRegister/>}/><Route element={<PatientRoute/>}><Route path="/patient" element={<PatientLayout/>}><Route index element={<Dashboard/>}/><Route path="claim" element={<PatientClaim/>}/><Route path="doctors" element={<Doctors/>}/><Route path="doctors/:id" element={<DoctorDetails/>}/><Route path="book/:doctorId" element={<BookAppointment/>}/><Route path="appointments" element={<Appointments/>}/><Route path="appointments/:id" element={<AppointmentDetails/>}/><Route path="appointments/:id/reschedule" element={<RescheduleAppointment/>}/><Route path="lab-results" element={<LabResults/>}/><Route path="prescriptions" element={<Prescriptions/>}/><Route path="records" element={<MedicalRecords/>}/><Route path="profile" element={<Profile/>}/></Route></Route><Route path="*" element={<LandingPage/>}/></Routes></Suspense></AuthProvider></BrowserRouter>}
