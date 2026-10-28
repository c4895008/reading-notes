import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LogoIcon } from '../components/Icons';
import './AuthPage.css';

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  return (
    <main className="auth">
      <section className="auth-story" aria-label="产品介绍">
        <Link to="/login" className="auth-brand">
          <span className="auth-brand-icon"><LogoIcon size={20} /></span>
          读书笔记
        </Link>
        <div className="auth-story-copy">
          <p className="auth-eyebrow">结构化阅读与思考</p>
          <h2>把读过的内容，变成可以继续生长的理解。</h2>
          <p>记录引文，梳理上下层关系，再邀请读友围绕一条具体笔记展开讨论。</p>
          <ul className="auth-features">
            <li><strong>01</strong><span>从引文与想法开始</span></li>
            <li><strong>02</strong><span>让笔记形成清晰脉络</span></li>
            <li><strong>03</strong><span>和读友把问题谈深</span></li>
          </ul>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-card page-enter">
          <Link to="/login" className="auth-brand auth-brand-mobile">
            <span className="auth-brand-icon"><LogoIcon size={20} /></span>
            读书笔记
          </Link>
          <h1 className="auth-title">{title}</h1>
          <p className="auth-subtitle">{subtitle}</p>
          {children}
          <p className="auth-footer">{footer}</p>
        </div>
      </section>
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
