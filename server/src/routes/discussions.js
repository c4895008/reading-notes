import { Router } from 'express';
import { ah } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { evaluateBadges, fillBadges } from '../services/badges.js';
import { STATUS_CODE, TRANSITION_ACTIONS, discussionNotFound, parseInviteeIds, parseMessageInput } from '../services/discussion.js';
import {
  createDiscussion,
  getDiscussion,
  inviteMore,
  listDiscussions,
  listMessages,
  markRead,
  sendMessage,
  transition,
  unreadDiscussionCount,
} from '../services/discussions.js';
import { assertValid, readBody } from '../validate.js';

export const discussionsRouter = Router();
discussionsRouter.use(requireAuth);

const ID_RE = /^[1-9]\d{0,15}$/;
const CURSOR_RE = /^(0|[1-9]\d{0,15})$/;
const PAGE_SIZE = { default: 20, max: 50 };
const inviteLimit = rateLimit({ windowMs: 60_000, max: 30, key: (req) => req.user.id });
const messageLimit = rateLimit({ windowMs: 60_000, max: 30, key: (req) => req.user.id });

function discussionId(req) {
  const id = Number(req.params.id);
  if (!ID_RE.test(req.params.id) || !Number.isSafeInteger(id)) throw discussionNotFound();
  return id;
}

function positiveInt(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return typeof value === 'string' && /^[1-9]\d{0,5}$/.test(value) ? Number(value) : NaN;
}

discussionsRouter.get(
  '/',
  ah(async (req, res) => {
    const { status = 'active' } = req.query;
    const page = positiveInt(req.query.page, 1);
    const pageSize = positiveInt(req.query.page_size, PAGE_SIZE.default);
    assertValid({
      status: typeof status === 'string' && Object.hasOwn(STATUS_CODE, status) ? null : '不支持的分组',
      page: Number.isNaN(page) ? '页码不正确' : null,
      page_size: Number.isNaN(pageSize) || pageSize > PAGE_SIZE.max ? `每页 1–${PAGE_SIZE.max} 条` : null,
    });
    res.json({ data: await listDiscussions(req.user.id, STATUS_CODE[status], { page, pageSize }) });
  }),
);

discussionsRouter.get(
  '/unread',
  ah(async (req, res) => {
    res.json({ data: { count: await unreadDiscussionCount(req.user.id) } });
  }),
);

discussionsRouter.post(
  '/',
  inviteLimit,
  ah(async (req, res) => {
    const body = readBody(req.body, ['note_id', 'invitee_ids']);
    const noteId = body.note_id;
    assertValid({ note_id: Number.isSafeInteger(noteId) && noteId > 0 ? null : '请指定笔记' });
    const inviteeIds = parseInviteeIds(body.invitee_ids, { required: false });
    const created = await createDiscussion(req.user.id, noteId, inviteeIds);
    const newBadges = await evaluateBadges({ type: 'discussion_created', initiatorId: req.user.id });
    res.status(201).json({ data: { ...created, new_badges: newBadges } });
  }),
);

discussionsRouter.get(
  '/:id',
  ah(async (req, res) => {
    res.json({ data: { discussion: await getDiscussion(req.user.id, discussionId(req)) } });
  }),
);

discussionsRouter.post(
  '/:id/invitations',
  inviteLimit,
  ah(async (req, res) => {
    const id = discussionId(req);
    const body = readBody(req.body, ['invitee_ids']);
    const inviteeIds = parseInviteeIds(body.invitee_ids, { required: true });
    res.json({ data: await inviteMore(req.user.id, id, inviteeIds) });
  }),
);

discussionsRouter.post(
  '/:id/read',
  ah(async (req, res) => {
    const id = discussionId(req);
    await markRead(req.user.id, id);
    res.json({ data: { discussion_id: id } });
  }),
);

const validCursor = (value) => typeof value === 'string' && CURSOR_RE.test(value) && Number.isSafeInteger(Number(value));

discussionsRouter.get(
  '/:id/messages',
  ah(async (req, res) => {
    const id = discussionId(req);
    const { after_id: after, before_id: before, latest } = req.query;
    const modes = [after !== undefined, before !== undefined, latest !== undefined].filter(Boolean).length;
    assertValid({
      after_id: after === undefined || validCursor(after) ? null : '游标不正确',
      before_id: before === undefined || validCursor(before) ? null : '游标不正确',
      latest: latest === undefined || latest === '1' ? null : '参数不正确',
      cursor: modes <= 1 ? null : '游标参数不能同时使用',
    });
    const cursor = before !== undefined ? { beforeId: Number(before) } : latest !== undefined ? { latest: true } : { afterId: Number(after ?? '0') };
    res.json({ data: await listMessages(req.user.id, id, cursor) });
  }),
);

discussionsRouter.post(
  '/:id/messages',
  messageLimit,
  ah(async (req, res) => {
    const id = discussionId(req);
    const input = parseMessageInput(readBody(req.body, ['content', 'client_message_id']));
    const { message, created, initiatorId } = await sendMessage(req.user.id, id, input);
    // 幂等重放也重新评估：上次评估若失败，重试即补发
    const newBadges = await evaluateBadges({ type: 'message_sent', senderId: req.user.id, initiatorId });
    await fillBadges([message.sender]);
    res.status(created ? 201 : 200).json({ data: { message, new_badges: newBadges } });
  }),
);

discussionsRouter.post(
  '/:id/transition',
  ah(async (req, res) => {
    const id = discussionId(req);
    const { action } = readBody(req.body, ['action']);
    assertValid({ action: TRANSITION_ACTIONS.includes(action) ? null : '不支持的操作' });
    res.json({ data: await transition(req.user.id, id, action) });
  }),
);
