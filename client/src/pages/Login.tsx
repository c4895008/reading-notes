import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { login } from '../api/auth';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { safeRedirect } from '../auth/redirect';
import { AuthLayout, Field, PasswordInput } from './AuthParts';

type LoginState = { from?: unknown } | null;

export default function Login() {
  const { signIn, exit } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LoginState;
  const notice = exit?.kind === 'expired' ? exit.notice : null;

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!username.trim() || !password) {
      setError('请填写用户名和密码');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const session = await login({ username: username.trim(), password });
      signIn(session);
      navigate(safeRedirect(state?.from), { replace: true });
    } catch (err) {
      setError((err as ApiError).message);
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="登录"
      subtitle="回到你的笔记与讨论。"
      footer={
        <>
          还没有账号？
          <Link to="/register" state={state?.from ? { from: state.from } : undefined}>
            注册
          </Link>
        </>
      }
    >
      {notice && !error && <p className="auth-notice">{notice}</p>}

      <form className="auth-form" onSubmit={onSubmit} noValidate>
        <Field id="login-username" label="用户名">
          {(describedBy) => (
            <input
              id="login-username"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby={describedBy}
              maxLength={20}
              autoFocus
              required
            />
          )}
        </Field>

        <Field id="login-password" label="密码">
          {(describedBy) => (
            <PasswordInput
              id="login-password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              describedBy={describedBy}
            />
          )}
        </Field>

        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? '正在登录…' : '登录'}
        </button>
      </form>
    </AuthLayout>
  );
}
