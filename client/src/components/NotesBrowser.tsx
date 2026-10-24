import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { listNotes, listTree, type DiscussionFilter, type NoteKind, type NoteRef, type NoteSummary, type TreeItem } from '../api/notes';
import { listTags, TAGS_CHANGED, type Tag } from '../api/tags';
import { useAuth } from '../auth/AuthContext';
import { fullTime, isoDate } from '../lib/time';
import { loadCollapsed, loadLastViewed, saveCollapsed, type NotesView } from '../lib/treeState';
import TagSwitcher from './TagSwitcher';
import {
  BackIcon,
  CheckCircleIcon,
  ChevronIcon,
  CommentIcon,
  ListIcon,
  PlusIcon,
  SearchIcon,
  TagIcon,
  TextIcon,
  TreeIcon,
} from './Icons';
import NoteFilters, { type FilterPatch, type FilterValue } from './NoteFilters';
import { KindBadge } from './NoteKind';
import NoteTreeView, { TREE_COLLAPSE_OVER } from './NoteTree';
import './NotesBrowser.css';
import '../pages/Notes.css';

const DEBOUNCE_MS = 250;
const ID_RE = /^[1-9]\d*$/;
const KINDS: NoteKind[] = ['viewpoint', 'question', 'summary'];
const DISCUSSIONS: DiscussionFilter[] = ['active', 'ended', 'none'];
// 切换视图或改动任一筛选时一并清理的参数
const FILTER_KEYS = ['q', 'tag', 'kind', 'discussion', 'sort'];

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

