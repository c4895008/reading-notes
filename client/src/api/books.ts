import { request } from './client';

export type BookStatus = 'reading' | 'deep' | 'done';
export type BookRef = { id: number; title: string };

export type Book = BookRef & {
  author: string | null;
  status: BookStatus | null;
  note_count: number;
  last_note_at: string | null;
  created_at: string;
};

export type BookInput = { title: string; author: string | null; status: BookStatus | null };

export const BOOK_LIMITS = { title: 80, author: 60 } as const;
export const BOOKS_CHANGED = 'rn:books-changed';

export const BOOK_STATUS_LABEL: Record<BookStatus, string> = { reading: '在读', deep: '精读中', done: '读完' };

const changed = (detail?: { deletedId?: number }) => window.dispatchEvent(new CustomEvent(BOOKS_CHANGED, { detail }));

export const listBooks = (signal?: AbortSignal) =>
  request<{ items: Book[]; unfiled_count: number }>('/books', { signal });

export const createBook = (input: BookInput) =>
  request<{ book: Book }>('/books', { method: 'POST', body: input }).then((d) => {
    changed();
    return d.book;
  });

export const updateBook = (id: number, input: Partial<BookInput>) =>
  request<{ book: Book }>(`/books/${id}`, { method: 'PATCH', body: input }).then((d) => {
    changed();
    return d.book;
  });

export const deleteBook = (id: number) =>
  request<{ deleted: boolean }>(`/books/${id}`, { method: 'DELETE' }).then((d) => {
    changed({ deletedId: id });
    return d;
  });

export const setNotesBook = (noteIds: number[], bookId: number | null) =>
  request<{ updated: number }>('/notes/book', { method: 'PUT', body: { note_ids: noteIds, book_id: bookId } }).then((d) => {
    changed();
    return d;
  });
