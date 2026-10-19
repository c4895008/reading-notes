import { useEffect, useId, useRef, type ReactNode } from 'react';
import './ConfirmDialog.css';

type Props = {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
};

// 原生 <dialog> 的 showModal 自带焦点约束、Esc 关闭与背景惰性
export default function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel = '取消', busy = false, danger = false, onConfirm, onCancel, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const returnTo = document.activeElement as HTMLElement | null;
    dialog.showModal();
    cancelRef.current?.focus();
    return () => {
      dialog.close();
      if (returnTo?.isConnected) returnTo.focus();
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="confirm"
      aria-labelledby={titleId}
      aria-describedby={message ? messageId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      {open && (
        <div className="confirm-body">
          <h2 id={titleId} className="confirm-title">
            {title}
          </h2>
          {message && (
            <p id={messageId} className="confirm-message">
              {message}
            </p>
          )}
          {children}
          <div className="confirm-actions">
            <button ref={cancelRef} type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
              {cancelLabel}
            </button>
            <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>
              {busy ? '处理中…' : confirmLabel}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
