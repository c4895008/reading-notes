import type { Badge, PublicUser } from './auth';
import { request } from './client';

export type TalkStatus = 'active' | 'ended' | 'archived';
export type Participant = PublicUser & { is_initiator: boolean; joined_at: string };

export type LastMessage = { sender_id: number; sender_nickname: string; is_mine: boolean; excerpt: string };

export type TalkSummary = {
  id: number;
  title: string;
  layers: number;
  status: TalkStatus;
  is_initiator: boolean;
  participants: Participant[];
  last_message: LastMessage | null;
  unread: number;
  last_message_at: string | null;
  created_at: string;
};

export type SnapshotPart = { title: string; quote: string | null; content: string };

export type Talk = TalkSummary & {
  ended_at: string | null;
  archived_at: string | null;
  snapshot: SnapshotPart & { ancestors: SnapshotPart[]; captured_at: string };
  first_visit: boolean;
  note_has_newer_version: boolean;
};

export type TalkPage = {
  items: TalkSummary[];
  counts: Record<TalkStatus, number>;
  page: number;
  page_size: number;
  has_more: boolean;
};

export type Message = {
  id: number;
  seq: number;
  sender: PublicUser;
  is_initiator: boolean;
  is_mine: boolean;
  content: string;
  client_message_id?: string;
  created_at: string;
};

export type MessagesPage = {
  discussion_id: number;
  status: TalkStatus;
  participants: Participant[];
  messages: Message[];
  has_more: boolean;
};

export type TransitionAction = 'end' | 'reopen' | 'archive' | 'unarchive';

export type InviteResult = { discussion_id: number; invited: PublicUser[]; skipped: number[]; new_badges?: Badge[] };

export const INVITE_LIMIT = 20;
export const MESSAGE_LIMIT = 2000;
export const STATUS_LABEL: Record<TalkStatus, string> = { active: '进行中', ended: '已完结', archived: '已存档' };

const talkPath = (id: string | number) => `/discussions/${encodeURIComponent(id)}`;

export function listTalks(status: TalkStatus, page = 1, signal?: AbortSignal) {
  const params = new URLSearchParams({ status });
  if (page > 1) params.set('page', String(page));
  return request<TalkPage>(`/discussions?${params}`, { signal });
}

export const getTalk = (id: string | number, signal?: AbortSignal) =>
  request<{ discussion: Talk }>(talkPath(id), { signal }).then((d) => d.discussion);

export const startTalk = (noteId: number, inviteeIds: number[]) =>
  request<InviteResult>('/discussions', { method: 'POST', body: { note_id: noteId, invitee_ids: inviteeIds } });

export const inviteToTalk = (id: number, inviteeIds: number[]) =>
  request<InviteResult>(`${talkPath(id)}/invitations`, { method: 'POST', body: { invitee_ids: inviteeIds } });

export const markTalkRead = (id: string | number) =>
  request<{ discussion_id: number }>(`${talkPath(id)}/read`, { method: 'POST' });

export const listMessages = (id: string | number, afterId: number, signal?: AbortSignal) =>
  request<MessagesPage>(`${talkPath(id)}/messages?after_id=${afterId}`, { signal });

export const listLatestMessages = (id: string | number, signal?: AbortSignal) =>
  request<MessagesPage>(`${talkPath(id)}/messages?latest=1`, { signal });

export const listMessagesBefore = (id: string | number, beforeId: number, signal?: AbortSignal) =>
  request<MessagesPage>(`${talkPath(id)}/messages?before_id=${beforeId}`, { signal });

export const sendMessage = (id: number, content: string, clientMessageId: string) =>
  request<{ message: Message; new_badges: Badge[] }>(`${talkPath(id)}/messages`, {
    method: 'POST',
    body: { content, client_message_id: clientMessageId },
  });

export const transitionTalk = (id: number, action: TransitionAction) =>
  request<{ discussion_id: number; status: TalkStatus }>(`${talkPath(id)}/transition`, { method: 'POST', body: { action } });

export const getUnreadTalks = () => request<{ count: number }>('/discussions/unread').then((d) => d.count);
