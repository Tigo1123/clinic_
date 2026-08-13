import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function PatientRoute() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/patient-login" replace />;
  if (user.role !== 'PATIENT') return <Navigate to="/" replace />;
  return <Outlet />;
}
