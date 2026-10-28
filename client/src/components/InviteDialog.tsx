import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../api/client';
import { INVITE_LIMIT, inviteToTalk, startTalk, type InviteResult } from '../api/discussions';
import { listFriends, FRIENDS_PAGE_SIZE, type Friend } from '../api/friends';
import Avatar from './Avatar';
import { SearchIcon } from './Icons';
import './ConfirmDialog.css';
import './NotePicker.css';
import './InviteDialog.css';
import '../pages/Notes.css';

export type InviteTarget =
  | { kind: 'start'; noteId: number; title: string; layers: number }
  | { kind: 'invite'; talkId: number; title: string; layers: number; exclude: number[] };

type Props = {
  open: boolean;
  target: InviteTarget;
  onDone: (result: InviteResult) => void;
  // 讨论已存在、已完结、笔记已删除等需要页面整体处理的错误
  onFail: (error: ApiError) => void;
  onClose: () => void;
};

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; friends: Friend[]; hasMore: boolean };

const PAGE_ERRORS = new Set(['DISCUSSION_EXISTS', 'DISCUSSION_NOT_ACTIVE', 'DISCUSSION_NOT_FOUND', 'NOTE_FORBIDDEN', 'NOT_INITIATOR']);

const scopeLine = (layers: number) =>
  layers > 0 ? `读友会看到这条笔记的引文与想法，以及它上方 ${layers} 层提炼` : '读友会看到这条笔记的引文与想法';

export default function InviteDialog({ open, target, onDone, onFail, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [friendsPage, setFriendsPage] = useState(1);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const returnTo = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => {
      dialog.close();
      if (returnTo?.isConnected) returnTo.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setState({ status: 'loading' });
    setQuery('');
    setPicked(new Set());
    setError('');
    setLoadingMore(false);
    setFriendsPage(1);
    listFriends()
      .then((page) => {
        if (!live) return;
        setState({ status: 'ready', friends: page.items, hasMore: page.has_more });
        requestAnimationFrame(() => inputRef.current?.focus());
      })
      .catch((e: ApiError) => live && setState({ status: 'error', message: e.message }));
    return () => {
      live = false;
    };
  }, [open, reload]);

  const exclude = new Set(target.kind === 'invite' ? target.exclude : []);
  const candidates = state.status === 'ready' ? state.friends.filter((f) => !exclude.has(f.user_id)) : [];
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? candidates.filter((f) => f.nickname.toLowerCase().includes(needle) || f.username.includes(needle))
    : candidates;
  const full = picked.size >= INVITE_LIMIT;

  function toggle(id: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < INVITE_LIMIT) next.add(id);
      return next;
    });
  }

  async function loadMoreFriends() {
    if (state.status !== 'ready' || !state.hasMore || loadingMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const page = await listFriends(friendsPage + 1, FRIENDS_PAGE_SIZE);
      setFriendsPage(page.page);
      setState((prev) => {
        if (prev.status !== 'ready') return prev;
        const seen = new Set(prev.friends.map((f) => f.user_id));
        return {
          status: 'ready',
          friends: [...prev.friends, ...page.items.filter((f) => !seen.has(f.user_id))],
          hasMore: page.has_more,
        };
      });
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoadingMore(false);
    }
  }

  async function submit() {
    if (busy || picked.size === 0) return;
    setBusy(true);
    setError('');
    const ids = [...picked];
    try {
      const result = target.kind === 'start' ? await startTalk(target.noteId, ids) : await inviteToTalk(target.talkId, ids);
      onDone(result);
    } catch (e) {
      const err = e as ApiError;
      if (PAGE_ERRORS.has(err.code)) onFail(err);
      else {
        setError(err.message);
        if (err.code === 'INVITEE_NOT_FRIEND') setReload((n) => n + 1);
      }
    } finally {
      setBusy(false);
    }
  }

  const close = () => {
    if (!busy) onClose();
  };

  return (
    <dialog
      ref={ref}
      className="confirm picker invite"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      {open && (
        <div className="picker-body">
          <div className="picker-head">
            <p className="invite-eyebrow">讨论</p>
            <h2 id={titleId} className="confirm-title">
              {target.kind === 'start' ? `关于「${target.title}」` : '邀请更多读友'}
            </h2>
            <p className="picker-sub">
              {target.kind === 'start'
                ? '围绕这条笔记，开启一场讨论。受邀读友会在同一处讨论，相互可见。'
                : `新加入的读友会看到「${target.title}」的这场讨论，与大家同场讨论。`}
            </p>
            <p className="invite-scope">{scopeLine(target.layers)}</p>
            {candidates.length > 0 && (
              <div className="notes-search picker-search">
                <SearchIcon />
                <input
                  ref={inputRef}
                  type="search"
                  className="notes-search-input"
                  placeholder="搜索读友昵称或用户名"
                  aria-label="搜索读友"
                  value={query}
                  maxLength={20}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="picker-list-wrap">
            {state.status === 'loading' && <p className="picker-state">加载中…</p>}
            {state.status === 'error' && (
              <div className="picker-state" role="alert">
                <p>{state.message}</p>
                <button type="button" className="btn btn-ghost" onClick={() => setReload((n) => n + 1)}>
                  重试
                </button>
              </div>
            )}
            {state.status === 'ready' && candidates.length === 0 && (
              <div className="picker-state">
                <p>{state.friends.length === 0 ? '还没有读友。先去添加一位读友。' : '你的读友都已在这场讨论里了。'}</p>
                <Link to="/friends" className="btn btn-ghost">
                  去添加读友
                </Link>
              </div>
            )}
            {state.status === 'ready' && candidates.length > 0 && shown.length === 0 && (
              <p className="picker-state">没有昵称或用户名包含「{query.trim()}」的读友。</p>
            )}
            {shown.length > 0 && (
              <ul className="invite-list" aria-label="选择读友">
                {shown.map((f) => {
                  const checked = picked.has(f.user_id);
                  return (
                    <li key={f.user_id}>
                      <label className={`invite-item${checked ? ' is-checked' : ''}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!checked && full}
                          onChange={() => toggle(f.user_id)}
                        />
                        <Avatar avatar={f.avatar} name={f.nickname} size={32} decorative />
                        <span className="invite-who">
                          <span className="invite-name">{f.nickname}</span>
                          <span className="invite-username">@{f.username}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            {state.status === 'ready' && state.hasMore && (
              <div className="picker-more">
                <button type="button" className="btn btn-ghost btn-compact" disabled={loadingMore} onClick={loadMoreFriends}>
                  {loadingMore ? '加载中…' : '加载更多读友'}
                </button>
              </div>
            )}
          </div>

          <div className="picker-foot">
            <p className={`picker-note${error ? ' is-error' : ''}`} role={error ? 'alert' : undefined}>
              {error || (full ? `单次最多邀请 ${INVITE_LIMIT} 位` : picked.size > 0 ? `已选 ${picked.size} 位` : '至少选择 1 位读友')}
            </p>
            <div className="invite-actions">
              <button type="button" className="btn btn-ghost" onClick={close} disabled={busy}>
                取消
              </button>
              <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || picked.size === 0}>
                {busy ? '处理中…' : target.kind === 'start' ? '发起讨论' : '邀请'}
              </button>
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}
