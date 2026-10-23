import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ApiError } from '../api/client';
import { BOOK_LIMITS, BOOK_STATUS_LABEL, createBook, type Book, type BookStatus } from '../api/books';
import { relativeDay } from '../lib/time';
import { BookIcon, CheckCircleIcon, SearchIcon } from './Icons';
import './BookSwitcher.css';

export type BookScopeValue = number | 'none' | null;

type Props = {
  open: boolean;
  books: Book[] | null;
  unfiledCount: number;
  current: BookScopeValue;
  weekOnly: boolean;
  onPick: (scope: BookScopeValue) => void;
  onToggleWeek: () => void;
  onClose: () => void;
};

type Tab = 'all' | 'reading' | 'deep';
type Option = { key: string; scope: BookScopeValue; book?: Book };

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = MAC ? '⌘' : 'Ctrl';
const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '');

type Pinyin = typeof import('pinyin-pro').pinyin;

// 书名 + 作者 + 全拼 + 首字母，拼成一条供包含匹配
function searchKey(book: Book, pinyin: Pinyin | null) {
  const text = `${book.title}${book.author ?? ''}`;
  if (!pinyin) return squash(text);
  const full = pinyin(text, { toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('');
  const first = pinyin(text, { pattern: 'first', toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('');
  return squash(`${text}|${full}|${first}`);
}

export default function BookSwitcher({ open, books, unfiledCount, current, weekOnly, onPick, onToggleWeek, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const titleId = useId();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [active, setActive] = useState(0);
  const [pinyin, setPinyin] = useState<Pinyin | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const returnTo = document.activeElement as HTMLElement | null;
    setQuery('');
    setTab('all');
    setCreating(false);
    dialog.showModal();
    inputRef.current?.focus();
    return () => {
      dialog.close();
      if (returnTo?.isConnected) returnTo.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open || pinyin) return;
    let alive = true;
    import('pinyin-pro')
      .then((m) => {
        if (alive) setPinyin(() => m.pinyin);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open, pinyin]);

  const keys = useMemo(() => new Map((books ?? []).map((b) => [b.id, searchKey(b, pinyin)])), [books, pinyin]);

  const counts = useMemo(() => {
    const list = books ?? [];
    return { all: list.length, reading: list.filter((b) => b.status === 'reading').length, deep: list.filter((b) => b.status === 'deep').length };
  }, [books]);

  const needle = squash(query);
  const options = useMemo<Option[]>(() => {
    const list = (books ?? []).filter((b) => (tab === 'all' || b.status === tab) && (!needle || keys.get(b.id)?.includes(needle)));
    const rows: Option[] = list.map((b) => ({ key: `b${b.id}`, scope: b.id, book: b }));
    if (needle || tab !== 'all') return rows;
    return [{ key: 'all', scope: null }, { key: 'none', scope: 'none' }, ...rows];
  }, [books, tab, needle, keys]);

  useEffect(() => {
    const i = options.findIndex((o) => o.scope === current);
    setActive(needle || i < 0 ? 0 : i);
  }, [options, current, needle]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function onKeyDown(e: KeyboardEvent<HTMLDialogElement>) {
    const mod = MAC ? e.metaKey : e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      setCreating(true);
      return;
    }
    if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      onToggleWeek();
      onClose();
      return;
    }
    if (creating) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!options.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + options.length) % options.length);
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      const option = options[active];
      if (option) {
        e.preventDefault();
        onPick(option.scope);
      }
    }
  }

  const TABS: { value: Tab; label: string }[] = [
    { value: 'all', label: `全部书籍(${counts.all})` },
    { value: 'reading', label: `在读书目(${counts.reading})` },
    { value: 'deep', label: `精读中(${counts.deep})` },
  ];

  return (
    <dialog
      ref={ref}
      className="bs"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      onCancel={(e) => {
        e.preventDefault();
        if (creating) {
          setCreating(false);
          inputRef.current?.focus();
        } else onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <div className="bs-body">
          <h2 id={titleId} className="visually-hidden">
            切换书籍
          </h2>
          <label className="bs-search">
            <SearchIcon size={20} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              maxLength={80}
              placeholder="输入书名、作者或拼音快速跳转...（ESC 关闭）"
              aria-label="搜索书籍"
              aria-controls="bs-options"
              onChange={(e) => {
                setQuery(e.target.value);
                setCreating(false);
              }}
            />
            <kbd className="bs-kbd">ESC</kbd>
          </label>

          {creating ? (
            <CreateForm
              initialTitle={query.trim()}
              onCancel={() => {
                setCreating(false);
                inputRef.current?.focus();
              }}
              onCreated={(book) => onPick(book.id)}
            />
          ) : (
            <>
              <div className="bs-tabs">
                <div role="tablist" aria-label="按阅读状态">
                  {TABS.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      role="tab"
                      aria-selected={tab === t.value}
                      className={`bs-tab${tab === t.value ? ' is-active' : ''}`}
                      onClick={() => {
                        setTab(t.value);
                        inputRef.current?.focus();
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <span className="bs-hint">支持键盘 ↑↓ 导航，回车确定</span>
              </div>

              <ul ref={listRef} id="bs-options" className="bs-list" role="listbox" aria-label="书籍">
                {books === null && <li className="bs-state">加载中…</li>}
                {books !== null && options.length === 0 && (
                  <li className="bs-state">
                    {needle ? `没有匹配「${query.trim()}」的书。` : '这个分组还没有书。'}
                    <button type="button" className="bs-link" onClick={() => setCreating(true)}>
                      新建一本书
                    </button>
                  </li>
                )}
                {options.map((o, i) => (
                  <Row
                    key={o.key}
                    option={o}
                    index={i}
                    unfiledCount={unfiledCount}
                    active={i === active}
                    current={o.scope === current}
                    onHover={() => setActive(i)}
                    onPick={() => onPick(o.scope)}
                  />
                ))}
              </ul>
            </>
          )}

          <div className="bs-foot">
            <span className="bs-shortcuts">
              快捷操作：
              <button type="button" className="bs-shortcut" onClick={() => setCreating(true)}>
                <kbd>{MOD}O</kbd> 打开新书
              </button>
              <button
                type="button"
                className={`bs-shortcut${weekOnly ? ' is-on' : ''}`}
                aria-pressed={weekOnly}
                onClick={() => {
                  onToggleWeek();
                  onClose();
                }}
              >
                <kbd>{MOD}D</kbd> 仅看本周
              </button>
            </span>
            <button type="button" className="bs-close" onClick={onClose}>
              关闭窗口
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}

function Row({
  option,
  index,
  unfiledCount,
  active,
  current,
  onHover,
  onPick,
}: {
  option: Option;
  index: number;
  unfiledCount: number;
  active: boolean;
  current: boolean;
  onHover: () => void;
  onPick: () => void;
}) {
  const { book } = option;
  const title = book ? `《${book.title}》` : option.scope === 'none' ? '未归类' : '全部书籍';
  const sub = book
    ? [book.author, `${book.note_count} 条笔记`, book.last_note_at ? `上次阅读：${relativeDay(book.last_note_at)}` : null].filter(Boolean).join(' · ')
    : option.scope === 'none'
      ? `还没归入任何书的笔记 · ${unfiledCount} 条`
      : '不限书籍，查看全部笔记';
  return (
    <li
      role="option"
      aria-selected={active}
      data-index={index}
      className={`bs-row${active ? ' is-active' : ''}${current ? ' is-current' : ''}${book ? '' : ' is-pinned'}`}
      onMouseMove={onHover}
      onClick={onPick}
    >
      <span className="bs-tile" aria-hidden="true">
        <BookIcon size={22} />
      </span>
      <span className="bs-main">
        <span className="bs-title-line">
          <span className="bs-title">{title}</span>
          {current && <span className="bs-badge">当前聚焦</span>}
          {book?.status && <span className="bs-chip">{BOOK_STATUS_LABEL[book.status]}</span>}
        </span>
        <span className="bs-sub">{sub}</span>
      </span>
      {current ? (
        <span className="bs-check" aria-hidden="true">
          <CheckCircleIcon size={22} />
        </span>
      ) : (
        <span className="bs-go" aria-hidden="true">
          ↵ 跳转
        </span>
      )}
    </li>
  );
}

const STATUS_OPTIONS: { value: BookStatus | ''; label: string }[] = [
  { value: '', label: '不设置' },
  { value: 'reading', label: '在读' },
  { value: 'deep', label: '精读中' },
  { value: 'done', label: '读完' },
];

function CreateForm({ initialTitle, onCancel, onCreated }: { initialTitle: string; onCancel: () => void; onCreated: (book: Book) => void }) {
  const [title, setTitle] = useState(initialTitle);
  const [author, setAuthor] = useState('');
  const [status, setStatus] = useState<BookStatus | ''>('reading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('请填写书名');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onCreated(await createBook({ title: title.trim(), author: author.trim() || null, status: status || null }));
    } catch (err) {
      const fields = err instanceof ApiError ? err.details?.fields : undefined;
      setError(fields ? Object.values(fields)[0] : (err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="bs-create" onSubmit={submit}>
      <p className="bs-create-head">打开新书</p>
      <label className="bs-field">
        <span>书名</span>
        <input ref={titleRef} value={title} maxLength={BOOK_LIMITS.title} placeholder="例如：活法" onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="bs-field">
        <span>作者</span>
        <input value={author} maxLength={BOOK_LIMITS.author} placeholder="可不填" onChange={(e) => setAuthor(e.target.value)} />
      </label>
      <div className="bs-field">
        <span id="bs-status-label">状态</span>
        <div className="bs-status" role="radiogroup" aria-labelledby="bs-status-label">
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s.value}
              type="button"
              role="radio"
              aria-checked={status === s.value}
              className={`bs-status-opt${status === s.value ? ' is-active' : ''}`}
              onClick={() => setStatus(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p className="bs-error" role="alert">
          {error}
        </p>
      )}
      <div className="bs-create-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          返回列表
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? '创建中…' : '创建并切换'}
        </button>
      </div>
    </form>
  );
}
