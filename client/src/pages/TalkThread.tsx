import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { MESSAGE_LIMIT, type Message } from '../api/discussions';
import { useAuth } from '../auth/AuthContext';
import Avatar from '../components/Avatar';
import { BadgeRow } from '../components/Badge';
import { clock, dayKey, dayLabel, fullTime } from '../lib/time';
import '../components/NoteTalkPanel.css';

export type Pending = { key: string; content: string; at: string; failed: string | null };

export function mergeById(prev: Message[], fresh: Message[]) {
  if (!fresh.length) return prev;
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of fresh) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

const URL_RE = /https?:\/\/[^\s<>"'\u3000-\u303f\uff00-\uffef]+/g;
const TRAILING_PUNCT_RE = /[.,;:!?)\]}'"]+$/;

// 纯文本渲染：React 负责转义，只把 http(s) 地址包成链接
export function MessageText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const url = match[0].replace(TRAILING_PUNCT_RE, '');
    const start = match.index;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <a key={start} href={url} target="_blank" rel="noopener noreferrer">
        {url}
      </a>,
    );
    last = start + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <p className="msg-text">{parts}</p>;
}

type Item = { kind: 'message'; message: Message } | { kind: 'pending'; pending: Pending };
const itemAt = (it: Item) => (it.kind === 'message' ? it.message.created_at : it.pending.at);

function MessageRow({ message: m }: { message: Message }) {
  return (
    <li className={`talk-card${m.is_mine ? ' is-mine' : ''}`} data-message-id={m.id}>
      <div className="talk-card-head">
        <Avatar avatar={m.sender.avatar} name={m.sender.nickname} size={24} decorative />
        <span className="talk-card-name">{m.sender.nickname}</span>
        {m.is_initiator && <span className="talk-card-badge">作者</span>}
        <time className="talk-card-time" dateTime={m.created_at} title={fullTime(m.created_at)}>
          {clock(m.created_at)}
        </time>
        <span className="talk-card-seq">#{m.seq}</span>
      </div>
      {m.sender.badges.length > 0 && (
        <div className="talk-card-badges">
          <BadgeRow badges={m.sender.badges} />
        </div>
      )}
      <MessageText text={m.content} />
    </li>
  );
}

function PendingRow({ pending: p, onRetry }: { pending: Pending; onRetry: (key: string) => void }) {
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

type ThreadProps = {
  messages: Message[];
  pending: Pending[];
  emptyText: string;
  onRetry: (key: string) => void;
  hasOlder: boolean;
  loadingOlder: boolean;
  olderError: string | null;
  onLoadOlder: () => void;
};

export function Thread({ messages, pending, emptyText, onRetry, hasOlder, loadingOlder, olderError, onLoadOlder }: ThreadProps) {
  const items: Item[] = [...messages.map((message) => ({ kind: 'message' as const, message })), ...pending.map((p) => ({ kind: 'pending' as const, pending: p }))];
  if (!items.length) {
    return (
      <section className="talk-thread is-empty" aria-label="消息">
        <p className="talk-thread-empty">{emptyText}</p>
      </section>
    );
  }

  const rows: ReactNode[] = [];
  let day = '';
  for (const it of items) {
    const at = itemAt(it);
    if (dayKey(at) !== day) {
      day = dayKey(at);
      rows.push(
        <li key={`day-${day}`} className="msg-day" role="separator" aria-label={dayLabel(at)}>
          <span>{dayLabel(at)}</span>
        </li>,
      );
    }
    rows.push(it.kind === 'message' ? <MessageRow key={it.message.id} message={it.message} /> : <PendingRow key={it.pending.key} pending={it.pending} onRetry={onRetry} />);
  }
  return (
    <section className="talk-thread" aria-label="消息">
      {(hasOlder || olderError) && (
        <div className="thread-older">
          <button type="button" className="btn btn-ghost" disabled={loadingOlder} onClick={onLoadOlder}>
            {loadingOlder ? '加载中…' : olderError ? '重试加载更早的消息' : '加载更早的消息'}
          </button>
          {olderError && (
            <p className="thread-older-error" role="alert">
              {olderError}
            </p>
          )}
        </div>
      )}
      <ol className="talk-panel-cards">{rows}</ol>
    </section>
  );
}

const MAX_INPUT_HEIGHT = 136;
const COUNTER_FROM = MESSAGE_LIMIT - 200;

export function Composer({ onSend }: { onSend: (text: string) => void }) {
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
      <label htmlFor="composer-input" className="visually-hidden">
        写下你的想法
      </label>
      <textarea
        id="composer-input"
        ref={ref}
        className="talk-panel-input"
        rows={3}
        value={draft}
        placeholder="写下你的想法…"
        aria-describedby={length >= COUNTER_FROM ? 'composer-count' : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="talk-panel-compose-row">
        <span className="talk-panel-tip">
          {length >= COUNTER_FROM ? (
            <span id="composer-count" className={over ? 'is-over' : undefined}>
              {length} / {MESSAGE_LIMIT}
            </span>
          ) : (
            'Enter 发送，Shift+Enter 换行'
          )}
        </span>
        <button type="submit" className="talk-panel-send" disabled={!canSend}>
          发送
        </button>
      </div>
    </form>
  );
}
