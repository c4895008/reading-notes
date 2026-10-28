import type { PublicUser } from './auth';
import { request } from './client';
import type { NoteKind } from './notes';

export type LikeState = { liked: boolean; like_count: number };
export type FeedItem = LikeState & {
  id: number;
  title: string;
  kind: NoteKind | null;
  quote: string | null;
  excerpt: string;
  author: PublicUser;
  shared_at: string;
};
export type FeedNote = Omit<FeedItem, 'excerpt'> & { content: string };
export type FeedPage = { items: FeedItem[]; page: number; page_size: number; total: number; has_more: boolean };

const feedPath = (id: string | number) => `/feed/${encodeURIComponent(id)}`;

export const listFeed = (page = 1, signal?: AbortSignal) =>
  request<FeedPage>(`/feed?page=${page}`, { signal, cache: 'no-store' });

export const getFeedNote = (id: string | number, signal?: AbortSignal) =>
  request<{ note: FeedNote }>(feedPath(id), { signal, cache: 'no-store' }).then((d) => d.note);

export const setNoteLike = (id: number, liked: boolean, signal?: AbortSignal) =>
  request<LikeState>(`${feedPath(id)}/like`, { method: liked ? 'PUT' : 'DELETE', signal, cache: 'no-store' });
