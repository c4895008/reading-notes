import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { getFeedNote, type FeedNote as SharedNote } from '../api/feed';
import { useAuth } from '../auth/AuthContext';
import Avatar from '../components/Avatar';
import { BackIcon } from '../components/Icons';
import LikeButton from '../components/LikeButton';
import { NoteBody, QuoteBlock } from '../components/NoteContent';
import { KindBadge } from '../components/NoteKind';
import { ago, fullTime } from '../lib/time';
import { ReadingSkeleton } from './NoteView';
import './Page.css';
import './Notes.css';
import './Feed.css';

type State = { status: 'loading' } | { status: 'missing' } | { status: 'error'; message: string } | { status: 'ready'; note: SharedNote };

export default function FeedNote() {
  const { id = '' } = useParams();
  const location = useLocation();
  const back = (location.state as { back?: string } | null)?.back ?? '/feed';
  const { user } = useAuth();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    setState((s) => s.status === 'ready' && String(s.note.id) === id ? s : { status: 'loading' });
    setRefreshError(null);
    async function refresh() {
      ctrl.current?.abort();
      const next = new AbortController();
      ctrl.current = next;
      try {
        const note = await getFeedNote(id, next.signal);
        if (next.signal.aborted) return;
        setState({ status: 'ready', note });
        setRefreshError(null);
      } catch (e) {
        if (next.signal.aborted) return;
        const err = e as ApiError;
        if (err.status === 404) {
          setState({ status: 'missing' });
          setRefreshError(null);
        } else {
          setRefreshError(err.message);
          setState((s) => s.status === 'ready' ? s : { status: 'error', message: err.message });
        }
      }
    }
    refresh();
    const onVisible = () => { if (!document.hidden) refresh(); };
    const timer = window.setInterval(onVisible, 30_000);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      ctrl.current?.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [id, reload]);

  const note = state.status === 'ready' && String(state.note.id) === id ? state.note : null;
  return (
    <section className="page page-enter pane-page feed feed-detail" aria-label="好友分享的笔记">
      <div className="pane-bar">
        <Link to={back} className="back-link"><BackIcon />好友动态</Link>
        <button type="button" className="btn btn-ghost" onClick={() => setReload((r) => r + 1)}>刷新</button>
      </div>
      <div className="feed-body">
        {(state.status === 'loading' || state.status === 'ready' && !note) && <ReadingSkeleton />}
        {state.status === 'missing' && (
          <div className="feed-empty" role="status">
            <h1>这条笔记已不可见</h1>
            <p>可能已设为私密、已删除，或你们不再是读友。</p>
            <Link to={back} className="btn btn-primary">回到好友动态</Link>
          </div>
        )}
        {state.status === 'error' && (
          <div className="notes-state" role="alert">
            <p>{state.message}</p>
            <button type="button" className="btn btn-ghost" onClick={() => setReload((r) => r + 1)}>重试</button>
          </div>
        )}
        {note && (
          <>
            {refreshError && <p className="feed-refresh-error field-msg is-error" role="alert">{refreshError} 可点击刷新重试。</p>}
            <article className="feed-card feed-full">
              <header className="feed-author">
                <Avatar avatar={note.author.avatar} name={note.author.nickname} size={40} decorative />
                <div className="feed-author-text">
                  <strong>{note.author.nickname}</strong>
                  <p><time dateTime={note.shared_at} title={fullTime(note.shared_at)}>{ago(note.shared_at)}</time><span aria-hidden="true"> · </span>好友可见</p>
                </div>
                <KindBadge kind={note.kind} />
              </header>
              <h1 className="reading-title">{note.title}</h1>
              {note.quote && <QuoteBlock text={note.quote} />}
              {note.content ? <NoteBody source={note.content} /> : <p className="reading-empty">这条笔记还没有写下想法。</p>}
              <footer className="feed-card-foot">
                <LikeButton
                  key={note.id}
                  noteId={note.id}
                  liked={note.liked}
                  like_count={note.like_count}
                  readOnly={note.author.user_id === user!.user_id}
                  onChange={(value) => {
                    ctrl.current?.abort();
                    setState((s) => s.status === 'ready' && s.note.id === note.id ? { ...s, note: { ...s.note, ...value } } : s);
                  }}
                  onMissing={() => { ctrl.current?.abort(); setState({ status: 'missing' }); }}
                />
                <span className="feed-readonly">只读笔记</span>
              </footer>
            </article>
          </>
        )}
      </div>
    </section>
  );
}
