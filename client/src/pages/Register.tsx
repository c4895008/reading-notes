import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { checkUsernameAvailable, register } from '../api/auth';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { AuthLayout, Field, PasswordInput } from './AuthParts';

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const TAKEN = '这个用户名已经被使用了';

type Fields = 'username' | 'nickname' | 'password';
type Errors = Partial<Record<Fields, string>>;

function validateUsername(v: string) {
  if (!v) return '请填写用户名';
  if (!USERNAME_RE.test(v)) return '用户名为 3–20 位字母、数字或下划线';
  return undefined;
}

function validatePassword(v: string) {
  if (!v) return '请填写密码';
  if (v.length < 8) return '密码至少 8 位';
  return undefined;
}

function validateNickname(v: string) {
  if ([...v.trim()].length > 20) return '昵称最多 20 个字';
  return undefined;
}

export default function Register() {
  const { signIn } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [available, setAvailable] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const checkSeq = useRef(0);

  const setError = (field: Fields, message?: string) => setErrors((prev) => ({ ...prev, [field]: message }));

  const onUsernameBlur = async () => {
    const v = username.trim();
    const err = validateUsername(v);
    setError('username', v ? err : undefined);
    setAvailable(null);
    if (err) return;
    const seq = ++checkSeq.current;
    try {
      const { available } = await checkUsernameAvailable(v);
      if (seq !== checkSeq.current) return;
      if (available) setAvailable(v);
      else setError('username', TAKEN);
    } catch {
      // 即时校验失败不打扰用户，提交时服务端会再校验
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const u = username.trim();
    const next: Errors = {
      username: validateUsername(u) ?? (errors.username === TAKEN ? TAKEN : undefined),
      nickname: validateNickname(nickname),
      password: validatePassword(password),
    };
    setErrors(next);
    setFormError(null);
    if (Object.values(next).some(Boolean)) return;

    setSubmitting(true);
    try {
      const session = await register({ username: u, password, nickname: nickname.trim() || undefined });
      signIn(session);
      toast('欢迎来到读书笔记');
      navigate('/notes', { replace: true });
    } catch (err) {
      const apiErr = err as ApiError;
      const fields = apiErr.details?.fields;
      if (fields) {
        setErrors(fields as Errors);
        if (fields.username) setAvailable(null);
      } else {
        setFormError(apiErr.message);
      }
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="注册"
      subtitle="写下读书时的触动，再与读友聊到懂。"
      footer={
        <>
          已有账号？<Link to="/login">登录</Link>
        </>
      }
    >
      <form className="auth-form" onSubmit={onSubmit} noValidate>
        <Field
          id="reg-username"
          label="用户名"
          hint="3–20 位字母、数字或下划线，注册后不可修改"
          error={errors.username}
          ok={available === username.trim() && !errors.username ? '这个用户名可以使用' : null}
        >
          {(describedBy) => (
            <input
              id="reg-username"
              className="input"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setAvailable(null);
                if (errors.username) setError('username', undefined);
              }}
              onBlur={onUsernameBlur}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby={describedBy}
              aria-invalid={!!errors.username || undefined}
              maxLength={20}
              autoFocus
              required
            />
          )}
        </Field>

        <Field
          id="reg-nickname"
          label="昵称（可选）"
          hint="读友看到的名字，默认与用户名相同，之后可修改"
          error={errors.nickname}
        >
          {(describedBy) => (
            <input
              id="reg-nickname"
              className="input"
              value={nickname}
              onChange={(e) => {
                setNickname(e.target.value);
                if (errors.nickname) setError('nickname', undefined);
              }}
              autoComplete="nickname"
              aria-describedby={describedBy}
              aria-invalid={!!errors.nickname || undefined}
              maxLength={20}
            />
          )}
        </Field>

        <Field id="reg-password" label="密码" hint="至少 8 位" error={errors.password}>
          {(describedBy) => (
            <PasswordInput
              id="reg-password"
              value={password}
              onChange={(v) => {
                setPassword(v);
                if (errors.password) setError('password', undefined);
              }}
              autoComplete="new-password"
              describedBy={describedBy}
              invalid={!!errors.password}
            />
          )}
        </Field>

        {formError && (
          <p className="auth-error" role="alert">
            {formError}
          </p>
        )}

        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? '正在注册…' : '注册并进入'}
        </button>
      </form>
    </AuthLayout>
  );
}
