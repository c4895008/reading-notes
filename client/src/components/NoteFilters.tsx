import { useEffect, useId, useRef, useState } from 'react';
import type { DiscussionFilter, NoteKind, NoteSort } from '../api/notes';
import { FilterIcon } from './Icons';
import { NOTE_KINDS } from './NoteKind';

export type FilterValue = {
  kind: NoteKind | null;
  discussion: DiscussionFilter | null;
  sort: NoteSort;
};

export type FilterPatch = { kind?: string | null; discussion?: string | null; sort?: string | null };

const DISCUSSIONS: { value: DiscussionFilter; label: string }[] = [
  { value: 'active', label: '讨论中' },
  { value: 'ended', label: '已完结' },
  { value: 'none', label: '无讨论' },
];

const SORTS: { value: NoteSort; label: string }[] = [
  { value: 'updated', label: '最近更新' },
  { value: 'created', label: '最近创建' },
];

export const activeFilterCount = (v: FilterValue) =>
  Number(!!v.kind) + Number(!!v.discussion) + Number(v.sort !== 'updated');

function Options<T extends string>({
  label,
  value,
  options,
  allLabel,
  onChange,
}: {
  label: string;
  value: T | null;
  options: { value: T; label: string }[];
  allLabel?: string;
  onChange: (next: T | null) => void;
}) {
  const id = useId();
  const all = allLabel ? [{ value: null as T | null, label: allLabel }, ...options] : options;
  return (
    <div className="nf-group">
      <span id={id} className="nf-label">
        {label}
      </span>
      <div className="nf-options" role="radiogroup" aria-labelledby={id}>
        {all.map((o) => (
          <button
            key={o.value ?? 'all'}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            className={`nf-option${value === o.value ? ' is-active' : ''}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function NoteFilters({ value, onChange }: { value: FilterValue; onChange: (patch: FilterPatch) => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const count = activeFilterCount(value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="nf" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`icon-btn nb-tool${count ? ' is-on' : ''}`}
        aria-label={count ? `筛选（已启用 ${count} 项）` : '筛选'}
        title="筛选"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <FilterIcon size={16} />
        {count > 0 && <span className="nb-tool-count">{count}</span>}
      </button>
      {open && (
        <div id={panelId} className="nf-panel" role="group" aria-label="组合筛选">
          <Options label="分类" value={value.kind} allLabel="全部" options={NOTE_KINDS} onChange={(kind) => onChange({ kind })} />
          <Options
            label="讨论状态"
            value={value.discussion}
            allLabel="全部"
            options={DISCUSSIONS}
            onChange={(discussion) => onChange({ discussion })}
          />
          <Options
            label="排序"
            value={value.sort}
            options={SORTS}
            onChange={(sort) => onChange({ sort: sort === 'created' ? 'created' : null })}
          />
          <div className="nf-foot">
            <button
              type="button"
              className="nf-clear"
              disabled={count === 0}
              onClick={() => onChange({ kind: null, discussion: null, sort: null })}
            >
              清除筛选
            </button>
            <button type="button" className="nf-done" onClick={() => setOpen(false)}>
              完成
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
