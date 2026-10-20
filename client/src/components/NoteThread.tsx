import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { NoteRef, TreeItem } from '../api/notes';
import { formatTime, fullTime } from '../lib/time';
import './NoteThread.css';

type Props = {
  ancestors: NoteRef[];
  current: NoteRef;
  tree: TreeItem[];
  back: string;
  cap: number;
};

type Branch = { item: TreeItem; children: Branch[] };

// listTree 是先序扁平序列：当前笔记之后、深度更深的连续节点就是它的子树
function subtree(tree: TreeItem[], id: number) {
  const start = tree.findIndex((n) => n.id === id);
  const roots: Branch[] = [];
  let count = 0;
  let depth = 0;
  if (start < 0) return { roots, count, depth };
  const stack: Branch[] = [];
  for (let i = start + 1; i < tree.length && tree[i].depth > tree[start].depth; i++) {
    const node: Branch = { item: tree[i], children: [] };
    while (stack.length && stack[stack.length - 1].item.depth >= node.item.depth) stack.pop();
    (stack.length ? stack[stack.length - 1].children : roots).push(node);
    stack.push(node);
    count++;
    depth = Math.max(depth, node.item.depth - tree[start].depth);
  }
  return { roots, count, depth };
}

// 笔记链导图：把祖先 → 当前 → 子树收进一张大纲，正文另起一张卡
export default function NoteThread({ ancestors, current, tree, back, cap }: Props) {
  const times = new Map(tree.map((n) => [n.id, n.updated_at]));
  const { roots, count, depth } = subtree(tree, current.id);
  const total = ancestors.length + 1 + count;
  const levels = ancestors.length + 1 + depth;

  const level = (d: number, items: ReactNode) => (
    <ul className={`thread-children${d > cap ? ' is-flat' : ''}`}>{items}</ul>
  );

  const pill = (d: number) => d > cap && <span className="thread-depth">第 {d + 1} 层</span>;

  const row = (id: number, title: string, d: number) => {
    const updated = times.get(id);
    return (
      <Link to={`/notes/${id}`} state={{ back }} className="thread-row" title={title}>
        {pill(d)}
        <span className="thread-title">{title}</span>
        {updated && (
          <time dateTime={updated} title={`最近更新 ${fullTime(updated)}`}>
            {formatTime(updated)}
          </time>
        )}
      </Link>
    );
  };

  const renderBranch = (b: Branch) => (
    <li key={b.item.id}>
      {row(b.item.id, b.item.title, b.item.depth)}
      {b.children.length > 0 && level(b.item.depth + 1, b.children.map(renderBranch))}
    </li>
  );

  const renderChain = (i: number): ReactNode => {
    if (i < ancestors.length) {
      const a = ancestors[i];
      return (
        <li key={a.id}>
          {row(a.id, a.title, i)}
          {level(i + 1, renderChain(i + 1))}
        </li>
      );
    }
    return (
      <li key={current.id}>
        <div className="thread-row is-current" aria-current="page" title={current.title}>
          {pill(i)}
          <span className="thread-title">{current.title}</span>
          <span className="thread-here">正在阅读</span>
        </div>
        {roots.length > 0 && level(i + 1, roots.map(renderBranch))}
      </li>
    );
  };

  return (
    <nav className="thread" aria-label="笔记链">
      <div className="thread-head">
        <span className="thread-label">笔记链</span>
        <span>
          {total} 条 · {levels} 层
        </span>
      </div>
      <ul className="thread-tree">{renderChain(0)}</ul>
    </nav>
  );
}
