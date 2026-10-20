import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { NoteRef, TreeItem } from '../api/notes';
import { formatTime, fullTime } from '../lib/time';
import './NoteThread.css';

type Props = {
  ancestors: NoteRef[];
  currentId: number;
  tree: TreeItem[];
  back: string;
  cap: number;
  children: ReactNode;
};

type Branch = { item: TreeItem; children: Branch[] };

// listTree 是先序扁平序列：当前笔记之后、深度更深的连续节点就是它的子树
function subtree(tree: TreeItem[], id: number): Branch[] {
  const start = tree.findIndex((n) => n.id === id);
  if (start < 0) return [];
  const roots: Branch[] = [];
  const stack: Branch[] = [];
  for (let i = start + 1; i < tree.length && tree[i].depth > tree[start].depth; i++) {
    const node: Branch = { item: tree[i], children: [] };
    while (stack.length && stack[stack.length - 1].item.depth >= node.item.depth) stack.pop();
    (stack.length ? stack[stack.length - 1].children : roots).push(node);
    stack.push(node);
  }
  return roots;
}

// 笔记链：祖先 → 当前 → 子树，层级靠缩进与折线表达，当前笔记是展开的正文卡
export default function NoteThread({ ancestors, currentId, tree, back, cap, children }: Props) {
  const times = new Map(tree.map((n) => [n.id, n.updated_at]));
  const branches = subtree(tree, currentId);

  const level = (depth: number, items: ReactNode) => (
    <ul className={`thread-children${depth > cap ? ' is-flat' : ''}`}>{items}</ul>
  );

  const node = (id: number, title: string, depth: number) => {
    const updated = times.get(id);
    return (
      <Link to={`/notes/${id}`} state={{ back }} className="thread-node" title={title}>
        {depth > cap && <span className="thread-depth">第 {depth + 1} 层</span>}
        <span className="thread-node-title">{title}</span>
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
      {node(b.item.id, b.item.title, b.item.depth)}
      {b.children.length > 0 && level(b.item.depth + 1, b.children.map(renderBranch))}
    </li>
  );

  const renderChain = (i: number): ReactNode => {
    if (i < ancestors.length) {
      const a = ancestors[i];
      return (
        <li key={a.id}>
          {node(a.id, a.title, i)}
          {level(i + 1, renderChain(i + 1))}
        </li>
      );
    }
    return (
      <li key={currentId} className="is-current">
        <div className="thread-current">{children}</div>
        {branches.length > 0 && level(i + 1, branches.map(renderBranch))}
      </li>
    );
  };

  return <ul className="thread">{renderChain(0)}</ul>;
}
