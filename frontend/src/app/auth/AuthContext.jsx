import { useMemo, useState } from 'react';
import { AuthContext } from './auth-context';
import { clearPatientSession, readPatientSession, updateStoredPatient, writePatientSession } from '../../services/authStorage';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    return readPatientSession()?.user || null;
  });

  const login = (nextUser, token) => {
    writePatientSession(nextUser, token);
    setUser(nextUser);
  };

  const updateUser = (changes) => {
    setUser((currentUser) => {
      if (!currentUser) return currentUser;

      const updatedUser = {
        ...currentUser,
        ...changes
      };

      updateStoredPatient(updatedUser);

      return updatedUser;
    });
  };

  const logout = () => {
    clearPatientSession();
    setUser(null);
  };

  const value = useMemo(
    () => ({
      user,
      login,
      updateUser,
      logout
    }),
    [user]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
