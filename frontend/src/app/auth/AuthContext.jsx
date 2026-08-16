import { useMemo, useState } from 'react';
import { AuthContext } from './auth-context';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('cms_user'));
    } catch {
      return null;
    }
  });

  const login = (nextUser, token) => {
    localStorage.setItem('cms_user', JSON.stringify(nextUser));
    localStorage.setItem('cms_token', token);
    setUser(nextUser);
  };

  const updateUser = (changes) => {
    setUser((currentUser) => {
      if (!currentUser) return currentUser;

      const updatedUser = {
        ...currentUser,
        ...changes
      };

      localStorage.setItem('cms_user', JSON.stringify(updatedUser));

      return updatedUser;
    });
  };

  const logout = () => {
    localStorage.removeItem('cms_user');
    localStorage.removeItem('cms_token');
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
