import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../api/client';
import { listNotes, type NoteSummary } from '../api/notes';
import { formatTime, fullTime } from '../lib/time';
import { ChevronIcon, PlusIcon } from './Icons';
import TagSection from './TagSection';
import './NotesExplorer.css';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: NoteSummary[]; hasMore: boolean };

function Skeleton() {
  return (
    <ul className="exh-list" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i} className="exh-row is-skeleton">
          <span className="sk sk-line" />
        </li>
      ))}
    </ul>
  );
}

export default function NotesExplorer({ currentId = null }: { currentId?: number | null }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const currentRef = useRef<HTMLAnchorElement>(null);
  const scrolled = useRef(false);

  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => (s.status === 'error' ? { status: 'loading' } : s));
    listNotes({}, ctrl.signal)
      .then((data) => setState({ status: 'ready', items: data.items, hasMore: data.has_more }))
      .catch((e: ApiError) => {
        if (!ctrl.signal.aborted) setState({ status: 'error', message: e.message });
      });
    return () => ctrl.abort();
  }, [reload]);

  useEffect(() => {
    if (scrolled.current || !currentRef.current) return;
    scrolled.current = true;
    const rect = currentRef.current.getBoundingClientRect();
    if (rect.top < 72 || rect.bottom > window.innerHeight - 72) {
      currentRef.current.scrollIntoView({ block: 'center' });
    }
  }, [state]);

  return (
    <div className="exh">
      <div className="exh-head">
        <span className="exh-title">笔记</span>
        <Link to="/notes/new" className="icon-btn exh-new" aria-label="写笔记" title="写笔记" state={{ back: '/notes' }}>
          <PlusIcon size={16} />
        </Link>
      </div>

      {state.status === 'loading' && <Skeleton />}

      {state.status === 'error' && (
        <div className="exh-state">
          <p>{state.message}</p>
          <button type="button" className="text-btn" onClick={() => setReload((n) => n + 1)}>
            重试
          </button>
        </div>
      )}

      {state.status === 'ready' && state.items.length === 0 && (
        <div className="exh-state">
          <p>还没有笔记。</p>
          <Link to="/notes/new" className="text-btn" state={{ back: '/notes' }}>
            写第一条
          </Link>
        </div>
      )}

      {state.status === 'ready' && state.items.length > 0 && (
        <ul className="exh-list">
          {state.items.map((note) => (
            <li key={note.id}>
              <Link
                to={`/notes/${note.id}`}
                state={{ back: '/notes' }}
                ref={note.id === currentId ? currentRef : undefined}
                aria-current={note.id === currentId ? 'page' : undefined}
                className={`exh-row${note.id === currentId ? ' is-current' : ''}`}
              >
                <span className="exh-row-title">{note.title}</span>
                <time dateTime={note.updated_at} title={`最近更新 ${fullTime(note.updated_at)}`}>
                  {formatTime(note.updated_at)}
                </time>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {state.status === 'ready' && state.hasMore && (
        <Link to="/notes" className="exh-more">
          全部笔记
          <ChevronIcon size={14} />
        </Link>
      )}

      <TagSection />
    </div>
  );
}
