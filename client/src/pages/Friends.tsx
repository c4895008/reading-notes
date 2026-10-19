import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { PublicUser } from '../api/auth';
import { ApiError } from '../api/client';
import {
  acceptRequest,
  FRIENDS_PAGE_SIZE,
  listFriends,
  listRequests,
  rejectRequest,
  removeFriend,
  SEARCH_MAX,
  searchUsers,
  sendRequest,
  withdrawRequest,
  type Friend,
  type FriendRequest,
  type SearchUser,
} from '../api/friends';
import Avatar from '../components/Avatar';
import ConfirmDialog from '../components/ConfirmDialog';
import { SearchIcon } from '../components/Icons';
import { BadgeRow } from '../components/Badge';
import { useToast } from '../components/Toast';
import { setPendingCount } from '../lib/pendingRequests';
import { formatTime, fullTime } from '../lib/time';
import './Page.css';
import './Notes.css';
import './Friends.css';

type Lists = { friends: Friend[]; incoming: FriendRequest[]; outgoing: FriendRequest[] };
type ListKey = keyof Lists;
type Run = (key: string, fn: () => Promise<unknown>, done: string) => void;

const SEARCH_DELAY = 300;

const appendUnique = <T,>(prev: T[], next: T[], key: (item: T) => number) => {
  const seen = new Set(prev.map(key));
  return [...prev, ...next.filter((item) => !seen.has(key(item)))];
};

function Person({ user, meta, children }: { user: PublicUser; meta?: ReactNode; children?: ReactNode }) {
  return (
    <li className="person">
      <Avatar avatar={user.avatar} name={user.nickname} size={40} decorative />
      <div className="person-who">
        <span className="person-name">{user.nickname}</span>
        <span className="person-sub">
          @{user.username}
          {meta}
        </span>
        <BadgeRow badges={user.badges} />
      </div>
      <div className="person-actions">{children}</div>
    </li>
  );
}

function RequestTime({ at, verb }: { at: string; verb: string }) {
  return (
    <>
      <span aria-hidden="true"> · </span>
      <time dateTime={at} title={fullTime(at)}>
        {verb}于 {formatTime(at)}
      </time>
    </>
  );
}

function SkeletonPeople({ rows = 3 }: { rows?: number }) {
  return (
    <ul className="people" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="person is-skeleton">
          <span className="sk sk-avatar" />
          <span className="person-who">
            <span className="sk sk-title" />
            <span className="sk sk-line is-short" />
          </span>
        </li>
      ))}
    </ul>
  );
}

