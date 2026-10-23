import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../api/client';
import {
  BOOK_LIMITS,
  BOOK_STATUS_LABEL,
  BOOKS_CHANGED,
  createBook,
  deleteBook,
  listBooks,
  updateBook,
  type Book,
  type BookInput,
  type BookStatus,
} from '../api/books';
import ConfirmDialog from '../components/ConfirmDialog';
import { BookIcon, PenIcon, PlusIcon, TrashIcon } from '../components/Icons';
import { useToast } from '../components/Toast';
import { relativeDay } from '../lib/time';
import '../components/ConfirmDialog.css';
import './Page.css';
import './BooksPage.css';

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; items: Book[]; unfiled: number };

const STATUS_OPTIONS: { value: BookStatus | null; label: string }[] = [
  { value: null, label: '不设置' },
  { value: 'reading', label: '在读' },
  { value: 'deep', label: '精读中' },
  { value: 'done', label: '读完' },
];

export default function BooksPage() {
  const toast = useToast();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<Book | 'new' | null>(null);
  const [removing, setRemoving] = useState<Book | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onChanged = () => setReload((n) => n + 1);
    window.addEventListener(BOOKS_CHANGED, onChanged);
    return () => window.removeEventListener(BOOKS_CHANGED, onChanged);
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => (s.status === 'error' ? { status: 'loading' } : s));
    listBooks(ctrl.signal)
      .then((d) => {
        if (!ctrl.signal.aborted) setState({ status: 'ready', items: d.items, unfiled: d.unfiled_count });
      })
      .catch((e: ApiError) => {
        if (!ctrl.signal.aborted) setState({ status: 'error', message: e.message });
      });
    return () => ctrl.abort();
  }, [reload]);

  async function confirmRemove() {
    if (!removing) return;
    setBusy(true);
    try {
      await deleteBook(removing.id);
      toast(`已删除《${removing.title}》`);
      setRemoving(null);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page page-enter books-page" aria-labelledby="page-title">
      <div className="books-head">
        <div>
          <h1 id="page-title" className="page-title">
            书架
          </h1>
          <p className="page-hint">按书整理笔记。点开一本书查看它的全部笔记；删除书不会删除笔记，笔记会回到「未归类」。</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
          <PlusIcon size={16} />
          打开新书
        </button>
      </div>

      {state.status === 'loading' && <p className="books-state">加载中…</p>}
      {state.status === 'error' && (
        <div className="books-state" role="alert">
          <p>{state.message}</p>
          <button type="button" className="btn btn-ghost" onClick={() => setReload((n) => n + 1)}>
            重试
          </button>
        </div>
      )}
      {state.status === 'ready' && (
        <ul className="books-grid">
          {state.items.map((book) => (
            <li key={book.id} className="book-card">
              <Link to={`/notes?book=${book.id}`} className="book-card-link">
                <span className="book-card-tile" aria-hidden="true">
                  <BookIcon size={22} />
                </span>
                <span className="book-card-main">
                  <span className="book-card-title-line">
                    <span className="book-card-title">《{book.title}》</span>
                    {book.status && <span className="book-card-chip">{BOOK_STATUS_LABEL[book.status]}</span>}
                  </span>
                  <span className="book-card-sub">
                    {[book.author, `${book.note_count} 条笔记`, book.last_note_at ? `上次阅读：${relativeDay(book.last_note_at)}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              </Link>
              <span className="book-card-actions">
                <button type="button" className="icon-btn book-card-act" aria-label={`编辑《${book.title}》`} title="编辑" onClick={() => setEditing(book)}>
                  <PenIcon size={15} />
                </button>
                <button
                  type="button"
                  className="icon-btn book-card-act is-danger"
                  aria-label={`删除《${book.title}》`}
                  title="删除"
                  onClick={() => setRemoving(book)}
                >
                  <TrashIcon size={15} />
                </button>
              </span>
            </li>
          ))}
          <li className="book-card is-unfiled">
            <Link to="/notes?book=none" className="book-card-link">
              <span className="book-card-tile" aria-hidden="true">
                <BookIcon size={22} />
              </span>
              <span className="book-card-main">
                <span className="book-card-title">未归类</span>
                <span className="book-card-sub">还没归入任何书的笔记 · {state.unfiled} 条</span>
              </span>
            </Link>
          </li>
        </ul>
      )}
      {state.status === 'ready' && state.items.length === 0 && (
        <p className="books-empty">还没有书。点「打开新书」建第一本，再在笔记编辑器或列表的批量模式里把笔记归进去。</p>
      )}

      <BookFormDialog
        book={editing}
        onClose={() => setEditing(null)}
        onSaved={(book, created) => {
          toast(created ? `已添加《${book.title}》` : '修改已保存');
          setEditing(null);
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        title={`删除《${removing?.title ?? ''}》？`}
        message={`这本书下的 ${removing?.note_count ?? 0} 条笔记将变为未归类，笔记本身不会被删除。`}
        confirmLabel="删除"
        danger
        busy={busy}
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

function BookFormDialog({ book, onClose, onSaved }: { book: Book | 'new' | null; onClose: () => void; onSaved: (book: Book, created: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const open = book !== null;
  const [form, setForm] = useState<BookInput>({ title: '', author: null, status: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const returnTo = document.activeElement as HTMLElement | null;
    setForm(book === 'new' ? { title: '', author: null, status: 'reading' } : { title: book.title, author: book.author, status: book.status });
    setError(null);
    setBusy(false);
    dialog.showModal();
    titleRef.current?.focus();
    return () => {
      dialog.close();
      if (returnTo?.isConnected) returnTo.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!book) return;
    const input = { title: form.title.trim(), author: form.author?.trim() || null, status: form.status };
    if (!input.title) {
      setError('请填写书名');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = book === 'new' ? await createBook(input) : await updateBook(book.id, input);
      onSaved(saved, book === 'new');
    } catch (err) {
      const fields = err instanceof ApiError ? err.details?.fields : undefined;
      setError(fields ? Object.values(fields)[0] : (err as Error).message);
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className="confirm book-form"
      aria-labelledby={headingId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      {open && (
        <form className="confirm-body" onSubmit={submit}>
          <h2 id={headingId} className="confirm-title">
            {book === 'new' ? '打开新书' : '编辑书籍'}
          </h2>
          <label className="book-form-field">
            <span>书名</span>
            <input
              ref={titleRef}
              value={form.title}
              maxLength={BOOK_LIMITS.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </label>
          <label className="book-form-field">
            <span>作者</span>
            <input
              value={form.author ?? ''}
              maxLength={BOOK_LIMITS.author}
              placeholder="可不填"
              onChange={(e) => setForm((f) => ({ ...f, author: e.target.value }))}
            />
          </label>
          <div className="book-form-field">
            <span id={`${headingId}-status`}>阅读状态</span>
            <div className="book-form-status" role="radiogroup" aria-labelledby={`${headingId}-status`}>
              {STATUS_OPTIONS.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  role="radio"
                  aria-checked={form.status === s.value}
                  className={`book-form-opt${form.status === s.value ? ' is-active' : ''}`}
                  onClick={() => setForm((f) => ({ ...f, status: s.value }))}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          {error && (
            <p className="book-form-error" role="alert">
              {error}
            </p>
          )}
          <div className="confirm-actions">
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>
              取消
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? '保存中…' : '保存'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
