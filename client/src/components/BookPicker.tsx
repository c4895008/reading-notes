import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { BOOK_LIMITS, BOOKS_CHANGED, createBook, listBooks, type Book } from '../api/books';
import { BookIcon, ChevronIcon, PlusIcon } from './Icons';
import './BookPicker.css';

type Option = { key: string; label: string; value: number | null | 'create' };

export default function BookPicker({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const [books, setBooks] = useState<Book[] | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const labelId = useId();
  const listId = useId();

  useEffect(() => {
    let ctrl: AbortController | null = null;
    const refresh = () => {
      ctrl?.abort();
      const next = new AbortController();
      ctrl = next;
      listBooks(next.signal)
        .then((d) => {
          if (!next.signal.aborted) setBooks(d.items);
        })
        .catch(() => {});
    };
    refresh();
    window.addEventListener(BOOKS_CHANGED, refresh);
    return () => {
      window.removeEventListener(BOOKS_CHANGED, refresh);
      ctrl?.abort();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setError(null);
    inputRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const current = value === null ? null : books?.find((b) => b.id === value);
  const needle = query.trim();
  const lower = needle.toLowerCase();
  const matches = (books ?? []).filter((b) => !lower || b.title.toLowerCase().includes(lower) || b.author?.toLowerCase().includes(lower));
  const exact = (books ?? []).some((b) => b.title === needle);
  const options: Option[] = [
    ...(lower ? [] : [{ key: 'none', label: '未归类', value: null }]),
    ...matches.map((b) => ({ key: `b${b.id}`, label: `《${b.title}》`, value: b.id })),
    ...(needle && !exact ? [{ key: 'create', label: `新建《${needle}》`, value: 'create' as const }] : []),
  ];

  useEffect(() => {
    setActive(0);
  }, [query]);

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  async function choose(option: Option) {
    if (option.value !== 'create') {
      onChange(option.value);
      close();
      return;
    }
    if ([...needle].length > BOOK_LIMITS.title) {
      setError(`书名最多 ${BOOK_LIMITS.title} 字`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const book = await createBook({ title: needle, author: null, status: 'reading' });
      onChange(book.id);
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!options.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + options.length) % options.length);
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (options[active] && !busy) choose(options[active]);
    }
  }

  return (
    <div className="book-picker" ref={wrapRef}>
      <span id={labelId} className="editor-label">
        书籍
      </span>
      <button
        ref={buttonRef}
        type="button"
        className={`book-picker-trigger${value === null ? ' is-empty' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={labelId}
        onClick={() => setOpen((o) => !o)}
      >
        <BookIcon size={15} />
        <span className="book-picker-value">{value === null ? '未归类' : current ? `《${current.title}》` : '…'}</span>
        <span className="book-picker-chevron" aria-hidden="true">
          <ChevronIcon size={14} />
        </span>
      </button>
      {open && (
        <div className="book-picker-pop" onKeyDown={onKeyDown}>
          <input
            ref={inputRef}
            className="book-picker-input"
            value={query}
            maxLength={BOOK_LIMITS.title + 10}
            placeholder="搜索或输入新书名"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={options[active] ? `${listId}-${options[active].key}` : undefined}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul id={listId} className="book-picker-list" role="listbox" aria-labelledby={labelId}>
            {books === null && <li className="book-picker-state">加载中…</li>}
            {options.map((o, i) => (
              <li
                key={o.key}
                id={`${listId}-${o.key}`}
                role="option"
                aria-selected={o.value === value}
                className={`book-picker-option${i === active ? ' is-active' : ''}${o.value === value ? ' is-current' : ''}${o.value === 'create' ? ' is-create' : ''}`}
                onMouseMove={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => !busy && choose(o)}
              >
                {o.value === 'create' && <PlusIcon size={14} />}
                {o.value === 'create' && busy ? '创建中…' : o.label}
              </li>
            ))}
          </ul>
          {error && (
            <p className="book-picker-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
