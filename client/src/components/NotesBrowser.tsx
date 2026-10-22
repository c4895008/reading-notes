import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { listNotes, listTree, type NoteRef, type NoteSummary, type TreeItem } from '../api/notes';
import { listTags, TAGS_CHANGED, type Tag } from '../api/tags';
import { useAuth } from '../auth/AuthContext';
import { formatTime, fullTime } from '../lib/time';
import { loadCollapsed, loadLastViewed, saveCollapsed, type NotesView } from '../lib/treeState';
import { BackIcon, ChevronIcon, ListIcon, PlusIcon, SearchIcon, TreeIcon } from './Icons';
import { KindBadge } from './NoteKind';
import NoteTreeView, { TREE_COLLAPSE_OVER } from './NoteTree';
import './NotesBrowser.css';
import '../pages/Notes.css';

const DEBOUNCE_MS = 250;
const ID_RE = /^[1-9]\d*$/;

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
  return <p className="note-path">{path.length === 0 ? '顶层笔记' : path.map((p) => p.title).join(' / ')}</p>;
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

type ListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: NoteSummary[]; total: number | null; pageSize: number; hasMore: boolean };

function pageNumbers(page: number, pages: number): (number | '…')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const wanted = new Set([1, 2, page - 1, page, page + 1, pages - 1, pages].filter((n) => n >= 1 && n <= pages));
  const nums = [...wanted].sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  let prev = 0;
  for (const n of nums) {
    if (prev && n - prev > 1) out.push('…');
    out.push(n);
    prev = n;
  }
  return out;
}

