import type { PublicUser } from './auth';
import { request } from './client';

type UserReply = { user: PublicUser };

export type WallBadge = { code: string; name: string; imagery: string; condition: string; earned: boolean; awarded_at: string | null };

export const getMyBadges = (signal?: AbortSignal) =>
  request<{ badges: WallBadge[] }>('/users/me/badges', { signal }).then((d) => d.badges);

export const updateNickname = (nickname: string) =>
  request<UserReply>('/users/me', { method: 'PATCH', body: { nickname } });

export const setPresetAvatar = (preset: number) =>
  request<UserReply>('/users/me/avatar', { method: 'PUT', body: { preset } });

export function uploadAvatar(blob: Blob) {
  const ext = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/png' ? 'png' : 'jpg';
  const body = new FormData();
  body.append('avatar', blob, `avatar.${ext}`);
  return request<UserReply>('/users/me/avatar', { method: 'POST', body });
}

export const changePassword = (current_password: string, new_password: string) =>
  request<{ relogin: true }>('/users/me/password', { method: 'POST', body: { current_password, new_password } });
