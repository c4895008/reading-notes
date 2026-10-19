import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ApiError } from '../api/client';
import { listTree, type NoteRef, type TreeItem } from '../api/notes';
import { SearchIcon } from './Icons';
import './ConfirmDialog.css';
import './NotePicker.css';

type Props = {
  open: boolean;
  source: NoteRef;
  currentParentId: number | null;
  onPick: (parent: NoteRef) => void;
  onClose: () => void;
};

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; items: TreeItem[] };

const EXCLUDED = '不能选择这条笔记或它的下层笔记';

// 先序序列里，源笔记之后连续的更深节点就是它的全部后代
function excludedIds(items: TreeItem[], sourceId: number) {
  const ids = new Set<number>();
  const start = items.findIndex((n) => n.id === sourceId);
  if (start < 0) return ids.add(sourceId);
  ids.add(sourceId);
  for (let i = start + 1; i < items.length && items[i].depth > items[start].depth; i++) ids.add(items[i].id);
  return ids;
}

export default function NotePicker({ open, source, currentParentId, onPick, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [query, setQuery] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const returnTo = document.activeElement as HTMLElement | null;
    dialog.showModal();
    inputRef.current?.focus();
    return () => {
      dialog.close();
      if (returnTo?.isConnected) returnTo.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    setState({ status: 'loading' });
    setQuery('');
    listTree(ctrl.signal)
      .then((items) => setState({ status: 'ready', items }))
      .catch((e: ApiError) => {
        if (!ctrl.signal.aborted) setState({ status: 'error', message: e.message });
      });
    return () => ctrl.abort();
  }, [open, reload]);

  const excluded = useMemo(
    () => (state.status === 'ready' ? excludedIds(state.items, source.id) : new Set<number>()),
    [state, source.id],
  );

  const needle = query.trim().toLowerCase();
  const items = state.status === 'ready' ? state.items : [];
  const shown = needle ? items.filter((n) => n.title.toLowerCase().includes(needle)) : items;
  const selectable = items.some((n) => !excluded.has(n.id) && n.id !== currentParentId);

  return (
    <dialog
      ref={ref}
      className="confirm picker"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <div className="picker-body">
          <div className="picker-head">
            <h2 id={titleId} className="confirm-title">
              {currentParentId ? '更换父笔记' : '挂载父笔记'}
            </h2>
            <p className="picker-sub">为「{source.title}」选择一条父笔记，它会成为父笔记的最后一条下层笔记。</p>
            <div className="notes-search picker-search">
              <SearchIcon />
              <input
                ref={inputRef}
                type="search"
                className="notes-search-input"
                placeholder="搜索笔记标题"
                aria-label="搜索笔记标题"
                value={query}
                maxLength={100}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
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
            {state.status === 'ready' && !selectable && !needle && (
              <p className="picker-state">还没有可以挂载的笔记。先写下另一条笔记吧。</p>
            )}
            {state.status === 'ready' && needle && shown.length === 0 && (
              <p className="picker-state">没有标题包含「{query.trim()}」的笔记。</p>
            )}
            {state.status === 'ready' && shown.length > 0 && (selectable || needle) && (
              <ul className="picker-list">
                {shown.map((item) => {
                  const isExcluded = excluded.has(item.id);
                  const isCurrent = item.id === currentParentId;
                  const disabled = isExcluded || isCurrent;
                  return (
                    <li key={item.id} style={{ '--depth': needle ? 0 : Math.min(item.depth, 4) } as CSSProperties}>
                      <button
                        type="button"
                        className="picker-item"
                        disabled={disabled}
                        title={isExcluded ? EXCLUDED : undefined}
                        onClick={() => onPick({ id: item.id, title: item.title })}
                      >
                        <span className="picker-item-title">{item.title}</span>
                        {isExcluded && <span className="picker-item-why">{item.id === source.id ? '本条' : '下层'}</span>}
                        {isCurrent && <span className="picker-item-why">当前父级</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="picker-foot">
            <p className="picker-note">标为「本条」「下层」的不可选：{EXCLUDED}。</p>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              取消
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