function NoteFoot({ note }: { note: NoteSummary }) {
  const status = note.discussion_status;
  return (
    <span className="note-foot">
      {note.child_count > 0 && (
        <span className="note-foot-chip">
          <TreeIcon size={14} />
          {note.child_count} 条子笔记
        </span>
      )}
      {note.content_length > 0 && (
        <span className="note-foot-stat">
          <TextIcon />
          {note.content_length.toLocaleString('en-US')} 字
        </span>
      )}
      {note.message_count > 0 && (
        <span className="note-foot-stat">
          <CommentIcon />
          {note.message_count} 发言
        </span>
      )}
      {note.tags.map((t) => (
        <span key={t.id} className="note-foot-tag">
          {t.name}
        </span>
      ))}
      {status === 'active' ? (
        <span className="note-foot-end is-active">
          <span className="note-foot-dot" aria-hidden="true" />
          讨论中
        </span>
      ) : status ? (
        <span className="note-foot-end is-ended">
          <CheckCircleIcon />
          讨论已完结
        </span>
      ) : (
        <span className="note-foot-end is-none" aria-hidden="true">
          <ChevronIcon size={14} />
        </span>
      )}
    </span>
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
  const kindParam = params.get('kind') as NoteKind | null;
  const kind = kindParam && KINDS.includes(kindParam) ? kindParam : null;
  const discussionParam = params.get('discussion') as DiscussionFilter | null;
  const discussion = discussionParam && DISCUSSIONS.includes(discussionParam) ? discussionParam : null;
  const sort = params.get('sort') === 'created' ? 'created' : 'updated';
  const filters: FilterValue = { kind, discussion, sort };
  const pageParam = params.get('page');
  const page = pageParam && ID_RE.test(pageParam) ? Number(pageParam) : 1;
  const filtered = !!q || tagId !== null || !!kind || !!discussion || sort !== 'updated';
  const view: NotesView = params.get('view') === 'tree' && !filtered ? 'tree' : 'list';

  const [input, setInput] = useState(q);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [allCount, setAllCount] = useState<number | null>(null);
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [tagsOpen, setTagsOpen] = useState(false);
  const currentRef = useRef<HTMLAnchorElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);
  const topRef = useRef<HTMLDivElement>(null);
  const pillsRef = useRef<HTMLDivElement>(null);

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
    listNotes(
      {
        q,
        tag: tagId ?? undefined,
        kind: kind ?? undefined,
        discussion: discussion ?? undefined,
        sort,
        page,
      },
      ctrl.signal,
    )
      .then((data) => {
        if (ctrl.signal.aborted) return;
        if (!filtered && page === 1) setAllCount(data.total);
        setState({ status: 'ready', items: data.items, total: data.total, pageSize: data.page_size, hasMore: data.has_more });
      })
      .catch((e: ApiError) => {
        if (!ctrl.signal.aborted) setState({ status: 'error', message: e.message });
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, tagId, kind, discussion, sort, page, view, reload]);

  useEffect(() => {
    const row = pillsRef.current;
    const pill = row?.querySelector<HTMLElement>(`[data-tag="${tagId ?? 'all'}"]`);
    if (!row || !pill) return;
    const left = pill.getBoundingClientRect().left - row.getBoundingClientRect().left + row.scrollLeft;
    if (left < row.scrollLeft || left + pill.offsetWidth > row.scrollLeft + row.clientWidth) {
      row.scrollTo({ left: Math.max(0, left - 24) });
    }
  }, [tagId, tags]);

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
    setTagsOpen(false);
    const merged = new URLSearchParams(params);
    if (next === null) merged.delete('tag');
    else merged.set('tag', String(next));
    merged.delete('page');
    merged.delete('view');
    setParams(merged, { replace: true });
  }

  function chooseView(next: NotesView) {
    const merged = new URLSearchParams(params);
    if (next === 'tree') {
      merged.set('view', 'tree');
      for (const key of FILTER_KEYS) merged.delete(key);
      merged.delete('page');
    } else {
      merged.delete('view');
    }
    setParams(merged, { replace: true });
  }

  function patchParams(patch: FilterPatch) {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === undefined) merged.delete(key);
      else merged.set(key, value);
    }
    merged.delete('page');
    merged.delete('view');
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
  const pageSize = state.status === 'ready' ? state.pageSize : 10;
  const pages = total !== null ? Math.max(1, Math.ceil(total / pageSize)) : hasMore ? page + 1 : page;
  const activeTag = tagId !== null ? tags?.find((t) => t.id === tagId) : undefined;
  const headCount = view === 'tree' ? allCount : filtered ? total : (total ?? allCount);

  return (
    <div className="nb" ref={topRef}>
      <div className="nb-header">
        <div className="nb-head">
          <div className="nb-title">
            <h2 className="nb-heading">{view === 'tree' ? '结构总览' : '全部笔记'}</h2>
            {headCount !== null && <span className="nb-count">{headCount}</span>}
          </div>
          <div className="nb-tools">
            <Link to="/notes/new" state={{ back }} className="icon-btn nb-tool" aria-label="写笔记" title="写笔记">
              <PlusIcon size={16} />
            </Link>
            <button
              type="button"
              className="icon-btn nb-tool"
              aria-label={view === 'tree' ? '切换到列表视图' : '切换到结构视图'}
              title={view === 'tree' ? '列表视图' : filtered ? '结构视图（将清除筛选）' : '结构视图'}
              onClick={() => chooseView(view === 'tree' ? 'list' : 'tree')}
            >
              {view === 'tree' ? <ListIcon size={16} /> : <TreeIcon size={16} />}
            </button>
            <NoteFilters value={filters} onChange={patchParams} />
            <button
              type="button"
              className={`icon-btn nb-tool${tagId !== null ? ' is-on' : ''}`}
              aria-haspopup="dialog"
              aria-label={activeTag ? `标签（当前：${activeTag.name}）` : '标签'}
              title="标签：筛选与管理"
              onClick={() => setTagsOpen(true)}
            >
              <TagIcon size={16} />
            </button>
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

        {tags && tags.length > 0 && (
          <div className="nb-pills" ref={pillsRef} role="group" aria-label="按标签筛选">
            <button
              type="button"
              data-tag="all"
              className={`nb-pill${tagId === null ? ' is-active' : ''}`}
              aria-pressed={tagId === null}
              onClick={() => chooseTag(null)}
            >
              #全部
              {allCount !== null && <span className="nb-pill-count">{allCount}</span>}
            </button>
            {tags.map((t) => (
              <button
                key={t.id}
                type="button"
                data-tag={t.id}
                className={`nb-pill${tagId === t.id ? ' is-active' : ''}`}
                aria-pressed={tagId === t.id}
                onClick={() => chooseTag(t.id)}
              >
                #{t.name}
                <span className="nb-pill-count">{t.note_count}</span>
              </button>
            ))}
            <button type="button" className="nb-pill nb-pill-manage" aria-haspopup="dialog" onClick={() => setTagsOpen(true)}>
              管理
            </button>
          </div>
        )}
      </div>

      <div className="nb-scroll" ref={scrollRef}>
        {view === 'list' && (
          <ListPane
            state={state}
            q={q}
            filtered={filtered}
            back={back}
            currentId={currentId}
            currentRef={currentRef}
            onRetry={() => setReload((n) => n + 1)}
          />
        )}

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

      <TagSwitcher open={tagsOpen} tags={tags} current={tagId} onPick={chooseTag} onClose={() => setTagsOpen(false)} />
    </div>
  );
}

function ListPane({
  state,
  q,
  filtered,
  back,
  currentId,
  currentRef,
  onRetry,
}: {
  state: ListState;
  q: string;
  filtered: boolean;
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
    if (q) return <div className="notes-state"><p>{`没有找到包含「${q}」的笔记。搜索范围：你的笔记标题、引文与正文。`}</p></div>;
    if (filtered) return <div className="notes-state"><p>当前筛选条件下还没有笔记。</p></div>;
    return <EmptyNotes />;
  }
  return (
    <ul className="note-list">
      {state.items.map((note) => {
        const body = (
          <>
            <span className="note-title">{note.title}</span>
            <span className="note-meta">
              <KindBadge kind={note.kind} />
              {note.depth > 0 && <span className="note-depth">第 {note.depth + 1} 层</span>}
              <time dateTime={note.updated_at} title={`最近更新 ${fullTime(note.updated_at)}`}>
                {isoDate(note.updated_at)}
              </time>
            </span>
            {note.path && <NotePath path={note.path} />}
            <Excerpt note={note} />
            <NoteFoot note={note} />
          </>
        );
        return (
          <li key={note.id}>
            <Link
              to={`/notes/${note.id}`}
              state={{ back }}
              ref={note.id === currentId ? currentRef : undefined}
              aria-current={note.id === currentId ? 'page' : undefined}
              className="note-item"
            >
              {body}
            </Link>
          </li>
        );
      })}
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
