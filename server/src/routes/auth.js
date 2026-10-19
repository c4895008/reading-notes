import { Router } from 'express';
import { AppError, ah } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';
import { createLimiter, rateLimit, tooManyRequests } from '../middleware/rateLimit.js';
import { hashPassword, signToken, verifyPassword } from '../services/auth.js';
import { createUser, findByUsername, toPublicUserWithBadges, usernameExists } from '../services/users.js';
import { assertValid, checkNickname, checkPassword, checkUsername, readBody } from '../validate.js';

export const authRouter = Router();

const MIN = 60_000;
const registerLimit = rateLimit({ windowMs: 60 * MIN, max: 10 });
const usernameCheckLimit = rateLimit({ windowMs: MIN, max: 60 });
// 登录只累计失败次数；成功后清零该账号计数
const loginFailByAccount = createLimiter({ windowMs: 15 * MIN, max: 5 });
const loginFailByIp = createLimiter({ windowMs: 15 * MIN, max: 20 });

const session = async (user) => ({ token: signToken(user), user: await toPublicUserWithBadges(user) });

authRouter.get(
  '/username-available',
  usernameCheckLimit,
  ah(async (req, res) => {
    const username = typeof req.query.username === 'string' ? req.query.username : '';
    assertValid({ username: checkUsername(username) });
    res.json({ data: { available: !(await usernameExists(username.toLowerCase())) } });
  }),
);

authRouter.post(
  '/register',
  registerLimit,
  ah(async (req, res) => {
    const body = readBody(req.body, ['username', 'password', 'nickname']);
    const hasNickname = body.nickname !== undefined && body.nickname !== null && body.nickname !== '';
    assertValid({
      username: checkUsername(body.username),
      password: checkPassword(body.password),
      nickname: hasNickname ? checkNickname(body.nickname) : null,
    });

    const user = await createUser({
      username: body.username.toLowerCase(),
      passwordHash: await hashPassword(body.password),
      nickname: hasNickname ? body.nickname.trim() : body.username,
    });
    res.status(201).json({ data: await session(user) });
  }),
);

authRouter.post(
  '/login',
  ah(async (req, res) => {
    const body = readBody(req.body, ['username', 'password']);
    if (typeof body.username !== 'string' || typeof body.password !== 'string' || !body.username || !body.password) {
      throw new AppError(400, 'VALIDATION_ERROR', '请填写用户名和密码');
    }

    const username = body.username.trim().toLowerCase().slice(0, 40);
    const ip = req.ip;
    if (loginFailByIp.isLimited(ip) || loginFailByAccount.isLimited(username)) throw tooManyRequests();

    const user = await findByUsername(username);
    const ok = await verifyPassword(body.password, user?.password_hash);

    if (!user || !ok || user.status !== 1) {
      loginFailByIp.hit(ip);
      loginFailByAccount.hit(username);
      throw new AppError(401, 'INVALID_CREDENTIALS', '用户名或密码不正确');
    }

    loginFailByAccount.reset(username);
    res.json({ data: await session(user) });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  ah(async (req, res) => {
    res.json({ data: { user: await toPublicUserWithBadges(req.user) } });
  }),
);
