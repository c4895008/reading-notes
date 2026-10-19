import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { fetchMe, type PublicUser, type Session } from '../api/auth';
import { ApiError, getToken, setToken, setUnauthorizedHandler } from '../api/client';

type Status = 'loading' | 'offline' | 'anon' | 'authed';

// 离开会话的原因：由 RequireAuth 统一跳转，避免与路由的过渡更新竞争
export type Exit = { kind: 'signout' } | { kind: 'expired'; notice: string } | null;

type AuthValue = {
  status: Status;
  user: PublicUser | null;
  exit: Exit;
  signIn: (session: Session) => void;
  signOut: () => void;
  endSession: (notice: string) => void;
  updateUser: (user: PublicUser) => void;
  retry: () => void;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(getToken() ? 'loading' : 'anon');
  const [user, setUser] = useState<PublicUser | null>(null);
  const [exit, setExit] = useState<Exit>(null);

  const clear = useCallback(() => {
    setToken(null);
    setUser(null);
    setStatus('anon');
  }, []);

  const restore = useCallback(async () => {
    if (!getToken()) return;
    setStatus('loading');
    try {
      const { user } = await fetchMe();
      setUser(user);
      setStatus('authed');
    } catch (e) {
      if ((e as ApiError).status !== 401) setStatus('offline');
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler((message) => {
      setExit({ kind: 'expired', notice: message });
      clear();
    });
    restore();
    return () => setUnauthorizedHandler(null);
  }, [clear, restore]);

  const signIn = useCallback((session: Session) => {
    setToken(session.token);
    setUser(session.user);
    setExit(null);
    setStatus('authed');
  }, []);

  const signOut = useCallback(() => {
    setExit({ kind: 'signout' });
    clear();
  }, [clear]);

  const endSession = useCallback(
    (notice: string) => {
      setExit({ kind: 'expired', notice });
      clear();
    },
    [clear],
  );

  return (
    <AuthContext.Provider value={{ status, user, exit, signIn, signOut, endSession, updateUser: setUser, retry: restore }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