function Section({ id, title, count, children }: { id: string; title: string; count?: number; children: ReactNode }) {
  return (
    <section className="friends-section" aria-labelledby={id}>
      <h2 id={id} className="friends-heading">
        {title}
        {count !== undefined && count > 0 && <span className="friends-count">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

function LoadMore({ busy, label, onClick }: { busy: boolean; label: string; onClick: () => void }) {
  return (
    <div className="friends-more">
      <button type="button" className="btn btn-ghost btn-compact" disabled={busy} onClick={onClick}>
        {busy ? '加载中…' : label}
      </button>
    </div>
  );
}

function SearchActions({ user, busy, run }: { user: SearchUser; busy: string | null; run: Run }) {
  const name = `「${user.nickname}」`;
  const rid = user.request_id;
  switch (user.relation) {
    case 'friend':
      return <span className="relation-tag">读友</span>;
    case 'pending_out':
      return (
        <>
          <span className="relation-tag">已申请</span>
          <button
            type="button"
            className="text-btn"
            disabled={busy !== null}
            onClick={() => run(`withdraw:${rid}`, () => withdrawRequest(rid!), '已撤回申请')}
            aria-label={`撤回发给${name}的申请`}
          >
            撤回
          </button>
        </>
      );
    case 'pending_in':
      return (
        <>
          <button
            type="button"
            className="btn btn-primary btn-compact"
            disabled={busy !== null}
            onClick={() => run(`accept:${rid}`, () => acceptRequest(rid!), `你和${name}成为了读友`)}
          >
            同意
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            disabled={busy !== null}
            onClick={() => run(`reject:${rid}`, () => rejectRequest(rid!), `已拒绝${name}的申请`)}
          >
            拒绝
          </button>
        </>
      );
    default:
      return (
        <button
          type="button"
          className="btn btn-primary btn-compact"
          disabled={busy !== null}
          onClick={() => run(`send:${user.user_id}`, () => sendRequest(user.username), '申请已发出')}
          aria-label={`加${name}为读友`}
        >
          {busy === `send:${user.user_id}` ? '发送中…' : '加读友'}
        </button>
      );
  }
}

function UserSearch({ version, busy, run }: { version: number; busy: string | null; run: Run }) {
  const [q, setQ] = useState('');
  const [state, setState] = useState<{ q: string; items: SearchUser[] | null; error: string | null }>({
    q: '',
    items: null,
    error: null,
  });
  const lastVersion = useRef(version);
  const query = q.trim();

  useEffect(() => {
    if (!query) {
      setState({ q: '', items: null, error: null });
      return;
    }
    const ctrl = new AbortController();
    // 操作后重新拉取当前词，不再等待防抖
    const immediate = lastVersion.current !== version;
    lastVersion.current = version;
    const timer = setTimeout(
      () => {
        searchUsers(query, ctrl.signal)
          .then((items) => setState({ q: query, items, error: null }))
          .catch((e: ApiError) => {
            if (!ctrl.signal.aborted) setState({ q: query, items: null, error: e.message });
          });
      },
      immediate ? 0 : SEARCH_DELAY,
    );
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, version]);

  const settled = state.q === query;
  return (
    <div className="friends-search-block">
      <label className="notes-search">
        <SearchIcon />
        <span className="visually-hidden">搜索用户名或昵称</span>
        <input
          type="search"
          className="notes-search-input"
          placeholder="输入对方的用户名或昵称"
          value={q}
          maxLength={SEARCH_MAX}
          autoComplete="off"
          enterKeyHint="search"
          onChange={(e) => setQ(e.target.value)}
        />
      </label>

      {query && (
        <div className="search-results" aria-live="polite" aria-busy={!settled}>
          {state.error && settled ? (
            <p className="friends-note is-error">{state.error}</p>
          ) : state.items && settled ? (
            state.items.length ? (
              <ul className="people" aria-label="搜索结果">
                {state.items.map((u) => (
                  <Person key={u.user_id} user={u}>
                    <SearchActions user={u} busy={busy} run={run} />
                  </Person>
                ))}
              </ul>
            ) : (
              <p className="friends-note">没有找到相关用户。用户名需要完整输入，昵称可以只输入一部分。</p>
            )
          ) : (
            <SkeletonPeople rows={1} />
          )}
        </div>
      )}
    </div>
  );
}

export default function Friends() {
  const toast = useToast();
  const [lists, setLists] = useState<Lists | null>(null);
  const [totals, setTotals] = useState<Record<ListKey, number>>({ friends: 0, incoming: 0, outgoing: 0 });
  const [hasMore, setHasMore] = useState<Record<ListKey, boolean>>({ friends: false, incoming: false, outgoing: false });
  const [pages, setPages] = useState<Record<ListKey, number>>({ friends: 1, incoming: 1, outgoing: 1 });
  const [loadingMore, setLoadingMore] = useState<ListKey | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [searchVersion, setSearchVersion] = useState(0);
  const [removing, setRemoving] = useState<Friend | null>(null);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const [friends, incoming, outgoing] = await Promise.all([
        listFriends(1, FRIENDS_PAGE_SIZE),
        listRequests('in', 1, FRIENDS_PAGE_SIZE),
        listRequests('out', 1, FRIENDS_PAGE_SIZE),
      ]);
      if (mine !== generation.current) return;
      setLists({ friends: friends.items, incoming: incoming.items, outgoing: outgoing.items });
      setTotals({ friends: friends.total, incoming: incoming.total, outgoing: outgoing.total });
      setHasMore({ friends: friends.has_more, incoming: incoming.has_more, outgoing: outgoing.has_more });
      setPages({ friends: friends.page, incoming: incoming.page, outgoing: outgoing.page });
      setLoadingMore(null);
      setPendingCount(incoming.total);
      setLoadError(null);
    } catch (e) {
      if (mine === generation.current) setLoadError((e as ApiError).message);
    }
  }, []);

  async function loadMore(kind: ListKey) {
    if (!lists || loadingMore !== null || !hasMore[kind]) return;
    const mine = generation.current;
    setLoadingMore(kind);
    try {
      if (kind === 'friends') {
        const page = await listFriends(pages.friends + 1, FRIENDS_PAGE_SIZE);
        if (mine !== generation.current) return;
        setLists((prev) => prev && { ...prev, friends: appendUnique(prev.friends, page.items, (f) => f.user_id) });
        setTotals((prev) => ({ ...prev, friends: page.total }));
        setPages((prev) => ({ ...prev, friends: page.page }));
        setHasMore((prev) => ({ ...prev, friends: page.has_more }));
      } else {
        const type = kind === 'incoming' ? 'in' : 'out';
        const page = await listRequests(type, pages[kind] + 1, FRIENDS_PAGE_SIZE);
        if (mine !== generation.current) return;
        setLists((prev) => prev && { ...prev, [kind]: appendUnique(prev[kind], page.items, (r) => r.id) });
        setTotals((prev) => ({ ...prev, [kind]: page.total }));
        setPages((prev) => ({ ...prev, [kind]: page.page }));
        setHasMore((prev) => ({ ...prev, [kind]: page.has_more }));
      }
    } catch (e) {
      if (mine === generation.current) toast((e as ApiError).message);
    } finally {
      setLoadingMore(null);
    }
  }

  useEffect(() => {
    load();
    // 对方的同意或新申请在回到页面时即可看到
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const run = useCallback<Run>(
    async (key, fn, done) => {
      setBusy(key);
      try {
        await fn();
        toast(done);
      } catch (e) {
        // 状态已在别处变化（对方撤回、已处理等）：提示原因并以服务端为准刷新
        toast((e as ApiError).message);
      }
      await load();
      setSearchVersion((v) => v + 1);
      setBusy(null);
    },
    [load, toast],
  );

  async function confirmRemove() {
    if (!removing) return;
    const friend = removing;
    await run(`remove:${friend.user_id}`, () => removeFriend(friend.user_id), `已解除与「${friend.nickname}」的读友关系`);
    setRemoving(null);
  }

  return (
    <section className="page page-enter friends" aria-labelledby="page-title">
      <h1 id="page-title" className="page-title">
        读友
      </h1>

      <Section id="friends-add" title="添加读友">
        <UserSearch version={searchVersion} busy={busy} run={run} />
      </Section>

      {loadError && !lists && (
        <div className="notes-state" role="alert">
          <p>{loadError}</p>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setLoadError(null);
              load();
            }}
          >
            重试
          </button>
        </div>
      )}

      {!lists && !loadError && (
        <Section id="friends-mine" title="我的读友">
          <SkeletonPeople />
        </Section>
      )}

      {lists && (
        <>
          {lists.incoming.length > 0 && (
            <Section id="friends-in" title="收到的申请" count={totals.incoming}>
              <ul className="people">
                {lists.incoming.map((r) => (
                  <Person key={r.id} user={r.user} meta={<RequestTime at={r.created_at} verb="申请" />}>
                    <button
                      type="button"
                      className="btn btn-primary btn-compact"
                      disabled={busy !== null}
                      onClick={() => run(`accept:${r.id}`, () => acceptRequest(r.id), `你和「${r.user.nickname}」成为了读友`)}
                      aria-label={`同意「${r.user.nickname}」的申请`}
                    >
                      同意
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-compact"
                      disabled={busy !== null}
                      onClick={() => run(`reject:${r.id}`, () => rejectRequest(r.id), `已拒绝「${r.user.nickname}」的申请`)}
                      aria-label={`拒绝「${r.user.nickname}」的申请`}
                    >
                      拒绝
                    </button>
                  </Person>
                ))}
              </ul>
              {hasMore.incoming && (
                <LoadMore
                  busy={loadingMore === 'incoming'}
                  label="加载更多收到的申请"
                  onClick={() => loadMore('incoming')}
                />
              )}
            </Section>
          )}

          <Section id="friends-mine" title="我的读友" count={totals.friends}>
            {lists.friends.length ? (
              <>
                <ul className="people">
                  {lists.friends.map((f) => (
                    <Person key={f.user_id} user={f}>
                      <button
                        type="button"
                        className="text-btn is-weak"
                        disabled={busy !== null}
                        onClick={() => setRemoving(f)}
                        aria-label={`解除与「${f.nickname}」的读友关系`}
                      >
                        解除
                      </button>
                    </Person>
                  ))}
                </ul>
                {hasMore.friends && (
                  <LoadMore busy={loadingMore === 'friends'} label="加载更多读友" onClick={() => loadMore('friends')} />
                )}
              </>
            ) : (
              <p className="friends-empty">还没有读友。搜索用户名，发出第一份好友申请。</p>
            )}
          </Section>

          {lists.outgoing.length > 0 && (
            <Section id="friends-out" title="发出的申请" count={totals.outgoing}>
              <ul className="people">
                {lists.outgoing.map((r) => (
                  <Person key={r.id} user={r.user} meta={<RequestTime at={r.created_at} verb="发出" />}>
                    <span className="relation-tag">等待回应</span>
                    <button
                      type="button"
                      className="text-btn"
                      disabled={busy !== null}
                      onClick={() => run(`withdraw:${r.id}`, () => withdrawRequest(r.id), '已撤回申请')}
                      aria-label={`撤回发给「${r.user.nickname}」的申请`}
                    >
                      撤回
                    </button>
                  </Person>
                ))}
              </ul>
              {hasMore.outgoing && (
                <LoadMore
                  busy={loadingMore === 'outgoing'}
                  label="加载更多发出的申请"
                  onClick={() => loadMore('outgoing')}
                />
              )}
            </Section>
          )}
        </>
      )}

      <ConfirmDialog
        open={removing !== null}
        title="解除读友？"
        message={
          removing
            ? `解除后，对方将不能再看到你发起的笔谈，你也将退出对方发起的笔谈。确定解除与「${removing.nickname}」的读友关系？`
            : undefined
        }
        confirmLabel="解除"
        danger
        busy={busy !== null && busy.startsWith('remove:')}
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      />
    </section>
  );
}
