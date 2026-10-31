import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { listNotes, type NoteSummary } from '../api/notes';
import { SearchIcon, XIcon } from './Icons';
import './NoteQuickSearch.css';

type Result =
  | { status: 'loading' }
  | { status: 'error' | 'invalid'; message: string }
  | { status: 'ready'; query: string; items: NoteSummary[]; total: number; page: number; hasMore: boolean };

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const parts: ReactNode[] = [];
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index!;
    parts.push(text.slice(end, start), <mark key={start}>{match[0]}</mark>);
    end = start + match[0].length;
  }
  parts.push(text.slice(end));
  return <>{parts}</>;
}

export default function NoteQuickSearch({ onBeforeOpen }: { onBeforeOpen: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const opened = useRef(false);
  const composing = useRef(false);
  const restoreFocus = useRef(true);
  const valueRef = useRef('');
  const readyQuery = useRef<string | null>(null);
  const version = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingPage = useRef(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<Result>({ status: 'loading' });
  const [active, setActive] = useState(-1);
  const [moreLoading, setMoreLoading] = useState(false);
  const [moreError, setMoreError] = useState('');
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const shortcut = isMac ? '⌘K' : 'Ctrl+K';

  const invalidate = useCallback(() => {
    version.current += 1;
    controller.current?.abort();
    controller.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    loadingPage.current = false;
    readyQuery.current = null;
  }, []);

  const load = useCallback(async (needle: string, page: number, requestVersion: number) => {
    const ctrl = new AbortController();
    controller.current = ctrl;
    loadingPage.current = true;
    if (page > 1) {
      setMoreLoading(true);
      setMoreError('');
    }
    const current = () => opened.current && version.current === requestVersion && !ctrl.signal.aborted;
    try {
      const data = await listNotes({ q: needle, page, sort: 'updated' }, ctrl.signal);
      if (!current()) return;
      readyQuery.current = needle;
      setResult((previous) => {
        const old = page > 1 && previous.status === 'ready' && previous.query === needle ? previous.items : [];
        const seen = new Set(old.map((note) => note.id));
        return {
          status: 'ready', query: needle,
          items: [...old, ...data.items.filter((note) => !seen.has(note.id))],
          total: data.total, page: data.page, hasMore: data.has_more,
        };
      });
      if (page === 1) setActive(data.items.length ? 0 : -1);
    } catch (error) {
      if (!current()) return;
      const message = error instanceof Error ? error.message : '搜索失败，请重试。';
      if (page > 1) setMoreError(message);
      else setResult({ status: 'error', message });
    } finally {
      if (current()) {
        loadingPage.current = false;
        setMoreLoading(false);
        controller.current = null;
      }
    }
  }, []);

  const search = useCallback((value: string) => {
    invalidate();
    valueRef.current = value;
    setQuery(value);
    setActive(-1);
    setMoreLoading(false);
    setMoreError('');
    const needle = value.trim();
    if (!composing.current && [...needle].length > 100) {
      setResult({ status: 'invalid', message: '搜索词最多 100 字。' });
      return;
    }
    setResult({ status: 'loading' });
    if (composing.current) return;
    const requestVersion = version.current;
    if (!needle) void load('', 1, requestVersion);
    else timer.current = setTimeout(() => void load(needle, 1, requestVersion), 250);
  }, [invalidate, load]);

  const close = useCallback((restore = true) => {
    restoreFocus.current = restore;
    opened.current = false;
    composing.current = false;
    invalidate();
    setOpen(false);
  }, [invalidate]);

  const show = useCallback(() => {
    const otherDialog = [...document.querySelectorAll('dialog[open]')].some((dialog) => dialog !== dialogRef.current);
    if (otherDialog || document.querySelector('.nf-panel')) return;
    if (opened.current) {
      inputRef.current?.focus();
      return;
    }
    onBeforeOpen();
    restoreFocus.current = true;
    composing.current = false;
    opened.current = true;
    setOpen(true);
    search('');
  }, [onBeforeOpen, search]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 || event.altKey || event.shiftKey) return;
      const modifier = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (!modifier || event.key.toLowerCase() !== 'k') return;
      if ([...document.querySelectorAll('dialog[open]')].some((dialog) => dialog !== dialogRef.current) || document.querySelector('.nf-panel')) return;
      event.preventDefault();
      show();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMac, show]);

  useEffect(() => {
    close(false);
  }, [location.key, close]);

  useEffect(() => () => {
    opened.current = false;
    invalidate();
  }, [invalidate]);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    inputRef.current?.focus();
    return () => {
      dialog.close();
      if (restoreFocus.current && previous?.isConnected && previous.getClientRects().length) previous.focus();
    };
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function choose(note: NoteSummary) {
    if (composing.current || result.status !== 'ready' || readyQuery.current !== valueRef.current.trim()) return;
    const storedBack = location.state?.back;
    const back = location.pathname === '/notes'
      ? location.pathname + location.search
      : typeof storedBack === 'string' && /^\/notes(?:\?[^#]*)?$/.test(storedBack) ? storedBack : '/notes';
    close(false);
    navigate(`/notes/${note.id}`, { state: { back } });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    const ime = composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
    if (ime) {
      if (event.key === 'Escape') event.preventDefault();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.target !== inputRef.current || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (result.status !== 'ready' || readyQuery.current !== valueRef.current.trim()) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!result.items.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((index) => (index + step + result.items.length) % result.items.length);
    } else if (event.key === 'Enter' && result.items[active]) {
      event.preventDefault();
      choose(result.items[active]);
    }
  }

  function more() {
    if (loadingPage.current || result.status !== 'ready' || !result.hasMore || readyQuery.current !== valueRef.current.trim()) return;
    void load(result.query, result.page + 1, version.current);
  }

  const selected = result.status === 'ready' ? result.items[active] : undefined;
  return (
    <>
      <button type="button" className="nqs-trigger" aria-haspopup="dialog" aria-label={`快速搜索笔记（${shortcut}）`}
        aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'} title={`快速搜索全部笔记（${shortcut}）`} onClick={show}>
        <SearchIcon size={16} /><span className="nqs-trigger-label">快速搜索</span><kbd>{shortcut}</kbd>
      </button>
      {createPortal(
        <dialog ref={dialogRef} className="nqs" aria-labelledby={`${id}-title`} onKeyDown={onKeyDown}
          onCancel={(event) => { event.preventDefault(); if (!composing.current) close(); }}
          onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
          {open && <div className="nqs-body">
            <h2 id={`${id}-title`} className="visually-hidden">快速搜索笔记</h2>
            <div className="nqs-search">
              <SearchIcon size={22} />
              <input ref={inputRef} type="text" role="combobox" aria-label="全文搜索笔记" aria-autocomplete="list"
                aria-expanded="true" aria-controls={`${id}-results`} aria-describedby={`${id}-scope`}
                aria-activedescendant={selected ? `${id}-note-${selected.id}` : undefined}
                placeholder="搜索标题、引文与正文…" autoComplete="off" spellCheck={false} value={query}
                onChange={(event) => search(event.target.value)}
                onCompositionStart={() => { composing.current = true; invalidate(); setActive(-1); setResult({ status: 'loading' }); }}
                onCompositionEnd={(event) => { composing.current = false; search(event.currentTarget.value); }} />
              <button type="button" className="nqs-close" aria-label="关闭快速搜索" title="关闭（Esc）" onClick={() => close()}><XIcon size={18} /></button>
            </div>
            <div className="nqs-caption" id={`${id}-scope`}>
              <span>{query.trim() ? '搜索你的全部笔记' : '最近更新'}</span>
              <span role="status" aria-live="polite">{result.status === 'ready' ? query.trim() ? `找到 ${result.total} 条笔记` : `${result.items.length} 条笔记` : result.status === 'loading' ? '搜索中…' : ''}</span>
            </div>
            <div className="nqs-results">
              <ul ref={listRef} id={`${id}-results`} className="nqs-list" role="listbox" aria-label="笔记搜索结果" aria-busy={result.status === 'loading'}>
                {result.status === 'ready' && result.items.map((note, index) => (
                  <li key={note.id} id={`${id}-note-${note.id}`} role="option" aria-selected={active === index}
                    className={`nqs-item${active === index ? ' is-active' : ''}`} onMouseMove={() => setActive(index)}
                    onMouseDown={(event) => event.preventDefault()} onClick={() => choose(note)}>
                    <span className="nqs-title"><Highlight text={note.title} query={result.query} /></span>
                    {!!note.path?.length && <span className="nqs-path">{note.path.map((ancestor) => ancestor.title).join(' / ')}</span>}
                    {note.excerpt && <span className="nqs-excerpt">
                      {note.excerpt_source === 'quote' && <span className="nqs-source">引文 · </span>}
                      <Highlight text={note.excerpt} query={result.query} />
                    </span>}
                  </li>
                ))}
              </ul>
              {result.status === 'loading' && <p className="nqs-state" role="status">正在查找笔记…</p>}
              {(result.status === 'error' || result.status === 'invalid') && <div className="nqs-state" role="alert">
                <p>{result.message}</p>
                {result.status === 'error' && <button type="button" className="btn btn-ghost" onClick={() => { inputRef.current?.focus(); search(valueRef.current); }}>重试</button>}
              </div>}
              {result.status === 'ready' && !result.items.length && <div className="nqs-state">
                <p>{result.query ? `没有找到包含「${result.query}」的笔记` : '还没有笔记'}</p>
                {result.query && <span>试试其他关键词，标题、引文和正文都可以搜索。</span>}
              </div>}
              {result.status === 'ready' && result.query && result.hasMore && <div className="nqs-more">
                {moreError && <p role="alert">{moreError}</p>}
                <button type="button" className="btn btn-ghost" disabled={moreLoading} onClick={more}>
                  {moreLoading ? '加载中…' : moreError ? '重试加载更多' : '加载更多'}
                </button>
              </div>}
            </div>
            <div className="nqs-foot"><span><kbd>↑↓</kbd> 选择</span><span><kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span></div>
          </div>}
        </dialog>, document.body,
      )}
    </>
  );
}
