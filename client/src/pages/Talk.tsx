import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import {
  getTalk,
  listLatestMessages,
  listMessages,
  listMessagesBefore,
  markTalkRead,
  sendMessage,
  STATUS_LABEL,
  transitionTalk,
  type InviteResult,
  type Message,
  type Participant,
  type SnapshotPart,
  type Talk as TalkData,
  type TalkStatus,
  type TransitionAction,
} from '../api/discussions';
import Avatar from '../components/Avatar';
import AvatarGroup from '../components/AvatarGroup';
import { useExplorerContent } from '../components/Explorer';
import TalksExplorer from '../components/TalksExplorer';
import { BackIcon, ChevronIcon, PlusIcon } from '../components/Icons';
import InviteDialog from '../components/InviteDialog';
import { NoteBody, QuoteBlock } from '../components/NoteContent';
import ConfirmDialog from '../components/ConfirmDialog';
import { BadgeRow } from '../components/Badge';
import { useBadgeToast, useToast } from '../components/Toast';
import { randomKey } from '../lib/id';
import { formatDate, fullTime } from '../lib/time';
import { refreshUnreadTalks } from '../lib/unreadTalks';
import { Composer, Thread, type Pending } from './TalkThread';
import { ReadingSkeleton } from './NoteView';
import './Page.css';
import './Notes.css';
import './Friends.css';
import './Talks.css';

type State = { status: 'loading' } | { status: 'missing' } | { status: 'error'; message: string } | { status: 'ready'; talk: TalkData };

const POLL_MS = 10_000;
const NEAR_BOTTOM_PX = 160;

const lastIdOf = (list: Message[], fallback: number) => (list.length ? list[list.length - 1].id : fallback);

// 轮询增量：after_id 之后的消息；极端积压时按 has_more 续拉
async function fetchSince(talkId: string | number, afterId: number, signal?: AbortSignal) {
  const messages: Message[] = [];
  let after = afterId;
  for (;;) {
    const page = await listMessages(talkId, after, signal);
    messages.push(...page.messages);
    after = lastIdOf(page.messages, after);
    if (!page.has_more) return { ...page, messages };
  }
}

function mergeById(prev: Message[], fresh: Message[]) {
  if (!fresh.length) return prev;
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of fresh) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

type Op = { action: TransitionAction; label: string; confirm?: { title: string; message: string } };

const OPS: Record<TalkStatus, Op[]> = {
  active: [
    {
      action: 'end',
      label: '完结笔谈',
      confirm: { title: '完结这场笔谈？', message: '完结后所有人都不能再发言，笔谈会完整保留。确定完结这场笔谈？' },
    },
  ],
  ended: [
    { action: 'reopen', label: '重新开启' },
    {
      action: 'archive',
      label: '存档',
      confirm: { title: '存档这场笔谈？', message: '存档后它会从默认列表收起，可在「已存档」里找到，随时可以取消存档。' },
    },
  ],
  archived: [{ action: 'unarchive', label: '取消存档' }],
};

const OP_DONE: Record<TransitionAction, string> = {
  end: '笔谈已完结',
  reopen: '笔谈已重新开启',
  archive: '笔谈已存档',
  unarchive: '已取消存档',
};

const READONLY_TEXT: Record<Exclude<TalkStatus, 'active'>, string> = {
  ended: '这场笔谈已完结，仅可回看。',
  archived: '这场笔谈已存档。',
};

function TalkMissing() {
  return (
    <div className="page page-enter">
      <div className="page-center">
        <p className="nf-mark">404</p>
        <h1 className="page-title">无权访问或不存在。</h1>
        <Link to="/talks" className="btn btn-primary">
          回到笔谈列表
        </Link>
      </div>
    </div>
  );
}

