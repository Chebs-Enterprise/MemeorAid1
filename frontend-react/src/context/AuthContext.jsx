/**
 * Authentication context.
 *
 * A single source of truth for "who is signed in", replacing the per-page
 * localStorage reads of the vanilla build. Any component can read the current
 * user with useAuth() instead of touching storage directly.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, tokenStore, userStore } from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Initialised straight from storage during render — no effect needed, and no
  // flash of "signed out" on load.
  const [user, setUser] = useState(() => (tokenStore.get() ? userStore.get() : null));

  // The API client fires this when a token is rejected mid-session.
  useEffect(() => {
    const onUnauthorized = () => {
      setUser(null);
      userStore.set(null);
    };
    window.addEventListener('memoraid:unauthorized', onUnauthorized);
    return () => window.removeEventListener('memoraid:unauthorized', onUnauthorized);
  }, []);

  const persist = useCallback((token, nextUser) => {
    tokenStore.set(token);
    userStore.set(nextUser);
    setUser(nextUser);
  }, []);

  const login = useCallback(
    async (email, password) => {
      const res = await api.login(email, password);
      persist(res.token, res.user);
      return res.user;
    },
    [persist],
  );

  const register = useCallback(
    async (payload) => {
      const res = await api.register(payload);
      persist(res.token, res.user);
      return res.user;
    },
    [persist],
  );

  const logout = useCallback(() => {
    tokenStore.clear();
    userStore.set(null);
    setUser(null);
  }, []);

  const refreshUser = useCallback(
    async () => {
      const res = await api.getProfile();
      userStore.set(res.user);
      setUser(res.user);
      return res.user;
    },
    [],
  );

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: Boolean(user && tokenStore.get()),
      login,
      register,
      logout,
      refreshUser,
    }),
    [user, login, register, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
