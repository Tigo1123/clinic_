import { createContext, useContext, useMemo, useState } from 'react';

const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => { try { return JSON.parse(localStorage.getItem('cms_user')); } catch { return null; } });
  const login = (nextUser, token) => { localStorage.setItem('cms_user', JSON.stringify(nextUser)); localStorage.setItem('cms_token', token); setUser(nextUser); };
  const logout = () => { localStorage.removeItem('cms_user'); localStorage.removeItem('cms_token'); setUser(null); };
  const value = useMemo(() => ({ user, login, logout }), [user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
