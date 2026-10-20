import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { listNotes, listTree, type NoteRef, type NoteSummary, type TreeItem } from '../api/notes';
import { listTags, type Tag } from '../api/tags';
import { useAuth } from '../auth/AuthContext';
import { PlusIcon, SearchIcon, XIcon } from '../components/Icons';
import NoteTreeView, { TREE_COLLAPSE_OVER } from '../components/NoteTree';
import { formatTime, fullTime } from '../lib/time';
import { loadCollapsed, loadLastViewed, loadView, saveCollapsed, saveView, type NotesView } from '../lib/treeState';
import './Page.css';
import './Notes.css';

const DEBOUNCE_MS = 250;

type ListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: NoteSummary[]; page: number; hasMore: boolean; q: string };

type TreeState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; items: TreeItem[] };

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

function Excerpt({ note }: { note: NoteSummary }) {
  if (note.excerpt_source === 'none') return <p className="note-excerpt is-empty">（只有标题）</p>;
  return (
    <p className="note-excerpt">
      {note.excerpt_source === 'quote' && <span className="note-excerpt-tag">引：</span>}
      {note.excerpt}
    </p>
  );
}

function NotePath({ path }: { path: NoteRef[] }) {
  return (
    <p className="note-path">
      {path.length === 0 ? '顶层笔记' : path.map((p) => p.title).join(' / ')}
    </p>
  );
}

function SkeletonList() {
  return (
    <ul className="note-list" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="note-item is-skeleton">
          <span className="sk sk-title" />
          <span className="sk sk-line" />
          <span className="sk sk-line is-short" />
        </li>
      ))}
    </ul>
  );
}

function SkeletonTree() {
  return (
    <ul className="tree" aria-hidden="true">
      {[0, 1, 2, 1, 0].map((d, i) => (
        <li key={i} className="tree-row is-skeleton" style={{ '--depth': d } as CSSProperties}>
          <span className="tree-indent" />
          <span className="sk sk-line" style={{ width: `${60 - d * 10}%` }} />
        </li>
      ))}
    </ul>
  );
}

function EmptyNotes() {
  return (
    <div className="notes-empty">
      <p className="notes-eyebrow">你的笔记</p>
      <p className="notes-empty-text">还没有笔记。读到有触动的地方，就摘下引文、写下想法。</p>
      <Link to="/notes/new" className="btn btn-primary">
        写第一条笔记
      </Link>
    </div>
  );
}

function Retry({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="notes-state" role="alert">
      <p>{message}</p>
      <button type="button" className="btn btn-ghost" onClick={onRetry}>
        重试
      </button>
    </div>
  );
}

function ListResults({ q, tag, back, onEmpty }: { q: string; tag: number | null; back: string; onEmpty: (empty: boolean) => void }) {
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const moreCtrl = useRef<AbortController | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    moreCtrl.current?.abort();
    setState((s) => (s.status === 'error' ? { status: 'loading' } : s));
    setBusy(true);
    setMoreError(null);
    listNotes({ q, tag: tag ?? undefined }, ctrl.signal)
      .then((data) => {
        setState({ status: 'ready', items: data.items, page: 1, hasMore: data.has_more, q });
        if (!q) onEmpty(data.items.length === 0);
      })
      .catch((e: ApiError) => {
        if (!ctrl.signal.aborted) setState({ status: 'error', message: e.message });
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setBusy(false);
      });
    return () => ctrl.abort();
  }, [q, tag, reload, onEmpty]);

  async function loadMore() {
    if (state.status !== 'ready') return;
    const ctrl = new AbortController();
    moreCtrl.current = ctrl;
    setBusy(true);
    setMoreError(null);
    try {
      const data = await listNotes({ q: state.q, tag: tag ?? undefined, page: state.page + 1 }, ctrl.signal);
      setState((s) => {
        if (s.status !== 'ready' || s.q !== state.q) return s;
        const seen = new Set(s.items.map((n) => n.id));
        return { ...s, items: [...s.items, ...data.items.filter((n) => !seen.has(n.id))], page: data.page, hasMore: data.has_more };
      });
    } catch (e) {
      if (!ctrl.signal.aborted) setMoreError((e as ApiError).message);
    } finally {
      if (!ctrl.signal.aborted) setBusy(false);
    }
  }

  if (state.status === 'loading') return <SkeletonList />;
  if (state.status === 'error') return <Retry message={state.message} onRetry={() => setReload((n) => n + 1)} />;
  if (!state.q && state.items.length === 0) {
    return tag ? (
      <div className="notes-state">
        <p>这个标签下还没有笔记。</p>
      </div>
    ) : (
      <EmptyNotes />
    );
  }
  if (state.items.length === 0) {
    return (
      <div className="notes-state">
        <p>没有找到包含「{state.q}」的笔记。搜索范围：你的笔记标题、引文与正文。</p>
      </div>
    );
  }

  return (
    <>
      <ul className="note-list" aria-busy={busy} data-stale={state.q !== q ? '' : undefined}>
        {state.items.map((note) => (
          <li key={note.id}>
            <Link to={`/notes/${note.id}`} state={{ back }} className="note-item">
              <span className="note-title">{note.title}</span>
              <span className="note-meta">
                {note.discussion_status && (
                  <span className={`pill${note.discussion_status === 'active' ? ' pill-accent' : ''}`}>
                    {note.discussion_status === 'active' ? '笔谈中' : '已完结'}
                  </span>
                )}
                {note.depth > 0 && <span className="pill">第 {note.depth + 1} 层</span>}
                {note.tags.map((t) => (
                  <span key={t.id} className="pill">
                    {t.name}
                  </span>
                ))}
                <time dateTime={note.updated_at} title={`最近更新 ${fullTime(note.updated_at)}`}>
                  {formatTime(note.updated_at)}
                </time>
              </span>
              {note.path && <NotePath path={note.path} />}
              <Excerpt note={note} />
            </Link>
          </li>
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
  );
}

function NoteTree({ userId, onEmpty }: { userId: number; onEmpty: (empty: boolean) => void }) {
  const [state, setState] = useState<TreeState>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<number> | null>(() => loadCollapsed(userId));
  const narrow = useMedia('(max-width: 600px)');
  const cap = narrow ? 3 : 6;
  const current = useMemo(() => loadLastViewed(), []);

  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => (s.status === 'error' ? { status: 'loading' } : s));
    listTree(ctrl.signal)
      .then((items) => {
        setState({ status: 'ready', items });
        onEmpty(items.length === 0);
        setCollapsed((c) => {
          if (c) return c;
          // 从未记录过折叠态：默认全展开，节点过多时折叠顶层
          const initial = new Set(
            items.length > TREE_COLLAPSE_OVER ? items.filter((n) => n.depth === 0 && n.child_count > 0).map((n) => n.id) : [],
          );
          saveCollapsed(userId, initial);
          return initial;
        });
      })
      .catch((e: ApiError) => {
        if (!ctrl.signal.aborted) setState({ status: 'error', message: e.message });
      });
    return () => ctrl.abort();
  }, [reload, userId, onEmpty]);

  function toggle(id: number) {
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveCollapsed(userId, next);
      return next;
    });
  }

  if (state.status === 'error') return <Retry message={state.message} onRetry={() => setReload((n) => n + 1)} />;
  if (state.status === 'loading' || !collapsed) return <SkeletonTree />;
  if (state.items.length === 0) return <EmptyNotes />;

  return <NoteTreeView items={state.items} collapsed={collapsed} onToggle={toggle} currentId={current} back="/notes" cap={cap} />;
}

