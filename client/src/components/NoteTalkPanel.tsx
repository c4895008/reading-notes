import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../api/client';
import {
  listLatestMessages,
  markTalkRead,
  MESSAGE_LIMIT,
  sendMessage,
  STATUS_LABEL,
  type Message,
  type Participant,
  type TalkStatus,
  type TalkSummary,
} from '../api/discussions';
import { useAuth } from '../auth/AuthContext';
import { randomKey } from '../lib/id';
import { ago, fullTime } from '../lib/time';
import { refreshUnreadTalks } from '../lib/unreadTalks';
import { mergeById, MessageText, type Pending } from '../pages/TalkThread';
import Avatar from './Avatar';
import AvatarGroup from './AvatarGroup';
import { PlusIcon, TalkIcon } from './Icons';
import { useBadgeToast } from './Toast';
import './NoteTalkPanel.css';

type Props = { talk: TalkSummary | null; here: string; onStart: () => void; onInvite: () => void };
type Load = { status: 'loading' } | { status: 'ready' } | { status: 'error'; message: string };

const MAX_INPUT_HEIGHT = 160;
const COUNTER_FROM = MESSAGE_LIMIT - 200;

const READONLY_TEXT: Record<Exclude<TalkStatus, 'active'>, string> = {
  ended: '讨论已完结，仅可回看。',
  archived: '讨论已存档，仅可回看。',
};

function Head({ count, status }: { count?: string; status?: TalkStatus }) {
  return (
    <header className="talk-panel-head">
      <h2 id="talk-panel-title" className="talk-panel-title">
        <TalkIcon size={16} />
        读友讨论
      </h2>
      {status && status !== 'active' && <span className="talk-tag">{STATUS_LABEL[status]}</span>}
      {count && <span className="talk-panel-count">{count}</span>}
    </header>
  );
}

function Card({ message: m }: { message: Message }) {
  return (
    <li className={`talk-card${m.is_mine ? ' is-mine' : ''}`} data-message-id={m.id}>
      <div className="talk-card-head">
        <Avatar avatar={m.sender.avatar} name={m.sender.nickname} size={24} decorative />
        <span className="talk-card-name">{m.sender.nickname}</span>
        {m.is_initiator && <span className="talk-card-badge">作者</span>}
        <time className="talk-card-time" dateTime={m.created_at} title={fullTime(m.created_at)}>
          {ago(m.created_at)}
        </time>
      </div>
      <MessageText text={m.content} />
    </li>
  );
}

function PendingCard({ pending: p, onRetry }: { pending: Pending; onRetry: (key: string) => void }) {
  const { user } = useAuth();
  return (
    <li className={`talk-card is-mine is-pending${p.failed ? ' is-failed' : ''}`}>
      <div className="talk-card-head">
        {user && <Avatar avatar={user.avatar} name={user.nickname} size={24} decorative />}
        <span className="talk-card-name">{user?.nickname}</span>
        {p.failed ? (
          <span className="talk-card-time is-failed" title={p.failed}>
            未发送，
            <button type="button" className="talk-card-retry" onClick={() => onRetry(p.key)}>
              重试
            </button>
          </span>
        ) : (
          <span className="talk-card-time">发送中…</span>
        )}
      </div>
      <MessageText text={p.content} />
    </li>
  );
}

function Compose({ onSend }: { onSend: (text: string) => void }) {
  const [draft, setDraft] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const length = [...draft].length;
  const over = length > MESSAGE_LIMIT;
  const canSend = draft.trim() !== '' && !over;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  }, [draft]);

  function submit() {
    if (!canSend) return;
    onSend(draft);
    setDraft('');
    ref.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey) return;
    // 输入法组合中的 Enter 是选词，不是发送；Safari 用 keyCode 229 表示
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    submit();
  }

  return (
    <form
      className="talk-panel-compose"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor="talk-panel-input" className="visually-hidden">
        写下你的想法
      </label>
      <textarea
        id="talk-panel-input"
        ref={ref}
        className="talk-panel-input"
        rows={3}
        value={draft}
        placeholder="写下你的想法、延伸或讨论…"
        aria-describedby={length >= COUNTER_FROM ? 'talk-panel-count' : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="talk-panel-compose-row">
        <span className="talk-panel-tip">
          {length >= COUNTER_FROM ? (
            <span id="talk-panel-count" className={over ? 'is-over' : undefined}>
              {length} / {MESSAGE_LIMIT}
            </span>
          ) : (
            'Enter 发送，Shift+Enter 换行'
          )}
        </span>
        <button type="submit" className="talk-panel-send" disabled={!canSend}>
          发布讨论
        </button>
      </div>
    </form>
  );
}

