import { AppError } from '../errors.js';
import { verifyToken } from '../services/auth.js';
import { findById } from '../services/users.js';

const unauthorized = (code, message) => new AppError(401, code, message);

export async function requireAuth(req, _res, next) {
  try {
    const header = req.get('authorization') || '';
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (!match) throw unauthorized('UNAUTHORIZED', '请先登录');

    let payload;
    try {
      payload = verifyToken(match[1]);
    } catch (err) {
      if (err.name === 'TokenExpiredError') throw unauthorized('TOKEN_EXPIRED', '登录已过期，请重新登录');
      throw unauthorized('UNAUTHORIZED', '请先登录');
    }

    const user = await findById(payload.sub);
    if (!user || user.status !== 1 || user.token_version !== payload.tv) {
      throw unauthorized('TOKEN_REVOKED', '登录已失效，请重新登录');
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}
