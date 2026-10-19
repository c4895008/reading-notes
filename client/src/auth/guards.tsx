import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { safeRedirect } from './redirect';
import './BootScreen.css';

function BootScreen() {
  const { status, retry } = useAuth();
  return (
    <div className="boot" role="status" aria-live="polite">
      <p className="boot-brand">读书笔记</p>
      {status === 'offline' ? (
        <>
          <p className="boot-text">网络连接中断，暂时无法确认登录状态。</p>
          <button type="button" className="btn btn-ghost" onClick={retry}>
            再试一次
          </button>
        </>
      ) : (
        <p className="boot-text">正在打开…</p>
      )}
    </div>
  );
}

export function RequireAuth() {
  const { status, exit } = useAuth();
  const location = useLocation();
  if (status === 'loading' || status === 'offline') return <BootScreen />;
  if (status === 'anon') {
    const { pathname, search, hash } = location;
    const from = exit?.kind === 'signout' ? undefined : { pathname, search, hash };
    return <Navigate to="/login" replace state={from ? { from } : null} />;
  }
  return <Outlet />;
}

export function GuestOnly() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading' || status === 'offline') return <BootScreen />;
  if (status === 'authed') {
    return <Navigate to={safeRedirect((location.state as { from?: unknown } | null)?.from)} replace />;
  }
  return <Outlet />;
}
