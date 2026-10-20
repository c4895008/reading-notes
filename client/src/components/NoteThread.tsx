import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { NoteRef, TreeItem } from '../api/notes';
import { formatTime, fullTime } from '../lib/time';
import { PlusIcon } from './Icons';
import './NoteThread.css';

type Props = {
  ancestors: NoteRef[];
  descendants: TreeItem[];
  back: string;
  cap: number;
  addChild?: ReactNode;
  children: ReactNode;
};

// 贯穿式笔记链：祖先是紧凑行，当前笔记是完整卡片，后代按绝对层级缩进
export default function NoteThread({ ancestors, descendants, back, cap, addChild, children }: Props) {
  const currentDepth = ancestors.length;
  const indent = (depth: number) => ({ '--depth': Math.min(depth, cap) }) as CSSProperties;

  return (
    <ul className="thread">
      {ancestors.length === 0 && <li className="thread-root">顶层笔记</li>}

      {ancestors.map((a, i) => (
        <li key={a.id} className="thread-row" style={indent(i)}>
          <span className="thread-indent" aria-hidden="true" />
          <span className="thread-node" aria-hidden="true">
            <span className="thread-dot" />
          </span>
          <Link to={`/notes/${a.id}`} state={{ back }} className="thread-card" title={a.title}>
            <span className="thread-card-title">{a.title}</span>
          </Link>
        </li>
      ))}

      <li className="thread-row is-current" style={indent(currentDepth)}>
        <span className="thread-indent" aria-hidden="true" />
        <span className="thread-node" aria-hidden="true">
          <span className="thread-dot" />
        </span>
        <div className="thread-current">{children}</div>
      </li>

      {descendants.map((d) => (
        <li key={d.id} className="thread-row" style={indent(d.depth)}>
          <span className="thread-indent" aria-hidden="true" />
          <span className="thread-node" aria-hidden="true">
            <span className="thread-dot" />
          </span>
          <Link to={`/notes/${d.id}`} state={{ back }} className="thread-card" title={d.title}>
            {d.depth > cap && <span className="thread-depth">第 {d.depth + 1} 层</span>}
            <span className="thread-card-title">{d.title}</span>
            <time dateTime={d.updated_at} title={`最近更新 ${fullTime(d.updated_at)}`}>
              {formatTime(d.updated_at)}
            </time>
          </Link>
        </li>
      ))}

      {addChild && (
        <li className="thread-row" style={indent(currentDepth + 1)}>
          <span className="thread-indent" aria-hidden="true" />
          <span className="thread-node thread-node-add" aria-hidden="true">
            <PlusIcon size={14} />
          </span>
          {addChild}
        </li>
      )}
    </ul>
  );
}
