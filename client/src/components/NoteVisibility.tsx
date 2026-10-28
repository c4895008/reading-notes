import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { setNoteVisibility, type NoteVisibility as Visibility, type VisibilityState } from '../api/notes';
import { FriendsIcon, LockIcon } from './Icons';
import { useToast } from './Toast';

type Props = { noteId: number; value: VisibilityState; onChange: (value: VisibilityState) => void; onMissing: () => void };

export default function NoteVisibility({ noteId, value, onChange, onMissing }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const toast = useToast();
  useEffect(() => () => ctrl.current?.abort(), []);

  async function change(visibility: Visibility) {
    if (ctrl.current || visibility === value.visibility) return;
    const next = new AbortController();
    ctrl.current = next;
    setBusy(true);
    setError(null);
    try {
      const result = await setNoteVisibility(noteId, visibility, next.signal);
      if (next.signal.aborted) return;
      onChange(result);
      toast(result.visibility === 'friends' ? '已设为好友可见，出现在好友动态中' : '已保持私密，不再出现在好友动态中');
    } catch (e) {
      if (next.signal.aborted) return;
      const err = e as ApiError;
      if (err.status === 404) onMissing();
      else setError(`没有修改成功，原设置保留。${err.message}`);
    } finally {
      if (!next.signal.aborted) {
        ctrl.current = null;
        setBusy(false);
      }
    }
  }

  const shared = value.visibility === 'friends';
  return (
    <section className="note-visibility" aria-label="笔记可见性" aria-busy={busy}>
      <div className="note-visibility-row">
        <span className={`note-visibility-status${shared ? ' is-shared' : ''}`} aria-live="polite">
          {shared ? <FriendsIcon size={16} /> : <LockIcon />}
          {shared ? '好友可见' : '保持私密'}
        </span>
        <div className="segmented" role="group" aria-label="设置可见范围">
          <button type="button" aria-pressed={!shared} disabled={busy} onClick={() => change('private')}>保持私密</button>
          <button type="button" aria-pressed={shared} disabled={busy} onClick={() => change('friends')}>好友可见</button>
        </div>
      </div>
      <p className="note-visibility-hint">
        {shared ? '仅此笔记对当前读友可见，不包含父子笔记；讨论仍需邀请。' : '只有自己可见，随时可以改为好友可见。'}
      </p>
      {error && <p className="field-msg is-error" role="alert">{error}</p>}
    </section>
  );
}
