import { request } from './client';

export type Avatar = { type: 'preset'; preset: number } | { type: 'custom'; url: string };

export type Badge = { code: string; name: string };

export type PublicUser = {
  user_id: number;
  username: string;
  nickname: string;
  avatar: Avatar;
  badges: Badge[];
};

export type Session = { token: string; user: PublicUser };

export const register = (body: { username: string; password: string; nickname?: string }) =>
  request<Session>('/auth/register', { method: 'POST', body });

export const login = (body: { username: string; password: string }) =>
  request<Session>('/auth/login', { method: 'POST', body });

export const fetchMe = () => request<{ user: PublicUser }>('/auth/me');

export const checkUsernameAvailable = (username: string) =>
  request<{ available: boolean }>(`/auth/username-available?username=${encodeURIComponent(username)}`);
