import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import type { TreeItem } from '../api/notes';
import { ChevronIcon } from './Icons';
import './NoteTree.css';

// 节点数超过该值时，首次进入默认折叠全部顶层，避免一屏装不下
export const TREE_COLLAPSE_OVER = 500;

function visibleRows(items: TreeItem[], collapsed: Set<number>) {
  const rows: TreeItem[] = [];
  let hideBelow = Infinity;
  for (const item of items) {
    if (item.depth > hideBelow) continue;
    hideBelow = collapsed.has(item.id) && item.child_count > 0 ? item.depth : Infinity;
    rows.push(item);
  }
  return rows;
}

type Props = {
  items: TreeItem[];
  collapsed: Set<number>;
  onToggle: (id: number) => void;
  currentId: number | null;
  back: string;
  cap: number;
};

export default function NoteTree({ items, collapsed, onToggle, currentId, back, cap }: Props) {
  const currentRef = useRef<HTMLLIElement>(null);
  const scrolled = useRef(false);
  const rows = visibleRows(items, collapsed);

  useLayoutEffect(() => {
    scrolled.current = false;
  }, [currentId]);

  useLayoutEffect(() => {
    if (scrolled.current || !currentRef.current) return;
    scrolled.current = true;
    const rect = currentRef.current.getBoundingClientRect();
    if (rect.top < 72 || rect.bottom > window.innerHeight - 72) {
      currentRef.current.scrollIntoView({ block: 'center' });
    }
  }, [rows, currentId]);

  const flat = items.every((n) => n.child_count === 0);

  return (
    <>
      {flat && <p className="tree-hint">写下几条笔记后，用「向上提炼」让它们长出层次。</p>}
      <ul className="tree" aria-label="笔记结构">
        {rows.map((item) => {
          const isOpen = !collapsed.has(item.id);
          const isCurrent = item.id === currentId;
          return (
            <li
              key={item.id}
              ref={isCurrent ? currentRef : undefined}
              className={`tree-row${item.depth === 0 ? ' is-root' : ''}${isCurrent ? ' is-current' : ''}`}
              style={{ '--depth': Math.min(item.depth, cap) } as CSSProperties}
            >
              <span className="tree-indent" aria-hidden="true" />
              {item.child_count > 0 ? (
                <button
                  type="button"
                  className="tree-toggle"
                  aria-expanded={isOpen}
                  aria-label={`${isOpen ? '折叠' : '展开'}「${item.title}」`}
                  onClick={() => onToggle(item.id)}
                >
                  <ChevronIcon />
                </button>
              ) : (
                <span className="tree-toggle is-leaf" aria-hidden="true" />
              )}
              <Link
                to={`/notes/${item.id}`}
                state={{ back }}
                className="tree-link"
                aria-current={isCurrent ? 'true' : undefined}
              >
                {item.depth > cap && <span className="tree-depth">第 {item.depth + 1} 层</span>}
                <span className="tree-title">{item.title}</span>
                {!isOpen && <span className="tree-count">{item.child_count}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
