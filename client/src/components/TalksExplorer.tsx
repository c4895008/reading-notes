import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../api/client';
import { listTalks, type TalkSummary } from '../api/discussions';
import AvatarGroup from './AvatarGroup';
import { formatTime, fullTime } from '../lib/time';
import { ChevronIcon } from './Icons';
import './TalksExplorer.css';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: TalkSummary[]; hasMore: boolean };

function lastLine(talk: TalkSummary) {
  const m = talk.last_message;
  if (!m) return `${talk.participants.length} 位参与者 · 尚无发言`;
  return `${m.is_mine ? '你' : m.sender_nickname}：${m.excerpt}`;
}

function Skeleton() {
  return (
    <ul className="ext-list" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <li key={i} className="ext-row is-skeleton">
          <span className="sk sk-line" />
        </li>
      ))}
    </ul>
  );
}

export default function TalksExplorer({ currentId = null }: { currentId?: number | null }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const currentRef = useRef<HTMLAnchorElement>(null);
  const scrolled = useRef(false);

  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => (s.status === 'error' ? { status: 'loading' } : s));
    listTalks('active', 1, ctrl.signal)
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
    <div className="ext">
      <div className="ext-head">
        <span className="ext-title">讨论</span>
      </div>

      {state.status === 'loading' && <Skeleton />}

      {state.status === 'error' && (
        <div className="ext-state">
          <p>{state.message}</p>
          <button type="button" className="text-btn" onClick={() => setReload((n) => n + 1)}>
            重试
          </button>
        </div>
      )}

      {state.status === 'ready' && state.items.length === 0 && (
        <div className="ext-state">
          <p>没有进行中的讨论。</p>
          <Link to="/notes" className="text-btn">
            从一条笔记发起
          </Link>
        </div>
      )}

      {state.status === 'ready' && state.items.length > 0 && (
        <ul className="ext-list">
          {state.items.map((talk) => {
            const at = talk.last_message_at ?? talk.created_at;
            const current = talk.id === currentId;
            return (
              <li key={talk.id}>
                <Link
                  to={`/talks/${talk.id}`}
                  state={{ back: '/talks' }}
                  ref={current ? currentRef : undefined}
                  aria-current={current ? 'page' : undefined}
                  className={`ext-row${current ? ' is-current' : ''}`}
                >
                  <AvatarGroup users={talk.participants} max={3} size={24} />
                  <span className="ext-main">
                    <span className="ext-title-line">关于『{talk.title}』</span>
                    <span className="ext-sub">{lastLine(talk)}</span>
                  </span>
                  <span className="ext-side">
                    <time dateTime={at} title={fullTime(at)}>
                      {formatTime(at)}
                    </time>
                    {talk.unread > 0 && (
                      <span className="ext-unread" aria-label={`${talk.unread} 条未读`}>
                        {talk.unread > 99 ? '99+' : talk.unread}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {state.status === 'ready' && state.hasMore && (
        <Link to="/talks" className="ext-more">
          全部讨论
          <ChevronIcon size={14} />
        </Link>
      )}
    </div>
  );
}