export default function NotesList() {
  const { user } = useAuth();
  const userId = user!.user_id;
  const [params, setParams] = useSearchParams();
  const q = params.get('q')?.trim() ?? '';
  const tagParam = params.get('tag');
  const tagId = tagParam && /^[1-9]\d*$/.test(tagParam) ? Number(tagParam) : null;
  const [input, setInput] = useState(q);
  const [view, setView] = useState<NotesView>(() => loadView(userId));
  const [empty, setEmpty] = useState(false);
  const [allTags, setAllTags] = useState<Tag[]>([]);

  useEffect(() => {
    const ctrl = new AbortController();
    listTags(ctrl.signal)
      .then(setAllTags)
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    const next = input.trim();
    if (next === q) return;
    const t = setTimeout(() => {
      const merged = new URLSearchParams(params);
      if (next) merged.set('q', next);
      else merged.delete('q');
      setParams(merged, { replace: true });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, q]);

  function choose(next: NotesView) {
    setView(next);
    saveView(userId, next);
  }

  function clearTag() {
    const merged = new URLSearchParams(params);
    merged.delete('tag');
    setParams(merged, { replace: true });
  }

  const activeTag = tagId !== null ? (allTags.find((t) => t.id === tagId) ?? null) : null;
  const backParams = new URLSearchParams();
  if (q) backParams.set('q', q);
  if (tagId !== null) backParams.set('tag', String(tagId));
  const backQuery = backParams.toString();
  const back = `/notes${backQuery ? `?${backQuery}` : ''}`;

  const showTools = !empty || Boolean(input.trim()) || Boolean(q) || tagId !== null;

  return (
    <div className="page page-enter">
      <header className="notes-head">
        <h1 className="page-title">写下的，都算数。</h1>
        <Link to="/notes/new" className="btn btn-primary">
          <PlusIcon />
          写笔记
        </Link>
      </header>

      {showTools && (
        <div className="notes-tools">
          <div className="notes-search" role="search">
            <SearchIcon />
            <input
              type="search"
              className="notes-search-input"
              placeholder="搜索标题、引文与正文"
              aria-label="搜索笔记"
              value={input}
              maxLength={100}
              onChange={(e) => setInput(e.target.value)}
            />
          </div>
          <div className="segmented" role="group" aria-label="切换视图">
            <button type="button" aria-pressed={view === 'list'} onClick={() => choose('list')}>
              列表
            </button>
            <button type="button" aria-pressed={view === 'tree'} onClick={() => choose('tree')}>
              结构
            </button>
          </div>
        </div>
      )}

      {tagId !== null && (
        <div className="notes-filter">
          <span className="pill pill-accent">
            标签 · {activeTag?.name ?? '…'}
            <button type="button" className="pill-x" aria-label="清除标签筛选" onClick={clearTag}>
              <XIcon size={12} />
            </button>
          </span>
        </div>
      )}

      {q || tagId !== null || view === 'list' ? (
        <ListResults q={q} tag={tagId} back={back} onEmpty={setEmpty} />
      ) : (
        <NoteTree userId={userId} onEmpty={setEmpty} />
      )}
    </div>
  );
}
