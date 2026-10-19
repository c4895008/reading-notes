import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LogoIcon } from '../components/Icons';
import './AuthPage.css';

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  return (
    <main className="auth">
      <div className="auth-card page-enter">
        <Link to="/login" className="auth-brand">
          <LogoIcon size={22} />
          读书笔记
        </Link>
        <h1 className="auth-title">{title}</h1>
        <p className="auth-subtitle">{subtitle}</p>
        {children}
        <p className="auth-footer">{footer}</p>
      </div>
    </main>
  );
}

type FieldProps = {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  ok?: string | null;
  children: (describedBy: string | undefined) => ReactNode;
};

export function Field({ id, label, hint, error, ok, children }: FieldProps) {
  const msgId = `${id}-msg`;
  const message = error || ok || hint;
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      {children(message ? msgId : undefined)}
      {message && (
        <p id={msgId} className={`field-msg${error ? ' is-error' : ok ? ' is-ok' : ''}`}>
          {message}
        </p>
      )}
    </div>
  );
}

export function PasswordInput(props: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  describedBy?: string;
  invalid?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="input-wrap">
      <input
        id={props.id}
        className="input"
        type={visible ? 'text' : 'password'}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        autoComplete={props.autoComplete}
        aria-describedby={props.describedBy}
        aria-invalid={props.invalid || undefined}
        maxLength={64}
        required
      />
      <button
        type="button"
        className="input-addon"
        onClick={() => setVisible((v) => !v)}
        aria-pressed={visible}
        aria-label={visible ? '隐藏密码' : '显示密码'}
      >
        {visible ? '隐藏' : '显示'}
      </button>
    </div>
  );
}
