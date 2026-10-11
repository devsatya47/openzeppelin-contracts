import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, tokenStore } from './api';
import type { User } from './types';

type AuthCtx = {
  user: User | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (input: { name: string; email: string; password: string; country: string }) => Promise<User>;
  logout: () => void;
  /** Replaces the current session, e.g. after a password change issues a fresh token. */
  setSession: (token: string | null, user: User) => void;
  refresh: () => Promise<void>;
  can: (permission: string) => boolean;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (!tokenStore.get()) {
      setUser(null);
      return;
    }
    try {
      setUser((await api<{ user: User }>('/auth/me')).user);
    } catch {
      tokenStore.set(null);
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setReady(true));
  }, [refresh]);

  const login = async (email: string, password: string) => {
    const r = await api<{ token: string; user: User }>('/auth/login', { body: { email, password } });
    tokenStore.set(r.token);
    setUser(r.user);
    return r.user;
  };

  const register: AuthCtx['register'] = async (input) => {
    const r = await api<{ token: string; user: User }>('/auth/register', { body: input });
    tokenStore.set(r.token);
    setUser(r.user);
    return r.user;
  };

  const logout = () => {
    tokenStore.set(null);
    setUser(null);
  };

  const setSession = (token: string | null, next: User) => {
    if (token) tokenStore.set(token);
    setUser(next);
  };

  const can = (p: string) => !!user?.permissions.includes(p);

  return <Ctx.Provider value={{ user, ready, login, register, logout, refresh, can, setSession }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be used inside AuthProvider');
  return c;
}