export default function NotesBrowser({ currentId = null }: { currentId?: number | null }) {
  const { user } = useAuth();
  const userId = user!.user_id;
  const location = useLocation();
  const [params, setParams] = useSearchParams();

  const q = params.get('q')?.trim() ?? '';
  const tagParam = params.get('tag');
  const tagId = tagParam && ID_RE.test(tagParam) ? Number(tagParam) : null;
  const pageParam = params.get('page');
  const page = pageParam && ID_RE.test(pageParam) ? Number(pageParam) : 1;
  const view: NotesView = params.get('view') === 'tree' && !q && tagId === null ? 'tree' : 'list';

  const [input, setInput] = useState(q);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [allCount, setAllCount] = useState<number | null>(null);
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const currentRef = useRef<HTMLAnchorElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);
  const topRef = useRef<HTMLDivElement>(null);

  const back = location.pathname + location.search;

  useEffect(() => {
    setInput(q);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [q]);

  useEffect(() => {
    const onTagsChanged = () => setReload((n) => n + 1);
    window.addEventListener(TAGS_CHANGED, onTagsChanged);
    return () => window.removeEventListener(TAGS_CHANGED, onTagsChanged);
  }, []);

  useEffect(() => {
    let ctrl: AbortController | null = null;
    const refresh = () => {
      ctrl?.abort();
      const next = new AbortController();
      ctrl = next;
      listTags(next.signal)
        .then((items) => {
          if (!next.signal.aborted) setTags(items);
        })
        .catch(() => {});
    };
    refresh();
    window.addEventListener(TAGS_CHANGED, refresh);
    return () => {
      window.removeEventListener(TAGS_CHANGED, refresh);
      ctrl?.abort();
    };
  }, []);

  useEffect(() => {
    const onTagsChanged = (event: Event) => {
      const deletedId = (event as CustomEvent<{ deletedId?: number }>).detail?.deletedId;
      if (deletedId !== tagId) return;
      const next = new URLSearchParams(params);
      next.delete('tag');
      next.delete('page');
      setParams(next, { replace: true });
    };
    window.addEventListener(TAGS_CHANGED, onTagsChanged);
    return () => window.removeEventListener(TAGS_CHANGED, onTagsChanged);
  }, [tagId, params, setParams]);

  useEffect(() => {
    if (view !== 'list') return;
    const ctrl = new AbortController();
    setState((s) => (s.status === 'error' ? { status: 'loading' } : s));
    listNotes({ q, tag: tagId ?? undefined, page }, ctrl.signal)
      .then((data) => {
        if (ctrl.signal.aborted) return;
        if (!q && tagId === null && page === 1) setAllCount(data.total);
        setState({ status: 'ready', items: data.items, total: data.total, pageSize: data.page_size, hasMore: data.has_more });
      })
      .catch((e: ApiError) => {
        if (!ctrl.signal.aborted) setState({ status: 'error', message: e.message });
      });
    return () => ctrl.abort();
  }, [q, tagId, page, view, reload]);

  useEffect(() => {
    scrolled.current = false;
  }, [currentId, view]);

  useEffect(() => {
    if (scrolled.current || !currentRef.current) return;
    scrolled.current = true;
    const rect = currentRef.current.getBoundingClientRect();
    const viewport = scrollRef.current?.getBoundingClientRect();
    const top = viewport?.top ?? 112;
    const bottom = viewport?.bottom ?? window.innerHeight - 72;
    if (rect.top < top || rect.bottom > bottom) {
      currentRef.current.scrollIntoView({ block: 'center' });
    }
  }, [state]);

  function search(value: string) {
    setInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      const next = value.trim();
      const merged = new URLSearchParams(params);
      if (next) merged.set('q', next);
      else merged.delete('q');
      merged.delete('page');
      setParams(merged, { replace: true });
    }, DEBOUNCE_MS);
  }

  function chooseTag(next: number | null) {
    const merged = new URLSearchParams(params);
    if (next === null) merged.delete('tag');
    else merged.set('tag', String(next));
    merged.delete('page');
    setParams(merged, { replace: true });
  }

  function chooseView(next: NotesView) {
    const merged = new URLSearchParams(params);
    if (next === 'tree') {
      merged.set('view', 'tree');
      merged.delete('q');
      merged.delete('tag');
      merged.delete('page');
    } else {
      merged.delete('view');
    }
    setParams(merged, { replace: true });
  }

  function setPage(next: number) {
    const merged = new URLSearchParams(params);
    if (next > 1) merged.set('page', String(next));
    else merged.delete('page');
    setParams(merged, { replace: true });
    scrollRef.current?.scrollTo({ top: 0 });
  }

  const total = state.status === 'ready' ? state.total : null;
  const hasMore = state.status === 'ready' ? state.hasMore : false;
  const pageSize = state.status === 'ready' ? state.pageSize : 20;
  const pages = total !== null ? Math.max(1, Math.ceil(total / pageSize)) : hasMore ? page + 1 : page;
  const headCount = view === 'tree' ? allCount : tagId === null && !q ? (total ?? allCount) : total;

  return (
    <div className="nb" ref={topRef}>
      <div className="nb-header">
        <div className="nb-head">
          <div className="nb-title">
            <h2 className="nb-heading">{view === 'tree' ? '结构总览' : tagId !== null ? (tags.find((t) => t.id === tagId)?.name ?? '全部笔记') : '全部笔记'}</h2>
            {headCount !== null && <span className="nb-count">{headCount}</span>}
          </div>
          <div className="nb-tools">
            <Link to="/notes/new" state={{ back }} className="icon-btn" aria-label="写笔记" title="写笔记">
              <PlusIcon size={16} />
            </Link>
            <div className="nb-view" role="group" aria-label="切换视图">
              <button
                type="button"
                className={view === 'list' ? 'is-active' : ''}
                aria-pressed={view === 'list'}
                aria-label="列表视图"
                title="列表视图"
                onClick={() => chooseView('list')}
              >
                <ListIcon size={16} />
              </button>
              <button
                type="button"
                className={view === 'tree' ? 'is-active' : ''}
                aria-pressed={view === 'tree'}
                aria-label="结构视图"
                title="结构视图"
                onClick={() => chooseView('tree')}
              >
                <TreeIcon size={16} />
              </button>
            </div>
          </div>
        </div>

        <label className="nb-search">
          <SearchIcon size={17} />
          <span className="visually-hidden">搜索笔记</span>
          <input
            type="search"
            value={input}
            maxLength={100}
            placeholder="搜索标题、引文与正文"
            onChange={(e) => search(e.target.value)}
          />
        </label>

        <div className="nb-pills" role="group" aria-label="按标签筛选">
          <button type="button" className={`nb-pill${tagId === null ? ' is-active' : ''}`} aria-pressed={tagId === null} onClick={() => chooseTag(null)}>
            #全部
            {allCount !== null && <span className="nb-pill-count">{allCount}</span>}
          </button>
          {tags.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`nb-pill${tagId === t.id ? ' is-active' : ''}`}
              aria-pressed={tagId === t.id}
              onClick={() => chooseTag(t.id)}
            >
              #{t.name}
              <span className="nb-pill-count">{t.note_count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="nb-scroll" ref={scrollRef}>
        {view === 'list' && <ListPane state={state} q={q} tagId={tagId} back={back} currentId={currentId} currentRef={currentRef} onRetry={() => setReload((n) => n + 1)} />}

        {view === 'tree' && <TreePane userId={userId} back={back} currentId={currentId} onCount={setAllCount} />}
      </div>

      {view === 'list' && state.status === 'ready' && (pages > 1 || total !== null) && (
        <nav className="nb-pagination" aria-label="笔记分页">
          <div className="nb-pages">
            <button type="button" className="nb-page" disabled={page <= 1} aria-label="上一页" onClick={() => setPage(page - 1)}>
              <BackIcon size={14} />
            </button>
            {pageNumbers(page, pages).map((n, i) =>
              n === '…' ? (
                <span key={`ellipsis-${i}`} className="nb-ellipsis" aria-hidden="true">
                  …
                </span>
              ) : (
                <button
                  key={n}
                  type="button"
                  className={`nb-page${n === page ? ' is-active' : ''}`}
                  aria-current={n === page ? 'page' : undefined}
                  onClick={() => setPage(n)}
                >
                  {n}
                </button>
              ),
            )}
            <button
              type="button"
              className="nb-page"
              disabled={total !== null ? page >= pages : !hasMore}
              aria-label="下一页"
              onClick={() => setPage(page + 1)}
            >
              <ChevronIcon size={14} />
            </button>
          </div>
          {total !== null && <span className="nb-total">共 {total} 条记录</span>}
        </nav>
      )}
    </div>
  );
}

