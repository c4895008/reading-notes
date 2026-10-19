import { Router } from 'express';
import { AppError, ah, validationError } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';
import { createLimiter, rateLimit, tooManyRequests } from '../middleware/rateLimit.js';
import {
  acceptRequest,
  createRequest,
  LIST_PAGE,
  listFriends,
  listRequests,
  rejectRequest,
  removeFriend,
  resolveSendTarget,
  searchUsers,
  withdrawRequest,
} from '../services/friends.js';
import { requestNotFound } from '../services/friendship.js';
import { assertValid, charLength, checkUsername, readBody } from '../validate.js';

const MIN = 60_000;
const byUser = (req) => req.user.id;
const ID_RE = /^[1-9]\d{0,15}$/;

function idParam(value, notFound) {
  const id = Number(value);
  if (!ID_RE.test(value) || !Number.isSafeInteger(id)) throw notFound();
  return id;
}

export const usersRouter = Router();
usersRouter.use(requireAuth);

const SEARCH_MAX = 20;
const searchLimit = rateLimit({ windowMs: MIN, max: 30, key: byUser });

usersRouter.get(
  '/search',
  searchLimit,
  ah(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : null;
    if (q === null) throw validationError({ q: '搜索词格式不正确' });
    if (charLength(q) > SEARCH_MAX) throw validationError({ q: `搜索词最多 ${SEARCH_MAX} 字` });
    res.json({ data: { items: q ? await searchUsers(req.user.id, q) : [] } });
  }),
);

export const friendsRouter = Router();
friendsRouter.use(requireAuth);

const PAGE_RE = /^[1-9]\d{0,5}$/;
const SIZE_RE = /^[1-9]\d{0,2}$/;

function pageParams(query) {
  const page = query.page ?? '1';
  const size = query.page_size ?? String(LIST_PAGE.default);
  assertValid({
    page: typeof page === 'string' && PAGE_RE.test(page) ? null : '页码不正确',
    page_size:
      typeof size === 'string' && SIZE_RE.test(size) && Number(size) <= LIST_PAGE.max ? null : `每页最多 ${LIST_PAGE.max} 条`,
  });
  return { page: Number(page), pageSize: Number(size) };
}

const sendLimit = rateLimit({ windowMs: MIN, max: 30, key: byUser });
const dailySends = createLimiter({ windowMs: 24 * 60 * MIN, max: 50 });
// 被拒绝后，对同一目标至少间隔 1 分钟才能再次申请
const afterReject = createLimiter({ windowMs: MIN, max: 1 });

friendsRouter.get(
  '/',
  ah(async (req, res) => {
    res.json({ data: await listFriends(req.user.id, pageParams(req.query)) });
  }),
);

friendsRouter.get(
  '/requests',
  ah(async (req, res) => {
    const { type } = req.query;
    if (type !== 'in' && type !== 'out') throw validationError({ type: '请指定 in 或 out' });
    res.json({ data: await listRequests(req.user.id, type, pageParams(req.query)) });
  }),
);

friendsRouter.post(
  '/requests',
  sendLimit,
  ah(async (req, res) => {
    const { username } = readBody(req.body, ['username']);
    const invalid = checkUsername(username);
    if (invalid) throw new AppError(404, 'USER_NOT_FOUND', '没有找到这位用户');

    const meId = req.user.id;
    const target = await resolveSendTarget(meId, username);
    if (dailySends.isLimited(meId) || afterReject.isLimited(`${meId}:${target.id}`)) throw tooManyRequests();

    const request = await createRequest(meId, target);
    dailySends.hit(meId);
    res.status(201).json({ data: { request } });
  }),
);

friendsRouter.post(
  '/requests/:id/accept',
  ah(async (req, res) => {
    const friend = await acceptRequest(req.user.id, idParam(req.params.id, requestNotFound));
    res.json({ data: { friend } });
  }),
);

friendsRouter.post(
  '/requests/:id/reject',
  ah(async (req, res) => {
    const id = idParam(req.params.id, requestNotFound);
    const row = await rejectRequest(req.user.id, id);
    afterReject.hit(`${row.requester_id}:${req.user.id}`);
    res.json({ data: { id } });
  }),
);

friendsRouter.delete(
  '/requests/:id',
  ah(async (req, res) => {
    const id = idParam(req.params.id, requestNotFound);
    await withdrawRequest(req.user.id, id);
    res.json({ data: { id } });
  }),
);

const notFriends = () => new AppError(404, 'NOT_FRIENDS', '你们已经不是读友了');

friendsRouter.delete(
  '/:userId',
  ah(async (req, res) => {
    const userId = idParam(req.params.userId, notFriends);
    await removeFriend(req.user.id, userId);
    res.json({ data: { user_id: userId } });
  }),
);
