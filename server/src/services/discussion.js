import { AppError, validationError } from '../errors.js';
import { charLength } from '../validate.js';

export const DISCUSSION = { ACTIVE: 1, ENDED: 2, ARCHIVED: 3 };
export const STATUS_NAME = { 1: 'active', 2: 'ended', 3: 'archived' };
export const STATUS_CODE = { active: 1, ended: 2, archived: 3 };
export const INVITE_LIMIT = 20;

export const discussionNotFound = () => new AppError(404, 'DISCUSSION_NOT_FOUND', '无权访问或不存在');
export const discussionExists = (discussionId) =>
  new AppError(409, 'DISCUSSION_EXISTS', '这条笔记已经有一场笔谈了', { discussion_id: discussionId });

// 参与资格（动态判定）：有参与者记录，且本人即发起人或与发起人互为读友
export const isEligible = ({ hasRow, isInitiator, isFriend }) => Boolean(hasRow && (isInitiator || isFriend));

export function parseInviteeIds(raw, { required }) {
  if (raw === undefined && !required) return [];
  if (!Array.isArray(raw) || !raw.every((id) => Number.isSafeInteger(id) && id > 0)) {
    throw validationError({ invitee_ids: '受邀读友格式不正确' });
  }
  const ids = [...new Set(raw)];
  if (required && ids.length === 0) throw validationError({ invitee_ids: '请选择要邀请的读友' });
  if (ids.length > INVITE_LIMIT) throw validationError({ invitee_ids: `单次最多邀请 ${INVITE_LIMIT} 位读友` });
  return ids;
}

// 已在场者（含发起人自己）跳过；其余必须全部是发起人的读友，否则整单拒绝
export function planInvite(initiatorId, inviteeIds, { participantIds, friendIds }) {
  const present = new Set([initiatorId, ...participantIds]);
  const friends = new Set(friendIds);
  const skipped = inviteeIds.filter((id) => present.has(id));
  const add = inviteeIds.filter((id) => !present.has(id));
  const strangers = add.filter((id) => !friends.has(id));
  if (strangers.length) {
    throw new AppError(403, 'INVITEE_NOT_FRIEND', '只能邀请你的读友', { user_ids: strangers });
  }
  return { add, skipped };
}

// 状态机：动作 → 允许的起点与终点（见 PRD 3.6.1）
const TRANSITIONS = {
  end: { from: DISCUSSION.ACTIVE, to: DISCUSSION.ENDED },
  reopen: { from: DISCUSSION.ENDED, to: DISCUSSION.ACTIVE },
  archive: { from: DISCUSSION.ENDED, to: DISCUSSION.ARCHIVED },
  unarchive: { from: DISCUSSION.ARCHIVED, to: DISCUSSION.ENDED },
};
export const TRANSITION_ACTIONS = Object.keys(TRANSITIONS);

// 身份先于状态：读友调用任何动作都是 403，不暴露当前状态是否允许
export function planTransition(discussion, meId, action) {
  if (discussion.initiator_id !== meId) throw new AppError(403, 'NOT_INITIATOR', '只有发起人可以变更笔谈状态');
  const rule = TRANSITIONS[action];
  if (discussion.status !== rule.from) {
    throw new AppError(409, 'INVALID_TRANSITION', '笔谈当前状态不支持这个操作', { status: STATUS_NAME[discussion.status] });
  }
  return rule.to;
}

export const MESSAGE_LIMIT = 2000;
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MESSAGE_CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f]/;

export function parseMessageInput(body) {
  const errors = {};
  let content = null;
  if (typeof body.content !== 'string') errors.content = '请填写内容';
  else {
    content = body.content.replace(/\r\n?/g, '\n').trim();
    if (!content) errors.content = '请填写内容';
    else if (charLength(content) > MESSAGE_LIMIT) errors.content = `一条最多 ${MESSAGE_LIMIT} 字`;
    else if (MESSAGE_CONTROL_RE.test(content)) errors.content = '内容包含不支持的字符';
  }
  if (typeof body.client_message_id !== 'string' || !CLIENT_ID_RE.test(body.client_message_id)) {
    errors.client_message_id = '消息标识不正确';
  }
  if (Object.keys(errors).length) throw validationError(errors);
  return { content, clientMessageId: body.client_message_id };
}

export function assertCanSend(discussion) {
  if (discussion.status !== DISCUSSION.ACTIVE) {
    throw new AppError(409, 'DISCUSSION_NOT_ACTIVE', discussion.status === DISCUSSION.ARCHIVED ? '这场笔谈已存档' : '这场笔谈已完结，仅可回看');
  }
}

// 列表摘要：换行折成空格，按字符（非 UTF-16 单元）截断
export function excerpt(content, max = 40) {
  const chars = [...content.replace(/\s+/g, ' ').trim()];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join('');
}

export function assertCanInvite(discussion, meId) {
  if (discussion.initiator_id !== meId) throw new AppError(403, 'NOT_INITIATOR', '只有发起人可以邀请读友');
  if (discussion.status !== DISCUSSION.ACTIVE) {
    throw new AppError(409, 'DISCUSSION_NOT_ACTIVE', '这场笔谈已完结，不能再邀请读友');
  }
}
