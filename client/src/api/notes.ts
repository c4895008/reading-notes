import { request } from './client';
import type { TalkStatus, TalkSummary } from './discussions';
import type { NoteTag } from './tags';

export type NoteRef = { id: number; title: string };

export type NoteSummary = {
  id: number;
  parent_id: number | null;
  title: string;
  excerpt: string;
  excerpt_source: 'content' | 'quote' | 'none';
  depth: number;
  path?: NoteRef[];
  discussion_status: TalkStatus | null;
  tags: NoteTag[];
  created_at: string;
  updated_at: string;
};

export type NoteChild = NoteRef & { updated_at: string };

export type Note = {
  id: number;
  parent_id: number | null;
  title: string;
  quote: string | null;
  content: string;
  tags: NoteTag[];
  created_at: string;
  updated_at: string;
  ancestors: NoteRef[];
  children: NoteChild[];
  discussion?: TalkSummary | null;
};

export type TreeItem = {
  id: number;
  parent_id: number | null;
  title: string;
  depth: number;
  child_count: number;
  updated_at: string;
};

export type NoteInput = { title: string; quote: string | null; content: string };

export type NotePage = {
  items: NoteSummary[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
};

export const NOTE_LIMITS = { title: 80, quote: 2000, content: 20000 } as const;

const notePath = (id: string | number) => `/notes/${encodeURIComponent(id)}`;

export function listNotes({ q, page, tag }: { q?: string; page?: number; tag?: number }, signal?: AbortSignal) {
  const params = new URLSearchParams({ view: 'list' });
  if (q) params.set('q', q);
  if (tag) params.set('tag', String(tag));
  if (page && page > 1) params.set('page', String(page));
  return request<NotePage>(`/notes?${params}`, { signal });
}

export const listTree = (signal?: AbortSignal) =>
  request<{ items: TreeItem[] }>('/notes?view=tree', { signal }).then((d) => d.items);

export const getNote = (id: string | number, signal?: AbortSignal) =>
  request<{ note: Note }>(notePath(id), { signal }).then((d) => d.note);

export const createNote = (input: NoteInput, idempotencyKey: string, parentId?: number) =>
  request<{ note: Note }>('/notes', {
    method: 'POST',
    body: parentId ? { ...input, parent_id: parentId } : input,
    headers: { 'Idempotency-Key': idempotencyKey },
  }).then((d) => d.note);

export const updateNote = (id: string | number, input: NoteInput) =>
  request<{ note: Note }>(notePath(id), { method: 'PUT', body: input }).then((d) => d.note);

export const promoteNote = (id: string | number, input: NoteInput, idempotencyKey: string) =>
  request<{ note: Note }>(`${notePath(id)}/promote`, {
    method: 'POST',
    body: input,
    headers: { 'Idempotency-Key': idempotencyKey },
  }).then((d) => d.note);

export const moveNote = (id: string | number, parentId: number | null) =>
  request<{ note: Note }>(`${notePath(id)}/parent`, { method: 'PUT', body: { parent_id: parentId } }).then((d) => d.note);

export const deleteNote = (id: string | number) =>
  request<{ promoted_children: number }>(notePath(id), { method: 'DELETE' });
