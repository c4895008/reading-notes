import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { STATUS_LABEL, type InviteResult, type TalkSummary } from '../api/discussions';
import { deleteNote, getNote, listTree, moveNote, type Note, type NoteRef, type TreeItem } from '../api/notes';
import { useAuth } from '../auth/AuthContext';
import AvatarGroup from '../components/AvatarGroup';
import ConfirmDialog from '../components/ConfirmDialog';
import { useExplorerContent } from '../components/Explorer';
import { BackIcon, MountIcon, PenIcon, RefineIcon, SupplementIcon, TalkIcon, TrashIcon, UnmountIcon } from '../components/Icons';
import { NoteBody, QuoteBlock } from '../components/NoteContent';
import NotesExplorer from '../components/NotesExplorer';
import NoteThread from '../components/NoteThread';
import InviteDialog, { type InviteTarget } from '../components/InviteDialog';
import NotePicker from '../components/NotePicker';
import TagEditor from '../components/TagEditor';
import { useBadgeToast, useToast } from '../components/Toast';
import { formatTime, fullTime } from '../lib/time';
import { expandNodes, saveLastViewed } from '../lib/treeState';
import NoteEditor from './NoteEditor';
import './Page.css';
import './Notes.css';

type State = { status: 'loading' } | { status: 'missing' } | { status: 'error'; message: string } | { status: 'ready'; note: Note };
type NavState = { back?: string; fresh?: boolean; compose?: 'refine' } | null;
type Confirm = { kind: 'mount'; parent: NoteRef } | { kind: 'unmount' } | { kind: 'delete' } | null;

const FRESH_MS = 1600;

// listTree 是先序扁平序列：源笔记之后、深度不超过它的连续节点就是它的整棵子树
function subtree(items: TreeItem[], id: number, depth: number) {
  const start = items.findIndex((n) => n.id === id);
  if (start < 0) return [];
  const out: TreeItem[] = [];
  for (let i = start + 1; i < items.length && items[i].depth > depth; i++) out.push(items[i]);
  return out;
}

