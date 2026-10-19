import { Router } from 'express';
import multer from 'multer';
import { AppError, ah, validationError } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';
import { createLimiter, rateLimit, tooManyRequests } from '../middleware/rateLimit.js';
import { hashPassword, verifyPassword } from '../services/auth.js';
import { AVATAR_MAX_BYTES, avatarInvalid, checkAvatarFile, removeAvatarFile, storeAvatar } from '../services/avatar.js';
import { badgeWall } from '../services/badges.js';
import { PRESET_COUNT, setCustomAvatar, setPresetAvatar, toPublicUserWithBadges, updateNickname, updatePassword } from '../services/users.js';
import { assertValid, checkNickname, checkPassword, readBody } from '../validate.js';

const MIN = 60_000;
const byUser = (req) => req.user.id;

export const meRouter = Router();
meRouter.use(requireAuth);

const reply = async (res, user) => res.json({ data: { user: await toPublicUserWithBadges(user) } });

meRouter.get(
  '/badges',
  ah(async (req, res) => {
    res.json({ data: { badges: await badgeWall(req.user.id) } });
  }),
);

meRouter.patch(
  '/',
  ah(async (req, res) => {
    const body = readBody(req.body, ['nickname']);
    assertValid({ nickname: checkNickname(body.nickname) });
    await reply(res, await updateNickname(req.user.id, body.nickname.trim()));
  }),
);

meRouter.put(
  '/avatar',
  ah(async (req, res) => {
    const { preset } = readBody(req.body, ['preset']);
    if (!Number.isInteger(preset) || preset < 1 || preset > PRESET_COUNT) {
      throw validationError({ preset: `请选择 1–${PRESET_COUNT} 号预置头像` });
    }
    const { user, replacedUrl } = await setPresetAvatar(req.user.id, preset);
    await removeAvatarFile(replacedUrl);
    await reply(res, user);
  }),
);

const uploadLimit = rateLimit({ windowMs: MIN, max: 10, key: byUser });
const parseAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_BYTES, files: 1, fields: 0, parts: 1, fieldNameSize: 32 },
}).single('avatar');

meRouter.post(
  '/avatar',
  uploadLimit,
  (req, res, next) => parseAvatar(req, res, (err) => next(err ? avatarInvalid() : undefined)),
  ah(async (req, res) => {
    const ext = req.file && checkAvatarFile(req.file.originalname, req.file.buffer);
    if (!ext) throw avatarInvalid();
    const url = await storeAvatar(req.file.buffer, ext);
    let result;
    try {
      result = await setCustomAvatar(req.user.id, url);
    } catch (err) {
      await removeAvatarFile(url);
      throw err;
    }
    await removeAvatarFile(result.replacedUrl);
    await reply(res, result.user);
  }),
);

// 只累计「当前密码错误」，防止持有他人 Token 时暴力试探原密码
const passwordFails = createLimiter({ windowMs: 15 * MIN, max: 5 });

meRouter.post(
  '/password',
  ah(async (req, res) => {
    const body = readBody(req.body, ['current_password', 'new_password']);
    if (typeof body.current_password !== 'string' || !body.current_password) {
      throw validationError({ current_password: '请填写当前密码' });
    }
    assertValid({ new_password: checkPassword(body.new_password) });
    if (passwordFails.isLimited(req.user.id)) throw tooManyRequests();

    if (!(await verifyPassword(body.current_password, req.user.password_hash))) {
      passwordFails.hit(req.user.id);
      throw new AppError(400, 'WRONG_PASSWORD', '当前密码不正确', { fields: { current_password: '当前密码不正确' } });
    }
    if (body.new_password === body.current_password) {
      throw validationError({ new_password: '新密码不能与当前密码相同' });
    }

    passwordFails.reset(req.user.id);
    await updatePassword(req.user.id, await hashPassword(body.new_password));
    res.json({ data: { relogin: true } });
  }),
);
