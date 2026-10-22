import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../api/client';
import { createTag, listTags, setNoteTags, TAG_NAME_MAX, TAGS_CHANGED, type NoteTag } from '../api/tags';
import { useToast } from './Toast';
import { XIcon } from './Icons';
import './Tags.css';

type Props = { noteId: number; tags: NoteTag[]; onChange: (tags: NoteTag[]) => void };

const SUGGEST_MAX = 6;

export default function TagEditor({ noteId, tags, onChange }: Props) {
  const toast = useToast();
  const [all, setAll] = useState<NoteTag[]>([]);
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const dropListId = useId();

  useEffect(() => {
    let ctrl: AbortController;
    const refresh = () => {
      ctrl?.abort();
      ctrl = new AbortController();
      const { signal } = ctrl;
      listTags(signal)
        .then((items) => {
          if (!signal.aborted) setAll(items);
        })
        .catch(() => {});
    };
    refresh();
    window.addEventListener(TAGS_CHANGED, refresh);
    return () => {
      ctrl.abort();
      window.removeEventListener(TAGS_CHANGED, refresh);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const query = input.trim();
  const owned = useMemo(() => new Set(tags.map((t) => t.id)), [tags]);
  const matches = useMemo(
    () => all.filter((t) => !owned.has(t.id) && (!query || t.name.includes(query))).slice(0, SUGGEST_MAX),
    [all, owned, query],
  );
  const exactExists = query !== '' && all.some((t) => t.name === query && !owned.has(t.id));
  const canCreate = query !== '' && !exactExists && [...query].length <= TAG_NAME_MAX;
  const showDrop = open && (matches.length > 0 || canCreate);

  async function commit(ids: number[]) {
    if (busy) return;
    setBusy(true);
    try {
      const next = await setNoteTags(noteId, ids);
      onChange(next);
      setInput('');
    } catch (e) {
      toast((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  const addTag = (tag: NoteTag) => commit([...tags.map((t) => t.id), tag.id]);

  async function addNew() {
    if (!canCreate || busy) return;
    setBusy(true);
    try {
      const tag = await createTag(query);
      const next = await setNoteTags(noteId, [...tags.map((t) => t.id), tag.id]);
      setAll((prev) => (prev.some((t) => t.id === tag.id) ? prev : [...prev, tag]));
      onChange(next);
      setInput('');
    } catch (e) {
      toast((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  function activateFirst() {
    if (matches.length > 0) addTag(matches[0]);
    else if (canCreate) addNew();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      activateFirst();
    } else if (e.key === 'Escape') {
      setInput('');
      setOpen(false);
      e.currentTarget.blur();
    }
  }

  return (
    <div className="tagedit" ref={rootRef}>
      <span className="tagedit-label">标签</span>
      <ul className="tagedit-pills" aria-label="这条笔记的标签">
        {tags.map((tag) => (
          <li key={tag.id} className="tag-pill">
            <Link to={`/notes?tag=${tag.id}`} className="tag-pill-name">
              {tag.name}
            </Link>
            <button
              type="button"
              aria-label={`移除标签「${tag.name}」`}
              disabled={busy}
              onClick={() => commit(tags.filter((t) => t.id !== tag.id).map((t) => t.id))}
            >
              <XIcon size={12} />
            </button>
          </li>
        ))}
      </ul>
      <div className="tagedit-input-wrap">
        <input
          className="tagedit-input"
          placeholder={tags.length === 0 ? '添加标签…' : '再加一个…'}
          value={input}
          maxLength={TAG_NAME_MAX}
          autoComplete="off"
          aria-label="添加标签"
          aria-expanded={showDrop}
          aria-controls={showDrop ? dropListId : undefined}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setInput(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          disabled={busy}
        />
        {showDrop && (
          <ul className="tagedit-drop" id={dropListId} role="listbox" aria-label="选择标签">
            {matches.map((tag) => (
              <li key={tag.id}>
                <button type="button" role="option" aria-selected="false" onClick={() => addTag(tag)}>
                  {tag.name}
                </button>
              </li>
            ))}
            {canCreate && (
              <li>
                <button type="button" role="option" aria-selected="false" className="is-create" onClick={addNew}>
                  新建标签「{query}」
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
