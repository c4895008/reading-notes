import type { NoteKind } from '../api/notes';
import './NoteKind.css';

export const NOTE_KINDS: { value: NoteKind; label: string; hint: string }[] = [
  { value: 'viewpoint', label: '观点', hint: '书中的观点' },
  { value: 'question', label: '问题', hint: '你的疑问' },
  { value: 'summary', label: '总结', hint: '对观点的上一级抽象' },
];

const LABEL: Record<NoteKind, string> = { viewpoint: '观点', question: '问题', summary: '总结' };

export function KindBadge({ kind }: { kind: NoteKind | null }) {
  if (!kind) return null;
  return (
    <span className={`kind-badge kind-${kind}`}>
      <span className="kind-dot" aria-hidden="true" />
      <span className="kind-label">{LABEL[kind]}</span>
    </span>
  );
}

export function KindPicker({ value, onChange }: { value: NoteKind; onChange: (kind: NoteKind) => void }) {
  const hint = NOTE_KINDS.find((k) => k.value === value)?.hint;
  return (
    <div className="kind-picker">
      <span id="note-kind-label" className="editor-label">
        分类
      </span>
      <div
        className="kind-options"
        role="radiogroup"
        aria-labelledby="note-kind-label"
        aria-describedby="note-kind-hint"
        aria-required="true"
      >
        {NOTE_KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            role="radio"
            aria-checked={value === k.value}
            className={`kind-option kind-${k.value}`}
            title={`${k.label}：${k.hint}`}
            onClick={() => onChange(k.value)}
          >
            <span className="kind-dot" aria-hidden="true" />
            {k.label}
          </button>
        ))}
      </div>
      <span id="note-kind-hint" className="editor-hint">
        {hint}
      </span>
    </div>
  );
}
