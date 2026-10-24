import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { type InviteResult } from '../api/discussions';
import { deleteNote, getNote, listTree, moveNote, type Note, type NoteRef, type TreeItem } from '../api/notes';
import { TAGS_CHANGED, type NoteTag } from '../api/tags';
import { useAuth } from '../auth/AuthContext';
import ConfirmDialog from '../components/ConfirmDialog';
import { useExplorerContent } from '../components/Explorer';
import { BackIcon, MountIcon, PenIcon, RefineIcon, SupplementIcon, TrashIcon, UnmountIcon } from '../components/Icons';
import { NoteBody, QuoteBlock } from '../components/NoteContent';
import { KindBadge } from '../components/NoteKind';
import NotesExplorer from '../components/NotesExplorer';
import NoteTalkPanel from '../components/NoteTalkPanel';
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
  const refreshedTags = useRef<NoteTag[] | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    refreshedTags.current = null;
    setThread(null);
    setState((s) => (s.status === 'ready' && String(s.note.id) === id ? s : { status: 'loading' }));
    getNote(id, ctrl.signal)
      .then(async (note) => {
        if (ctrl.signal.aborted) return;
        setState({ status: 'ready', note: { ...note, tags: refreshedTags.current ?? note.tags } });
        saveLastViewed(note.id);
        expandNodes(userId, note.ancestors.map((a) => a.id));
        try {
          const items = await listTree(ctrl.signal);
          if (!ctrl.signal.aborted) setThread(items);
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
    let ctrl: AbortController | undefined;
    const refresh = () => {
      ctrl?.abort();
      ctrl = new AbortController();
      const { signal } = ctrl;
      getNote(id, signal)
        .then((note) => {
          if (!signal.aborted) {
            refreshedTags.current = note.tags;
            setState((s) =>
              s.status === 'ready' && s.note.id === note.id
                ? { ...s, note: { ...s.note, tags: note.tags } }
                : s,
            );
          }
        })
        .catch(() => {});
    };
    window.addEventListener(TAGS_CHANGED, refresh);
    return () => {
      ctrl?.abort();
      window.removeEventListener(TAGS_CHANGED, refresh);
    };
  }, [id]);

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
    return <NoteEditor key={location.key} refine={{ id: note.id, title: note.title, book: note.book }} />;
  }

  function talkDone(result: InviteResult) {
    const n = result.invited.length;
    setInviting(false);
    toast(`已邀请 ${n} 位读友加入讨论`);
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
    ...(note?.discussion ? ['这场讨论会完整保留，读友仍可回看；进行中的讨论可继续发言。'] : []),
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
      <div className="reading-workspace">
        <div className="reading-document">
          <div className="reading-bar">
            <nav className="reading-location" aria-label="笔记路径">
              <Link to={back} className="back-link">
                <BackIcon />
                笔记
              </Link>
              {note && (
                <>
                  <span className="reading-location-divider" aria-hidden="true">/</span>
                  <span className="reading-location-current" aria-current="page" title={note.title}>{note.title}</span>
                </>
              )}
            </nav>
            {note && (
              <Link to={`/notes/${id}/edit`} state={{ fromView: true, back }} className="btn btn-ghost">
                <PenIcon />
                编辑
              </Link>
            )}
          </div>

          <div className="reading-canvas">
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
                {(note.ancestors.length > 0 || childCount > 0) && (
                  <NoteThread
                    ancestors={note.ancestors}
                    current={{ id: note.id, title: note.title }}
                    tree={thread ?? []}
                    back={back}
                    cap={cap}
                  />
                )}
                <article className={`reading-card${fresh ? ' is-fresh' : ''}`}>
                  <header className="reading-head">
                    <div className="reading-topmeta">
                      <KindBadge kind={note.kind} />
                      {note.book && (
                        <Link to={`/notes?book=${note.book.id}`} className="reading-book" title="查看这本书的全部笔记">
                          《{note.book.title}》
                        </Link>
                      )}
                      <span className="reading-depth">{note.ancestors.length === 0 ? '顶层笔记' : `第 ${note.ancestors.length + 1} 层`}</span>
                      {childCount > 0 && <span className="reading-children">{childCount} 条子笔记</span>}
                      <TimeMeta note={note} />
                    </div>
                    <h1 className="reading-title">{note.title}</h1>
                  </header>
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

                <section className="reading-grow" aria-labelledby="grow-title">
                  <h2 id="grow-title" className="reading-section-title">继续生长</h2>
                  <p className="context-hint">{childCount > 0 ? `已有 ${childCount} 条下层笔记，继续连接新的想法。` : '连接更抽象的理解，或补充具体的线索。'}</p>
                  <div className="grow">
                    <button type="button" className="grow-card" onClick={startRefine}>
                      <RefineIcon />
                      <span className="grow-verb">向上提炼</span>
                      <span className="grow-desc">写下更抽象的理解</span>
                    </button>
                    <Link to={`/notes/new?under=${note.id}`} state={{ back }} className="grow-card">
                      <SupplementIcon />
                      <span className="grow-verb">向下补充</span>
                      <span className="grow-desc">补充更具体的线索</span>
                    </Link>
                  </div>
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
                  </div>
                </section>

                <details className="reading-management">
                  <summary>笔记管理</summary>
                  <button type="button" className="text-btn is-danger" onClick={() => setConfirm({ kind: 'delete' })}>
                    <TrashIcon />
                    删除这条笔记
                  </button>
                </details>
              </>
            )}
          </div>
        </div>

        {note && (
          <aside className="reading-context" aria-label="读友讨论">
            <NoteTalkPanel
              talk={note.discussion ?? null}
              here={location.pathname}
              onStart={() => setInviting(true)}
              onInvite={() => setInviting(true)}
            />
          </aside>
        )}
      </div>

      {note && (
        <>
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
