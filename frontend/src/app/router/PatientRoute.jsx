import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';

export default function PatientRoute() {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/patient-login" replace />;
  }

  if (user.role !== 'PATIENT') {
    return <Navigate to="/" replace />;
  }

  /*
   * patientLinked === false means authentication succeeded,
   * but this online account is not yet attached to a Patient record.
   *
   * Do not allow access to clinical pages until linkage is resolved.
   *
   * Undefined is intentionally allowed for backward compatibility with
   * sessions created before patientLinked was added to the login response.
   */
  if (user.patientLinked === false) {
    return <Navigate to="/patient/claim" replace />;
  }

  return <Outlet />;
}