function Roster({ people }: { people: Participant[] }) {
  return (
    <ul className="talk-roster" aria-label="参与者名单">
      {people.map((p) => (
        <li key={p.user_id} className="person">
          <Avatar avatar={p.avatar} name={p.nickname} size={40} decorative />
          <div className="person-who">
            <span className="person-name">
              {p.nickname}
              {p.is_initiator && <span className="talk-tag is-mine">发起人</span>}
            </span>
            <span className="person-sub">@{p.username}</span>
            <BadgeRow badges={p.badges} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function SnapshotContent({ part }: { part: SnapshotPart }) {
  return (
    <>
      {part.quote && <QuoteBlock text={part.quote} />}
      {part.content ? <NoteBody source={part.content} /> : <p className="reading-empty">（只有标题）</p>}
    </>
  );
}

function CitationDesk({ talk }: { talk: TalkData }) {
  const [open, setOpen] = useState(true);
  const { snapshot } = talk;
  return (
    <section className={`desk${open ? '' : ' is-closed'}`} aria-labelledby="desk-title">
      <div className="desk-head">
        <h2 id="desk-title" className="desk-eyebrow">
          锚定笔记
        </h2>
        <button type="button" className="text-btn desk-toggle" aria-expanded={open} aria-controls="desk-body" onClick={() => setOpen((o) => !o)}>
          {open ? '收起' : '展开'}
          <ChevronIcon />
        </button>
      </div>
      {!open && <p className="desk-folded">{snapshot.title}</p>}
      <div id="desk-body" className="desk-body" hidden={!open}>
        {snapshot.ancestors.length > 0 && (
          <div className="desk-ancestors">
            <p className="desk-label">随这场笔谈共享的上层提炼</p>
            {snapshot.ancestors.map((a, i) => (
              <details key={i} className="desk-ancestor">
                <summary>
                  <ChevronIcon />
                  <span className="desk-ancestor-title">{a.title}</span>
                </summary>
                <div className="desk-ancestor-body">
                  <SnapshotContent part={a} />
                </div>
              </details>
            ))}
          </div>
        )}
        <article className="desk-note">
          <h3 className="desk-title">{snapshot.title}</h3>
          <SnapshotContent part={snapshot} />
          <p className="desk-anchor">
            <time dateTime={snapshot.captured_at} title={fullTime(snapshot.captured_at)}>
              锚定于 {formatDate(snapshot.captured_at)} 的版本
            </time>
          </p>
        </article>
      </div>
    </section>
  );
}

export default function Talk() {
  const { id = '' } = useParams();
  const location = useLocation();
  const back = (location.state as { back?: string } | null)?.back ?? '/talks';
  const backLabel = back.startsWith('/notes') ? '笔记' : '笔谈';
  const toast = useToast();
  const badgeToast = useBadgeToast();
  const talkIdNum = /^\d+$/.test(id) ? Number(id) : null;
  useExplorerContent(`talks:${id}`, <TalksExplorer currentId={talkIdNum} />);

  const [state, setState] = useState<State>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [welcome, setWelcome] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [lost, setLost] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const [confirmOp, setConfirmOp] = useState<Op | null>(null);
  const [opBusy, setOpBusy] = useState(false);

  // 增量游标只随拉取推进：自己发送成功的那条不推进，否则会跳过中间他人的消息
  const cursor = useRef(0);
  const knownPeople = useRef<Set<number>>(new Set());
  const polling = useRef(false);
  const lostRef = useRef(false);
  const stick = useRef<'bottom' | null>(null);
  const olderBusy = useRef(false);
  const olderCtrl = useRef<AbortController | null>(null);
  const olderAnchor = useRef<{ id: number; top: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 讨论区是独立滚动容器（桌面右栏/移动卡片），贴底与未读判断都基于它
  const isNearBottom = () => {
    const el = scrollRef.current;
    return !el || el.scrollTop + el.clientHeight >= el.scrollHeight - NEAR_BOTTOM_PX;
  };
  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  useEffect(() => {
    setWelcome(false);
    setRosterOpen(false);
    setMessages([]);
    setPending([]);
    setHasOlder(false);
    setLoadingOlder(false);
    setOlderError(null);
    setLost(false);
    setUnseen(0);
    lostRef.current = false;
    cursor.current = 0;
    olderBusy.current = false;
    olderCtrl.current?.abort();
    olderCtrl.current = null;
    olderAnchor.current = null;
  }, [id]);

  const markRead = useCallback((talkId: number) => {
    markTalkRead(talkId)
      .then(() => refreshUnreadTalks())
      .catch(() => {});
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => (s.status === 'ready' && String(s.talk.id) === id ? s : { status: 'loading' }));
    Promise.all([getTalk(id, ctrl.signal), listLatestMessages(id, ctrl.signal)])
      .then(([talk, page]) => {
        const first = cursor.current === 0;
        cursor.current = lastIdOf(page.messages, 0);
        knownPeople.current = new Set(talk.participants.map((p) => p.user_id));
        setMessages(page.messages);
        setHasOlder(page.has_more);
        setPending((p) => p.filter((x) => !page.messages.some((m) => m.client_message_id === x.key)));
        setState({ status: 'ready', talk });
        if (talk.first_visit) setWelcome(true);
        if (first && page.messages.length) stick.current = 'bottom';
        markRead(talk.id);
      })
      .catch((e: ApiError) => {
        if (ctrl.signal.aborted) return;
        setState(e.status === 404 ? { status: 'missing' } : { status: 'error', message: e.message });
      });
    return () => ctrl.abort();
  }, [id, reload, markRead]);

  const talk = state.status === 'ready' ? state.talk : null;
  const talkId = talk?.id;

  const poll = useCallback(async () => {
    if (!talkId || polling.current || lostRef.current) return;
    polling.current = true;
    try {
      const page = await fetchSince(talkId, cursor.current);
      cursor.current = lastIdOf(page.messages, cursor.current);

      const joined = page.participants.filter((p) => !knownPeople.current.has(p.user_id));
      knownPeople.current = new Set(page.participants.map((p) => p.user_id));
      if (joined.length) toast(`${joined.length} 位读友加入了笔谈。`);

      const fromOthers = page.messages.filter((m) => !m.is_mine);
      if (fromOthers.length) {
        if (isNearBottom()) stick.current = 'bottom';
        else setUnseen((n) => n + fromOthers.length);
        if (document.visibilityState === 'visible') markRead(talkId);
      }
      setMessages((prev) => mergeById(prev, page.messages));
      setPending((p) => p.filter((x) => !page.messages.some((m) => m.client_message_id === x.key)));
      setState((s) =>
        s.status === 'ready' && s.talk.id === talkId ? { ...s, talk: { ...s.talk, status: page.status, participants: page.participants } } : s,
      );
    } catch (e) {
      if ((e as ApiError).status === 404) {
        lostRef.current = true;
        setLost(true);
      }
    } finally {
      polling.current = false;
    }
  }, [talkId, toast, markRead]);

  useEffect(() => {
    if (!talkId) return;
    const tick = () => {
      if (document.visibilityState === 'visible') poll();
    };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
  }, [talkId, poll]);

  useLayoutEffect(() => {
    if (stick.current !== 'bottom') return;
    stick.current = null;
    scrollToBottom();
  }, [messages, pending]);

  useLayoutEffect(() => {
    const anchor = olderAnchor.current;
    if (!anchor) return;
    olderAnchor.current = null;
    const el = document.querySelector<HTMLElement>(`[data-message-id="${anchor.id}"]`);
    const sc = scrollRef.current;
    if (el && sc) sc.scrollTop += el.getBoundingClientRect().top - anchor.top;
  }, [messages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!unseen || !el) return;
    const onScroll = () => {
      if (isNearBottom()) setUnseen(0);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [unseen]);

  if (state.status === 'missing') return <TalkMissing />;

  async function deliver(key: string, content: string) {
    if (!talkId) return;
    try {
      const { message, new_badges } = await sendMessage(talkId, content, key);
      setPending((p) => p.filter((x) => x.key !== key));
      setMessages((prev) => mergeById(prev, [message]));
      badgeToast(new_badges);
      poll();
    } catch (e) {
      const err = e as ApiError;
      setPending((p) => p.map((x) => (x.key === key ? { ...x, failed: err.message } : x)));
      if (err.status === 404) {
        lostRef.current = true;
        setLost(true);
      } else if (err.code === 'DISCUSSION_NOT_ACTIVE') poll();
    }
  }

  function send(text: string) {
    const content = text.trim();
    const key = randomKey();
    stick.current = 'bottom';
    setUnseen(0);
    setPending((p) => [...p, { key, content, at: new Date().toISOString(), failed: null }]);
    deliver(key, content);
  }

  function retry(key: string) {
    const item = pending.find((x) => x.key === key);
    if (!item) return;
    setPending((p) => p.map((x) => (x.key === key ? { ...x, failed: null } : x)));
    deliver(key, item.content);
  }

  async function loadOlder() {
    const first = messages[0];
    if (!talkId || !hasOlder || !first || olderBusy.current) return;
    const ctrl = new AbortController();
    olderCtrl.current?.abort();
    olderCtrl.current = ctrl;
    olderBusy.current = true;
    setLoadingOlder(true);
    setOlderError(null);
    const top = document.querySelector<HTMLElement>(`[data-message-id="${first.id}"]`)?.getBoundingClientRect().top;
    try {
      const page = await listMessagesBefore(talkId, first.id, ctrl.signal);
      stick.current = null;
      if (top !== undefined) olderAnchor.current = { id: first.id, top };
      setMessages((prev) => mergeById(prev, page.messages));
      setHasOlder(page.has_more);
    } catch (e) {
      if (!ctrl.signal.aborted) setOlderError((e as ApiError).message);
    } finally {
      if (olderCtrl.current === ctrl) {
        olderCtrl.current = null;
        olderBusy.current = false;
        setLoadingOlder(false);
      }
    }
  }

  async function runOp(op: Op) {
    if (!talkId) return;
    setOpBusy(true);
    try {
      const { status } = await transitionTalk(talkId, op.action);
      setState((s) => (s.status === 'ready' ? { ...s, talk: { ...s.talk, status } } : s));
      toast(OP_DONE[op.action]);
    } catch (e) {
      toast((e as ApiError).message);
    } finally {
      setOpBusy(false);
      setConfirmOp(null);
      poll();
    }
  }

  function invited(result: InviteResult) {
    setInviting(false);
    toast(`已邀请 ${result.invited.length} 位读友加入笔谈`);
    setReload((r) => r + 1);
  }

  function inviteFailed(err: ApiError) {
    setInviting(false);
    toast(err.message);
    if (err.code === 'DISCUSSION_NOT_FOUND') setState({ status: 'missing' });
    else setReload((r) => r + 1);
  }

  const readonlyText = lost ? '你已不在这次讨论中。' : talk && talk.status !== 'active' ? READONLY_TEXT[talk.status] : null;

  return (
    <div className="page page-enter talk-page">
      {state.status === 'loading' && (
        <div className="talk-single">
          <ReadingSkeleton />
        </div>
      )}
      {state.status === 'error' && (
        <div className="talk-single">
          <div className="notes-state" role="alert">
            <p>{state.message}</p>
            <button type="button" className="btn btn-ghost" onClick={() => setReload((n) => n + 1)}>
              重试
            </button>
          </div>
        </div>
      )}

      {talk && (
        <div className="talk-layout">
          <div className="talk-note">
            <div className="reading-bar">
              <Link to={back} className="back-link">
                <BackIcon />
                {backLabel}
              </Link>
            </div>

            <header className="talk-head">
              <h1 className="talk-title">关于『{talk.title}』</h1>
              <div className="talk-head-row">
                <button
                  type="button"
                  className="talk-people"
                  aria-expanded={rosterOpen}
                  aria-controls="talk-roster"
                  aria-label={`参与者名单（${talk.participants.length} 位）`}
                  onClick={() => setRosterOpen((o) => !o)}
                >
                  <AvatarGroup users={talk.participants} max={5} size={32} />
                  <span className="talk-people-count">{talk.participants.length} 位参与者</span>
                  <span className="talk-people-chev" aria-hidden="true">
                    <ChevronIcon />
                  </span>
                </button>
                {talk.is_initiator && (
                  <div className="talk-actions">
                    {talk.status === 'active' && (
                      <button type="button" className="btn btn-ghost" onClick={() => setInviting(true)}>
                        <PlusIcon />
                        邀请更多读友
                      </button>
                    )}
                    {OPS[talk.status].map((op) => (
                      <button key={op.action} type="button" className="btn btn-ghost" disabled={opBusy} onClick={() => (op.confirm ? setConfirmOp(op) : runOp(op))}>
                        {op.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div id="talk-roster" hidden={!rosterOpen}>
                <Roster people={talk.participants} />
              </div>
            </header>

            <CitationDesk talk={talk} />

            {talk.note_has_newer_version && (
              <p className="talk-hint is-weak">笔记已有新版本，本场笔谈基于 {formatDate(talk.snapshot.captured_at)} 的版本</p>
            )}

            {welcome && <p className="talk-hint">你被邀请参与这场笔谈。笔记与它的上层脉络就在一旁，大家聊到懂为止。</p>}
          </div>

          <aside className="chat-panel" aria-label="讨论">
            <header className="chat-head">
              <span className="chat-eyebrow">讨论</span>
              <span className="chat-head-side">
                {talk.status !== 'active' && <span className="pill">{STATUS_LABEL[talk.status]}</span>}
                <span className="chat-count">{talk.participants.length} 位参与者</span>
              </span>
            </header>
            <div className="chat-scroll" ref={scrollRef}>
              <Thread
                messages={messages}
                pending={pending}
                emptyText={talk.status === 'active' && !lost ? '笔谈已开始。从你此刻最真实的想法写起。' : '这场笔谈里还没有人发言。'}
                onRetry={retry}
                hasOlder={hasOlder}
                loadingOlder={loadingOlder}
                olderError={olderError}
                onLoadOlder={loadOlder}
              />
            </div>
            <div className="chat-dock">
              {unseen > 0 && (
                <button
                  type="button"
                  className="talk-unseen"
                  onClick={() => {
                    setUnseen(0);
                    scrollToBottom();
                  }}
                >
                  {unseen} 条新消息
                </button>
              )}
              {readonlyText ? (
                <p className="talk-readonly" role="status">
                  {readonlyText}
                </p>
              ) : (
                <Composer onSend={send} />
              )}
            </div>
          </aside>

          {talk.is_initiator && (
            <InviteDialog
              open={inviting}
              target={{
                kind: 'invite',
                talkId: talk.id,
                title: talk.title,
                layers: talk.layers,
                exclude: talk.participants.map((p) => p.user_id),
              }}
              onDone={invited}
              onFail={inviteFailed}
              onClose={() => setInviting(false)}
            />
          )}

          <ConfirmDialog
            open={confirmOp !== null}
            title={confirmOp?.confirm?.title ?? ''}
            message={confirmOp?.confirm?.message}
            confirmLabel={confirmOp?.label ?? ''}
            busy={opBusy}
            danger={confirmOp?.action === 'end'}
            onConfirm={() => confirmOp && runOp(confirmOp)}
            onCancel={() => setConfirmOp(null)}
          />
        </div>
      )}
    </div>
  );
}
