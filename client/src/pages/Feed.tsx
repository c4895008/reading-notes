import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { listFeed, type FeedPage, type LikeState } from '../api/feed';
import { useAuth } from '../auth/AuthContext';
import Avatar from '../components/Avatar';
import { BackIcon, ChevronIcon, FeedIcon } from '../components/Icons';
import LikeButton from '../components/LikeButton';
import { QuoteBlock } from '../components/NoteContent';
import { KindBadge } from '../components/NoteKind';
import { useToast } from '../components/Toast';
import { ago, fullTime } from '../lib/time';
import './Page.css';
import './Notes.css';
import './Feed.css';

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: FeedPage };

export default function Feed() {
  const [params, setParams] = useSearchParams();
  const rawPage = params.get('page');
  const page = rawPage && /^[1-9]\d{0,5}$/.test(rawPage) ? Number(rawPage) : 1;
  const { user } = useAuth();
  const location = useLocation();
  const toast = useToast();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    setState((s) => s.status === 'ready' && s.data.page === page ? s : { status: 'loading' });
    setRefreshError(null);
    async function refresh() {
      ctrl.current?.abort();
      const next = new AbortController();
      ctrl.current = next;
      setRefreshing(true);
      try {
        const data = await listFeed(page, next.signal);
        if (next.signal.aborted) return;
        const lastPage = Math.max(1, Math.ceil(data.total / data.page_size));
        if (page > lastPage) {
          setParams(lastPage > 1 ? { page: String(lastPage) } : {}, { replace: true });
          return;
        }
        setState({ status: 'ready', data });
        setRefreshError(null);
      } catch (e) {
        if (next.signal.aborted) return;
        const message = (e as ApiError).message;
        setRefreshError(message);
        setState((s) => s.status === 'ready' ? s : { status: 'error', message });
      } finally {
        if (!next.signal.aborted) setRefreshing(false);
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
  }, [page, reload, setParams]);

  function liked(id: number, value: LikeState) {
    ctrl.current?.abort();
    setRefreshing(false);
    setState((s) => s.status === 'ready'
      ? { ...s, data: { ...s.data, items: s.data.items.map((item) => item.id === id ? { ...item, ...value } : item) } } : s);
  }

  function missing(id: number) {
    ctrl.current?.abort();
    setState((s) => s.status === 'ready'
      ? { ...s, data: { ...s.data, items: s.data.items.filter((item) => item.id !== id) } } : s);
    toast('这条笔记已不可见，动态已刷新');
    setReload((r) => r + 1);
  }

  function choosePage(next: number) {
    setParams(next > 1 ? { page: String(next) } : {});
    document.querySelector('.shell-main')?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }

  const data = state.status === 'ready' && state.data.page === page ? state.data : null;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const back = location.pathname + location.search;

  return (
    <section className="page page-enter pane-page feed" aria-labelledby="feed-title">
      <div className="pane-bar">
        <div className="pane-heading">
          <h1 id="feed-title" className="pane-title">好友动态</h1>
          <span className="pane-title-sub">看看读友最近分享的阅读与思考。</span>
        </div>
        <button type="button" className="btn btn-ghost" disabled={refreshing} onClick={() => setReload((r) => r + 1)}>
          {refreshing ? '刷新中…' : '刷新'}
        </button>
      </div>
      <div className="feed-body">
        {(state.status === 'loading' || state.status === 'ready' && !data) && (
          <div className="feed-loading" role="status"><FeedIcon size={28} /><p>正在加载好友动态…</p></div>
        )}
        {state.status === 'error' && (
          <div className="notes-state" role="alert">
            <p>{state.message}</p>
            <button type="button" className="btn btn-ghost" onClick={() => setReload((r) => r + 1)}>重试</button>
          </div>
        )}
        {data && refreshError && (
          <p className="feed-refresh-error field-msg is-error" role="alert">{refreshError} 可点击刷新重试。</p>
        )}
        {data && data.items.length === 0 && (
          <div className="feed-empty">
            <FeedIcon size={32} />
            <h2>还没有好友动态</h2>
            <p>自己或读友把笔记设为好友可见后，就会出现在这里。</p>
            <div className="feed-empty-actions">
              <Link to="/notes" className="btn btn-primary">去看我的笔记</Link>
              <Link to="/friends" className="btn btn-ghost">看看读友</Link>
            </div>
          </div>
        )}
        {data && data.items.length > 0 && (
          <>
            <ul className="feed-list">
              {data.items.map((item) => {
                const mine = item.author.user_id === user!.user_id;
                const to = mine ? `/notes/${item.id}` : `/feed/${item.id}`;
                return (
                  <li key={item.id}>
                    <article className="feed-card" aria-labelledby={`feed-note-${item.id}`}>
                      <header className="feed-author">
                        <Avatar avatar={item.author.avatar} name={item.author.nickname} size={40} decorative />
                        <div className="feed-author-text">
                          <strong>{item.author.nickname}{mine && <span className="feed-mine">我</span>}</strong>
                          <p><time dateTime={item.shared_at} title={fullTime(item.shared_at)}>{ago(item.shared_at)}</time><span aria-hidden="true"> · </span>好友可见</p>
                        </div>
                        <KindBadge kind={item.kind} />
                      </header>
                      <h2 id={`feed-note-${item.id}`} className="feed-title"><Link to={to} state={{ back }}>{item.title}</Link></h2>
                      {item.quote && <QuoteBlock text={item.quote} />}
                      {item.excerpt && <p className="feed-excerpt">{item.excerpt}</p>}
                      <footer className="feed-card-foot">
                        <LikeButton
                          noteId={item.id}
                          liked={item.liked}
                          like_count={item.like_count}
                          readOnly={mine}
                          onChange={(value) => liked(item.id, value)}
                          onMissing={() => missing(item.id)}
                        />
                        <Link to={to} state={{ back }} className="feed-read" aria-label={`阅读全文：${item.title}`}>阅读全文<ChevronIcon size={14} /></Link>
                      </footer>
                    </article>
                  </li>
                );
              })}
            </ul>
            <nav className="feed-pagination" aria-label="好友动态分页">
              <button type="button" className="btn btn-ghost" disabled={page === 1} onClick={() => choosePage(page - 1)}><BackIcon size={14} />上一页</button>
              <span>{page} / {pages} 页 · 共 {data.total} 条</span>
              <button type="button" className="btn btn-ghost" disabled={!data.has_more} onClick={() => choosePage(page + 1)}>下一页<ChevronIcon size={14} /></button>
            </nav>
          </>
        )}
      </div>
    </section>
  );
}