function ListPane({
  state,
  q,
  tagId,
  back,
  currentId,
  currentRef,
  onRetry,
}: {
  state: ListState;
  q: string;
  tagId: number | null;
  back: string;
  currentId: number | null;
  currentRef: React.MutableRefObject<HTMLAnchorElement | null>;
  onRetry: () => void;
}) {
  if (state.status === 'loading') return <SkeletonList />;
  if (state.status === 'error') {
    return (
      <div className="notes-state" role="alert">
        <p>{state.message}</p>
        <button type="button" className="btn btn-ghost" onClick={onRetry}>
          重试
        </button>
      </div>
    );
  }
  if (state.items.length === 0) {
    if (tagId !== null) return <div className="notes-state"><p>这个标签下还没有笔记。</p></div>;
    if (q) return <div className="notes-state"><p>{`没有找到包含「${q}」的笔记。搜索范围：你的笔记标题、引文与正文。`}</p></div>;
    return <EmptyNotes />;
  }
  return (
    <ul className="note-list">
      {state.items.map((note) => (
        <li key={note.id}>
          <Link
            to={`/notes/${note.id}`}
            state={{ back }}
            ref={note.id === currentId ? currentRef : undefined}
            aria-current={note.id === currentId ? 'page' : undefined}
            className="note-item"
          >
            <span className="note-title">{note.title}</span>
            <span className="note-meta">
              <KindBadge kind={note.kind} />
              {note.discussion_status && (
                <span className={`pill${note.discussion_status === 'active' ? ' pill-accent' : ''}`}>
                  {note.discussion_status === 'active' ? '讨论中' : '已完结'}
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
  );
}

function TreePane({ userId, back, currentId, onCount }: { userId: number; back: string; currentId: number | null; onCount: (n: number) => void }) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; items: TreeItem[] }>({ status: 'loading' });
  const [collapsed, setCollapsed] = useState<Set<number> | null>(() => loadCollapsed(userId));
  const narrow = useMedia('(max-width: 600px)');
  const cap = narrow ? 3 : 6;
  const current = currentId ?? loadLastViewed();

  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => (s.status === 'error' ? { status: 'loading' } : s));
    listTree(ctrl.signal)
      .then((items) => {
        if (ctrl.signal.aborted) return;
        setState({ status: 'ready', items });
        onCount(items.length);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  function toggle(id: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveCollapsed(userId, next);
      return next;
    });
  }

  if (state.status === 'loading' || !collapsed) return <SkeletonTree />;
  if (state.status === 'error') {
    return (
      <div className="notes-state" role="alert">
        <p>{state.message}</p>
      </div>
    );
  }
  if (state.items.length === 0) return <EmptyNotes />;
  return <NoteTreeView items={state.items} collapsed={collapsed} onToggle={toggle} currentId={current} back={back} cap={cap} />;
}
