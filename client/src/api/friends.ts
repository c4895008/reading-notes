import type { PublicUser } from './auth';
import { request } from './client';

export type Relation = 'none' | 'pending_out' | 'pending_in' | 'friend';
export type SearchUser = PublicUser & { relation: Relation; request_id?: number };
export type Friend = PublicUser & { since: string };
export type FriendRequest = { id: number; user: PublicUser; created_at: string };

type Page<T> = { items: T[]; page: number; page_size: number; total: number; has_more: boolean };

export const SEARCH_MAX = 20;
export const FRIENDS_PAGE_SIZE = 20;

export const searchUsers = (q: string, signal?: AbortSignal) =>
  request<{ items: SearchUser[] }>(`/users/search?q=${encodeURIComponent(q)}`, { signal }).then((d) => d.items);

export const listFriends = (page = 1, pageSize = FRIENDS_PAGE_SIZE, signal?: AbortSignal) =>
  request<Page<Friend>>(`/friends?page=${page}&page_size=${pageSize}`, { signal });

export const listRequests = (type: 'in' | 'out', page = 1, pageSize = FRIENDS_PAGE_SIZE, signal?: AbortSignal) =>
  request<Page<FriendRequest>>(`/friends/requests?type=${type}&page=${page}&page_size=${pageSize}`, { signal });

export const sendRequest = (username: string) =>
  request<{ request: FriendRequest }>('/friends/requests', { method: 'POST', body: { username } });

export const acceptRequest = (id: number) =>
  request<{ friend: Friend }>(`/friends/requests/${id}/accept`, { method: 'POST' });

export const rejectRequest = (id: number) => request<{ id: number }>(`/friends/requests/${id}/reject`, { method: 'POST' });

export const withdrawRequest = (id: number) => request<{ id: number }>(`/friends/requests/${id}`, { method: 'DELETE' });

export const removeFriend = (userId: number) => request<{ user_id: number }>(`/friends/${userId}`, { method: 'DELETE' });
