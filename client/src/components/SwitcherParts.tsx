import { useEffect, useRef, useState } from 'react';
import { PenIcon, TrashIcon } from './Icons';

export function RowActions({ editLabel, deleteLabel, onEdit, onDelete }: { editLabel: string; deleteLabel: string; onEdit: () => void; onDelete: () => void }) {
  return (
    <span className="bs-acts" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="bs-act" aria-label={editLabel} title={editLabel} onClick={onEdit}>
        <PenIcon size={15} />
      </button>
      <button type="button" className="bs-act is-danger" aria-label={deleteLabel} title={deleteLabel} onClick={onDelete}>
        <TrashIcon size={15} />
      </button>
    </span>
  );
}

export function ConfirmPanel({
  title,
  message,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="bs-create" role="group" aria-label={title}>
      <p className="bs-create-head">{title}</p>
      <p className="bs-confirm-text">{message}</p>
      {error && (
        <p className="bs-error" role="alert">
          {error}
        </p>
      )}
      <div className="bs-create-actions">
        <button ref={cancelRef} type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>
          返回列表
        </button>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={confirm}>
          {busy ? '删除中…' : '删除'}
        </button>
      </div>
    </div>
  );
}
