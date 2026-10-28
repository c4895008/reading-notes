import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { setNoteLike, type LikeState } from '../api/feed';
import { HeartIcon } from './Icons';

type Props = LikeState & { noteId: number; readOnly?: boolean; onChange: (state: LikeState) => void; onMissing: () => void };

export default function LikeButton({ noteId, liked, like_count, readOnly = false, onChange, onMissing }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);

  async function toggle() {
    if (ctrl.current) return;
    const next = new AbortController();
    ctrl.current = next;
    setBusy(true);
    setError(null);
    try {
      const result = await setNoteLike(noteId, !liked, next.signal);
      if (!next.signal.aborted) onChange(result);
    } catch (e) {
      if (next.signal.aborted) return;
      const err = e as ApiError;
      if (err.status === 404) onMissing();
      else setError(err.message);
    } finally {
      if (!next.signal.aborted) {
        ctrl.current = null;
        setBusy(false);
      }
    }
  }

  if (readOnly) return <span className="feed-like-count"><HeartIcon />{like_count} 个赞</span>;
  return (
    <div className="feed-like-wrap">
      <button
        type="button"
        className={`feed-like${liked ? ' is-liked' : ''}`}
        aria-pressed={liked}
        aria-label={`${liked ? '取消喜欢' : '喜欢'}，${like_count} 个赞`}
        disabled={busy}
        onClick={toggle}
      >
        <HeartIcon />
        <span>{busy ? '处理中…' : liked ? '已喜欢' : '喜欢'}</span>
        <span className="feed-like-number">{like_count}</span>
      </button>
      {error && <p className="field-msg is-error" role="alert">{error}</p>}
    </div>
  );
}
