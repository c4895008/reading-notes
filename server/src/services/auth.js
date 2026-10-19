import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export const hashPassword = (plain) => bcrypt.hash(plain, config.bcryptCost);

// 用户不存在时与一个固定哈希比对，使响应耗时一致，避免借时间差枚举用户名
const DUMMY_HASH = bcrypt.hashSync('reading-notes-timing-guard', config.bcryptCost);

export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash || DUMMY_HASH);

export function signToken(user) {
  return jwt.sign({ tv: user.token_version }, config.jwt.secret, {
    algorithm: 'HS256',
    expiresIn: config.jwt.expiresIn,
    subject: String(user.id),
  });
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
}
