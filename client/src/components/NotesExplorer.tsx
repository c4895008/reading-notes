import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../api/client';
import { listTree, type TreeItem } from '../api/notes';
import { useAuth } from '../auth/AuthContext';
import { PlusIcon } from './Icons';
import NoteTreeView, { TREE_COLLAPSE_OVER } from './NoteTree';
import TagSection from './TagSection';
import { loadCollapsed, saveCollapsed } from '../lib/treeState';
import './NotesExplorer.css';

export const TREE_CHANGED_EVENT = 'rn:notes-tree-changed';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: TreeItem[] };

// 浏览面板窄，层级缩进最多展示 2 层，更深的显示「第 N 层」标记
const CAP = 2;

function ancestorIds(items: TreeItem[], id: number | null) {
  if (id === null) return [];
  const idx = items.findIndex((n) => n.id === id);
  if (idx < 0) return [];
  const ids: number[] = [];
  let depth = items[idx].depth;
  for (let i = idx - 1; i >= 0 && depth > 0; i -= 1) {
    if (items[i].depth < depth) {
      ids.push(items[i].id);
      depth = items[i].depth;
    }
  }
  return ids;
}

function Skeleton() {
  return (
    <ul className="tree" aria-hidden="true">
      {[0, 1, 2, 1, 0].map((d, i) => (
        <li key={i} className="tree-row is-skeleton" style={{ '--depth': d } as CSSProperties}>
          <span className="tree-indent" />
          <span className="sk sk-line" style={{ width: `${70 - d * 12}%` }} />
        </li>
      ))}
    </ul>
  );
}

export default function NotesExplorer({ currentId = null }: { currentId?: number | null }) {
  const { user } = useAuth();
  const userId = user!.user_id;
  const [state, setState] = useState<State>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<number> | null>(() => loadCollapsed(userId));

  const load = useCallback(() => {
    const ctrl = new AbortController();
    setState((s) => (s.status === 'error' ? { status: 'loading' } : s));
    listTree(ctrl.signal)
      .then((items) => {
        setState({ status: 'ready', items });
        setCollapsed((c) => {
          let next = c;
          if (!next) {
            // 从未记录过折叠态：默认全展开，节点过多时折叠顶层
            next = new Set(
              items.length > TREE_COLLAPSE_OVER ? items.filter((n) => n.depth === 0 && n.child_count > 0).map((n) => n.id) : [],
            );
          }
          // 保证当前笔记可见：展开它的全部祖先
          const ancestors = ancestorIds(items, currentId);
          if (ancestors.some((id) => next!.has(id))) {
            next = new Set(next);
            ancestors.forEach((id) => next!.delete(id));
          }
          saveCollapsed(userId, next);
          return next;
        });
      })
      .catch((e: ApiError) => {
        if (!ctrl.signal.aborted) setState({ status: 'error', message: e.message });
      });
    return ctrl;
  }, [userId, currentId]);

  useEffect(() => {
    const ctrl = load();
    const onChanged = () => {
      ctrl.abort();
      load();
    };
    window.addEventListener(TREE_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(TREE_CHANGED_EVENT, onChanged);
      ctrl.abort();
    };
  }, [load, reload, currentId]);

  function toggle(id: number) {
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveCollapsed(userId, next);
      return next;
    });
  }

  return (
    <div className="exh">
      <div className="exh-head">
        <span className="exh-title">笔记</span>
        <Link to="/notes/new" className="icon-btn exh-new" aria-label="写笔记" title="写笔记" state={{ back: '/notes' }}>
          <PlusIcon size={16} />
        </Link>
      </div>

      {state.status === 'loading' && <Skeleton />}

      {state.status === 'error' && (
        <div className="exh-state">
          <p>{state.message}</p>
          <button type="button" className="text-btn" onClick={() => setReload((n) => n + 1)}>
            重试
          </button>
        </div>
      )}

      {state.status === 'ready' && state.items.length === 0 && (
        <div className="exh-state">
          <p>还没有笔记。</p>
          <Link to="/notes/new" className="text-btn" state={{ back: '/notes' }}>
            写第一条
          </Link>
        </div>
      )}

      {state.status === 'ready' && state.items.length > 0 && collapsed && (
        <NoteTreeView items={state.items} collapsed={collapsed} onToggle={toggle} currentId={currentId} back="/notes" cap={CAP} />
      )}

      <TagSection />
    </div>
  );
}