function useMedia(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatch(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return match;
}

export function NoteMissing() {
  return (
    <div className="page page-enter">
      <div className="page-center">
        <p className="nf-mark">404</p>
        <h1 className="page-title">无权访问或不存在。</h1>
        <Link to="/notes" className="btn btn-primary">
          回到笔记列表
        </Link>
      </div>
    </div>
  );
}

export function ReadingSkeleton() {
  return (
    <div className="reading-skeleton" aria-hidden="true">
      <span className="sk sk-heading" />
      <span className="sk sk-line is-short" />
      <span className="sk sk-block" />
      <span className="sk sk-line" />
      <span className="sk sk-line" />
      <span className="sk sk-line is-short" />
    </div>
  );
}

function TimeMeta({ note }: { note: Note }) {
  const edited = note.updated_at !== note.created_at;
  return (
    <p className="reading-meta">
      <time dateTime={note.created_at} title={fullTime(note.created_at)}>
        写于 {formatTime(note.created_at)}
      </time>
      {edited && (
        <>
          <span aria-hidden="true"> · </span>
          <time dateTime={note.updated_at} title={fullTime(note.updated_at)}>
            更新于 {formatTime(note.updated_at)}
          </time>
        </>
      )}
    </p>
  );
}

function TalkSection({ talk, here, onStart, onInvite }: { talk: TalkSummary | null; here: string; onStart: () => void; onInvite: () => void }) {
  return (
    <section className="reading-section" aria-labelledby="talk-title">
      <h2 id="talk-title" className="reading-section-title">
        这条笔记的笔谈
      </h2>
      {talk ? (
        <div className="note-talk">
          <Link to={`/talks/${talk.id}`} state={{ back: here }} className="note-talk-card">
            <AvatarGroup users={talk.participants} max={4} size={32} />
            <span className="note-talk-main">
              <span className="note-talk-open">
                <TalkIcon size={18} />
                打开笔谈
              </span>
              <span className="note-talk-meta">
                {talk.participants.length} 位参与者 ·{' '}
                {talk.last_message_at ? `最近发言 ${formatTime(talk.last_message_at)}` : `${formatTime(talk.created_at)} 发起，尚无发言`}
                {talk.unread > 0 && <strong className="note-talk-unread"> · {talk.unread} 条未读</strong>}
              </span>
            </span>
            {talk.status !== 'active' && <span className="talk-tag">{STATUS_LABEL[talk.status]}</span>}
          </Link>
          {talk.status === 'active' && (
            <button type="button" className="text-btn" onClick={onInvite}>
              邀请更多读友
            </button>
          )}
        </div>
      ) : (
        <div className="note-talk-empty">
          <p>还没有就这条笔记聊过。邀请读友，把想法聊透。</p>
          <button type="button" className="btn btn-ghost" onClick={onStart}>
            <TalkIcon size={18} />
            发起笔谈
          </button>
        </div>
      )}
    </section>
  );
}

function talkTarget(note: Note): InviteTarget {
  const talk = note.discussion;
  return talk
    ? { kind: 'invite', talkId: talk.id, title: talk.title, layers: talk.layers, exclude: talk.participants.map((p) => p.user_id) }
    : { kind: 'start', noteId: note.id, title: note.title, layers: note.ancestors.length };
}

export default function NoteView() {
  const { id = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const navState = location.state as NavState;
  const back = navState?.back ?? '/notes';
  const { user } = useAuth();
  const userId = user!.user_id;
  const toast = useToast();
  const badgeToast = useBadgeToast();

  useExplorerContent(`notes:${id}`, <NotesExplorer currentId={/^\d+$/.test(id) ? Number(id) : null} />);

  const [state, setState] = useState<State>({ status: 'loading' });
  const [thread, setThread] = useState<TreeItem[] | null>(null);
  const [reload, setReload] = useState(0);
  const [fresh, setFresh] = useState(false);
  const narrow = useMedia('(max-width: 600px)');
  const cap = narrow ? 2 : 4;
  const [picking, setPicking] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    setThread(null);
    setState((s) => (s.status === 'ready' && String(s.note.id) === id ? s : { status: 'loading' }));
    getNote(id, ctrl.signal)
      .then(async (note) => {
        setState({ status: 'ready', note });
        saveLastViewed(note.id);
        expandNodes(userId, note.ancestors.map((a) => a.id));
        try {
          const items = await listTree(ctrl.signal);
          if (!ctrl.signal.aborted) setThread(subtree(items, note.id, note.ancestors.length));
        } catch {
          if (!ctrl.signal.aborted) setThread([]);
        }
      })
      .catch((e: ApiError) => {
        if (ctrl.signal.aborted) return;
        setState(e.status === 404 ? { status: 'missing' } : { status: 'error', message: e.message });
      });
    return () => ctrl.abort();
  }, [id, reload, userId]);

  useEffect(() => {
    if (!navState?.fresh) return;
    setFresh(true);
    const t = setTimeout(() => setFresh(false), FRESH_MS);
    return () => clearTimeout(t);
  }, [location.key, navState?.fresh]);

  const fail = useCallback(
    (e: unknown) => {
      const err = e as ApiError;
      setBusy(false);
      setConfirm(null);
      setPicking(false);
      if (err.code === 'NOTE_NOT_FOUND') {
        setState({ status: 'missing' });
        return;
      }
      toast(err.message);
      setReload((n) => n + 1);
    },
    [toast],
  );

  if (state.status === 'missing') return <NoteMissing />;

  const note = state.status === 'ready' ? state.note : null;

  if (note && navState?.compose === 'refine') {
    return <NoteEditor key={location.key} refine={{ id: note.id, title: note.title }} />;
  }

  function talkDone(result: InviteResult) {
    const n = result.invited.length;
    setInviting(false);
    toast(`已邀请 ${n} 位读友加入笔谈`);
    badgeToast(result.new_badges);
    if (note?.discussion) setReload((r) => r + 1);
    else navigate(`/talks/${result.discussion_id}`, { state: { back: location.pathname } });
  }

  function talkFailed(err: ApiError) {
    setInviting(false);
    toast(err.message);
    if (err.code === 'DISCUSSION_EXISTS') {
      navigate(`/talks/${err.details?.discussion_id}`, { state: { back: location.pathname } });
      return;
    }
    setReload((r) => r + 1);
  }

  function startRefine() {
    navigate(location.pathname, { state: { back, compose: 'refine' } });
  }

  async function runConfirm() {
    if (!note || !confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === 'delete') {
        const { promoted_children: n } = await deleteNote(note.id);
        toast(n > 0 ? `已删除，${n} 条子笔记已移至顶层` : '已删除');
        navigate('/notes', { replace: true });
        return;
      }
      const parentId = confirm.kind === 'mount' ? confirm.parent.id : null;
      await moveNote(note.id, parentId);
      if (parentId) expandNodes(userId, [parentId]);
      toast(parentId ? '已调整结构' : '已成为顶层笔记');
      setBusy(false);
      setConfirm(null);
      setPicking(false);
      setReload((n) => n + 1);
    } catch (e) {
      fail(e);
    }
  }

  const childCount = note?.children.length ?? 0;
  const deleteImpacts = [
    ...(childCount > 0 ? [`它的 ${childCount} 条子笔记将保留并成为顶层笔记。`] : []),
    ...(note?.discussion ? ['这场笔谈会完整保留，读友仍可回看；进行中的笔谈可继续发言。'] : []),
  ];
  const confirmProps =
    note && confirm?.kind === 'mount'
      ? {
          title: `将「${note.title}」挂到「${confirm.parent.title}」之下？`,
          message: `它会成为「${confirm.parent.title}」的最后一条下层笔记，原有的下层笔记随它一起移动。`,
          confirmLabel: '挂载',
        }
      : note && confirm?.kind === 'unmount'
        ? {
            title: '解除父级？',
            message: `解除后「${note.title}」将成为顶层笔记，它的子级不受影响。`,
            confirmLabel: '解除',
          }
        : note && confirm?.kind === 'delete'
          ? {
              title: '删除这条笔记？',
              message: deleteImpacts.length ? `${deleteImpacts.join('')}删除后不可恢复。` : `删除后不可恢复。确定删除「${note.title}」？`,
              confirmLabel: '删除',
              danger: true,
            }
          : null;

  return (
    <div className="page page-enter reading">
      <div className="reading-bar">
        <Link to={back} className="back-link">
          <BackIcon />
          笔记
        </Link>
        {note && (
          <Link to={`/notes/${id}/edit`} state={{ fromView: true, back }} className="btn btn-ghost">
            <PenIcon />
            编辑
          </Link>
        )}
      </div>

      {state.status === 'loading' && <ReadingSkeleton />}

      {state.status === 'error' && (
        <div className="notes-state" role="alert">
          <p>{state.message}</p>
          <button type="button" className="btn btn-ghost" onClick={() => setReload((n) => n + 1)}>
            重试
          </button>
        </div>
      )}

      {note && (
        <>
          <NoteThread
            ancestors={note.ancestors}
            descendants={thread ?? []}
            back={back}
            cap={cap}
            addChild={
              <Link to={`/notes/new?under=${note.id}`} state={{ back }} className="thread-add">
                在它之下补充一条更具体的笔记
              </Link>
            }
          >
            <article className={`reading-card${fresh ? ' is-fresh' : ''}`}>
              <div className="reading-topmeta">
                {note.discussion && (
                  <span className={`pill${note.discussion.status === 'active' ? ' pill-accent' : ''}`}>
                    {STATUS_LABEL[note.discussion.status]}
                  </span>
                )}
                <TimeMeta note={note} />
              </div>
              <h1 className="reading-title">{note.title}</h1>
              <TagEditor
                noteId={note.id}
                tags={note.tags}
                onChange={(tags) => setState((s) => (s.status === 'ready' ? { status: 'ready', note: { ...s.note, tags } } : s))}
              />
              {note.quote && <QuoteBlock text={note.quote} />}
              {note.content ? (
                <NoteBody source={note.content} />
              ) : (
                <p className="reading-empty">
                  还没有写下想法。
                  <Link to={`/notes/${id}/edit`} state={{ fromView: true, back }}>
                    补上几句
                  </Link>
                </p>
              )}
            </article>
          </NoteThread>

          <section className="grow" aria-label="让它生长">
            <button type="button" className="grow-card" onClick={startRefine}>
              <RefineIcon />
              <span className="grow-verb">向上提炼</span>
              <span className="grow-desc">写一条更抽象的笔记，把它收在下面。</span>
            </button>
            <Link to={`/notes/new?under=${note.id}`} state={{ back }} className="grow-card">
              <SupplementIcon />
              <span className="grow-verb">向下补充</span>
              <span className="grow-desc">在它之下补充一条更具体的笔记。</span>
            </Link>
          </section>

          <TalkSection
            talk={note.discussion ?? null}
            here={location.pathname}
            onStart={() => setInviting(true)}
            onInvite={() => setInviting(true)}
          />

          <div className="reading-actions">
            <button type="button" className="text-btn" onClick={() => setPicking(true)}>
              <MountIcon />
              {note.parent_id ? '更换父笔记' : '挂载父笔记'}
            </button>
            {note.parent_id && (
              <button type="button" className="text-btn" onClick={() => setConfirm({ kind: 'unmount' })}>
                <UnmountIcon />
                解除父级
              </button>
            )}
            <button type="button" className="text-btn is-danger" onClick={() => setConfirm({ kind: 'delete' })}>
              <TrashIcon />
              删除
            </button>
          </div>

          <NotePicker
            open={picking}
            source={{ id: note.id, title: note.title }}
            currentParentId={note.parent_id}
            onPick={(parent) => setConfirm({ kind: 'mount', parent })}
            onClose={() => setPicking(false)}
          />

          <InviteDialog
            open={inviting}
            target={talkTarget(note)}
            onDone={talkDone}
            onFail={talkFailed}
            onClose={() => setInviting(false)}
          />
        </>
      )}

      <ConfirmDialog
        open={Boolean(confirmProps)}
        title={confirmProps?.title ?? ''}
        message={confirmProps?.message}
        confirmLabel={confirmProps?.confirmLabel ?? ''}
        danger={confirmProps?.danger}
        busy={busy}
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