function LiveTalk({ talk, here, onInvite }: { talk: TalkSummary; here: string; onInvite: () => void }) {
  const badgeToast = useBadgeToast();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<TalkStatus>(talk.status);
  const [people, setPeople] = useState<Participant[]>(talk.participants);
  const [pending, setPending] = useState<Pending[]>([]);
  const [backlog, setBacklog] = useState(false);
  const [lost, setLost] = useState(false);

  // 未读只在「全部未读都在预览里」时清零；lastSeen 只随拉取推进，自己发出的不推进
  const unread = useRef(talk.unread);
  const lastSeen = useRef(0);
  const seq = useRef(0);
  const lostRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const talkId = talk.id;

  const refresh = useCallback(
    async (initial: boolean) => {
      if (lostRef.current) return;
      const mine = ++seq.current;
      try {
        const page = await listLatestMessages(talkId);
        if (mine !== seq.current) return;
        const list = page.messages;
        if (!initial) {
          const fresh = list.filter((m) => m.id > lastSeen.current && !m.is_mine).length;
          const gap = page.has_more && list.length > 0 && list[0].id > lastSeen.current;
          unread.current = gap ? Number.POSITIVE_INFINITY : unread.current + fresh;
        }
        if (list.length) lastSeen.current = Math.max(lastSeen.current, list[list.length - 1].id);
        const othersShown = list.filter((m) => !m.is_mine).length;
        const allShown = !page.has_more || othersShown >= unread.current;
        if (unread.current > 0 && allShown && document.visibilityState === 'visible') {
          unread.current = 0;
          markTalkRead(talkId)
            .then(() => refreshUnreadTalks())
            .catch(() => {});
        }
        setMessages(list);
        setHasMore(page.has_more);
        setStatus(page.status);
        setPeople(page.participants);
        setPending((p) => p.filter((x) => !list.some((m) => m.client_message_id === x.key)));
        setBacklog(unread.current > 0 && !allShown);
        setLoad({ status: 'ready' });
      } catch (e) {
        if (mine !== seq.current) return;
        const err = e as ApiError;
        if (err.status === 404) {
          lostRef.current = true;
          setLost(true);
          setLoad({ status: 'ready' });
        } else if (initial) setLoad({ status: 'error', message: err.message });
      }
    },
    [talkId],
  );

  useEffect(() => {
    unread.current = talk.unread;
    refresh(true);
  }, [talk, refresh]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh(false);
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      seq.current++;
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  async function deliver(key: string, content: string) {
    try {
      const { message, new_badges } = await sendMessage(talkId, content, key);
      setPending((p) => p.filter((x) => x.key !== key));
      setMessages((prev) => mergeById(prev, [message]));
      badgeToast(new_badges);
      refresh(false);
    } catch (e) {
      const err = e as ApiError;
      setPending((p) => p.map((x) => (x.key === key ? { ...x, failed: err.message } : x)));
      if (err.status === 404) {
        lostRef.current = true;
        setLost(true);
      } else if (err.code === 'DISCUSSION_NOT_ACTIVE') refresh(false);
    }
  }

  function send(text: string) {
    const content = text.trim();
    const key = randomKey();
    setPending((p) => [...p, { key, content, at: new Date().toISOString(), failed: null }]);
    listRef.current?.scrollTo({ top: 0 });
    deliver(key, content);
  }

  function retry(key: string) {
    const item = pending.find((x) => x.key === key);
    if (!item) return;
    setPending((p) => p.map((x) => (x.key === key ? { ...x, failed: null } : x)));
    deliver(key, item.content);
  }

  const readonlyText = lost ? '你已不在这次讨论中。' : status !== 'active' ? READONLY_TEXT[status] : null;
  const count = load.status === 'ready' ? `${messages.length}${hasMore ? '+' : ''} 条` : undefined;
  const full = { pathname: `/talks/${talkId}` };

  return (
    <>
      <Head count={count} status={status} />
      <div className="talk-panel-people">
        <AvatarGroup users={people} max={5} size={24} />
        <span>{people.length} 位参与者</span>
      </div>

      <div className="talk-panel-list" ref={listRef}>
        {load.status === 'loading' && (
          <div className="talk-panel-skeleton" aria-hidden="true">
            <span className="sk sk-block" />
            <span className="sk sk-block" />
          </div>
        )}
        {load.status === 'error' && (
          <div className="talk-panel-state" role="alert">
            <p>{load.message}</p>
            <button type="button" className="btn btn-ghost" onClick={() => refresh(true)}>
              重试
            </button>
          </div>
        )}
        {load.status === 'ready' && (
          <>
            {backlog && (
              <p className="talk-panel-backlog">
                未读发言较多，这里只显示最近 {messages.length} 条。
                <Link to={full} state={{ back: here }}>
                  进入讨论查看
                </Link>
              </p>
            )}
            {messages.length + pending.length === 0 ? (
              <p className="talk-panel-empty">讨论已开始，还没有人发言。从你此刻最真实的想法写起。</p>
            ) : (
              <ol className="talk-panel-cards" aria-label="最近发言，最新在上">
                {[...pending].reverse().map((p) => (
                  <PendingCard key={p.key} pending={p} onRetry={retry} />
                ))}
                {[...messages].reverse().map((m) => (
                  <Card key={m.id} message={m} />
                ))}
              </ol>
            )}
          </>
        )}
      </div>

      <div className="talk-panel-foot">
        {readonlyText ? (
          <p className="talk-panel-readonly" role="status">
            {readonlyText}
          </p>
        ) : (
          <Compose onSend={send} />
        )}
        <div className="talk-panel-links">
          <Link to={full} state={{ back: here }} className="talk-panel-link">
            进入讨论查看全部 →
          </Link>
          {status === 'active' && !lost && (
            <button type="button" className="talk-panel-link" onClick={onInvite}>
              <PlusIcon size={14} />
              邀请更多读友
            </button>
          )}
        </div>
      </div>
    </>
  );
}

export default function NoteTalkPanel({ talk, here, onStart, onInvite }: Props) {
  return (
    <section className={`talk-panel${talk ? '' : ' is-empty'}`} aria-labelledby="talk-panel-title">
      {talk ? (
        <LiveTalk key={talk.id} talk={talk} here={here} onInvite={onInvite} />
      ) : (
        <>
          <Head />
          <div className="talk-panel-start">
            <p>还没有就这条笔记聊过。邀请读友，把想法聊透。</p>
            <button type="button" className="talk-panel-send" onClick={onStart}>
              <TalkIcon size={14} />
              发起讨论
            </button>
          </div>
        </>
      )}
    </section>
  );
}
