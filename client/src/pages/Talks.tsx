import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { listTalks, STATUS_LABEL, type TalkPage, type TalkStatus, type TalkSummary } from '../api/discussions';
import AvatarGroup from '../components/AvatarGroup';
import { formatTime, fullTime } from '../lib/time';
import { refreshUnreadTalks } from '../lib/unreadTalks';
import './Page.css';
import './Notes.css';
import './Talks.css';

const TABS: TalkStatus[] = ['active', 'ended', 'archived'];
const POLL_MS = 30_000;

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; tab: TalkStatus; items: TalkSummary[]; page: number; hasMore: boolean };

const isTab = (v: string | null): v is TalkStatus => TABS.includes(v as TalkStatus);

function lastLine(talk: TalkSummary) {
  const m = talk.last_message;
  if (!m) return `${talk.participants.length} 位参与者 · 尚无发言`;
  return `${m.is_mine ? '你' : m.sender_nickname}：${m.excerpt}`;
}

function TalkRow({ talk, back }: { talk: TalkSummary; back: string }) {
  const at = talk.last_message_at ?? talk.created_at;
  return (
    <li>
      <Link to={`/talks/${talk.id}`} state={{ back }} className="talk-row">
        <AvatarGroup users={talk.participants} max={4} size={24} />
        <span className="talk-row-main">
          <span className="talk-row-title">关于『{talk.title}』</span>
          <span className="talk-row-meta">
            {talk.is_initiator && <span className="talk-tag is-mine">我发起</span>}
            {talk.status !== 'active' && <span className="talk-tag">{STATUS_LABEL[talk.status]}</span>}
            <span className={`talk-row-sub${talk.last_message ? ' is-last' : ''}`}>{lastLine(talk)}</span>
          </span>
        </span>
        <span className="talk-row-side">
          <time className="talk-row-time" dateTime={at} title={fullTime(at)}>
            {formatTime(at)}
          </time>
          {talk.unread > 0 && (
            <span className="talk-unread" aria-label={`${talk.unread} 条未读`}>
              {talk.unread > 99 ? '99+' : talk.unread}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

function SkeletonRows() {
  return (
    <ul className="talk-list" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <li key={i} className="talk-row is-skeleton">
          <span className="sk sk-avatar" />
          <span className="talk-row-main">
            <span className="sk sk-title" />
            <span className="sk sk-line is-short" />
          </span>
        </li>
      ))}
    </ul>
  );
}

function Empty({ tab }: { tab: TalkStatus }) {
  if (tab === 'archived') return <p className="notes-state">还没有存档的讨论。</p>;
  if (tab === 'ended') return <p className="notes-state">还没有已完结的讨论。</p>;
  return (
    <div className="notes-empty">
      <p className="notes-empty-text">还没有讨论。挑一条笔记，邀请读友聊聊。</p>
      <Link to="/notes" className="btn btn-primary">
        去写一条笔记
      </Link>
    </div>
  );
}

export default function Talks() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: TalkStatus = isTab(raw) ? raw : 'active';
  const [state, setState] = useState<State>({ status: 'loading' });
  const [counts, setCounts] = useState<TalkPage['counts'] | null>(null);
  const [busy, setBusy] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const moreCtrl = useRef<AbortController | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    moreCtrl.current?.abort();
    setState({ status: 'loading' });
    setMoreError(null);
    listTalks(tab, 1, ctrl.signal)
      .then((data) => {
        setCounts(data.counts);
        setState({ status: 'ready', tab, items: data.items, page: 1, hasMore: data.has_more });
      })
      .catch((e: ApiError) => {
        if (!ctrl.signal.aborted) setState({ status: 'error', message: e.message });
      });
    return () => ctrl.abort();
  }, [tab, reload]);

  const stateRef = useRef(state);
  stateRef.current = state;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    let ctrl: AbortController | null = null;
    async function refresh() {
      const s = stateRef.current;
      if (document.hidden || s.status !== 'ready' || busyRef.current) return;
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const data = await listTalks(tab, 1, ctrl.signal);
        setCounts(data.counts);
        setState((cur) =>
          cur.status === 'ready' && cur.tab === tab && cur.page === 1 ? { ...cur, items: data.items, hasMore: data.has_more } : cur,
        );
        refreshUnreadTalks();
      } catch {
        // 静默轮询失败不打扰，下一轮再试
      }
    }
    const timer = window.setInterval(refresh, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
      ctrl?.abort();
    };
  }, [tab]);

  async function loadMore() {
    if (state.status !== 'ready') return;
    const ctrl = new AbortController();
    moreCtrl.current = ctrl;
    setBusy(true);
    setMoreError(null);
    try {
      const data = await listTalks(state.tab, state.page + 1, ctrl.signal);
      setCounts(data.counts);
      setState((s) => {
        if (s.status !== 'ready' || s.tab !== state.tab) return s;
        const seen = new Set(s.items.map((t) => t.id));
        return { ...s, items: [...s.items, ...data.items.filter((t) => !seen.has(t.id))], page: data.page, hasMore: data.has_more };
      });
    } catch (e) {
      if (!ctrl.signal.aborted) setMoreError((e as ApiError).message);
    } finally {
      if (!ctrl.signal.aborted) setBusy(false);
    }
  }

  const back = tab === 'active' ? '/talks' : `/talks?tab=${tab}`;

  return (
    <section className="page page-enter pane-page talks" aria-labelledby="talks-title">
      <div className="pane-bar">
        <div className="pane-heading">
          <h1 id="talks-title" className="pane-title">
            讨论
          </h1>
          <span className="pane-title-sub">每场讨论，都从一条具体的笔记开始。</span>
        </div>
        <div className="segmented talk-tabs" role="group" aria-label="讨论状态">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tab === t}
              onClick={() => setParams(t === 'active' ? {} : { tab: t }, { replace: true })}
            >
              {STATUS_LABEL[t]}
              <span className="talk-tab-count">{counts ? counts[t] : '–'}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="talks-body">
        {state.status === 'loading' && <SkeletonRows />}
        {state.status === 'error' && (
          <div className="notes-state" role="alert">
            <p>{state.message}</p>
            <button type="button" className="btn btn-ghost" onClick={() => setReload((n) => n + 1)}>
              重试
            </button>
          </div>
        )}
        {state.status === 'ready' && state.items.length === 0 && <Empty tab={state.tab} />}
        {state.status === 'ready' && state.items.length > 0 && (
          <>
            <ul className="talk-list" aria-busy={busy}>
              {state.items.map((t) => (
                <TalkRow key={t.id} talk={t} back={back} />
              ))}
            </ul>
            {state.hasMore && (
              <div className="notes-more">
                {moreError && (
                  <p className="field-msg is-error" role="alert">
                    {moreError}
                  </p>
                )}
                <button type="button" className="btn btn-ghost" onClick={loadMore} disabled={busy}>
                  {busy ? '加载中…' : moreError ? '重新加载' : '加载更多'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
