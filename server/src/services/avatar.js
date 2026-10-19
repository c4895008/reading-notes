import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { AppError } from '../errors.js';

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_DIR = path.join(config.serverRoot, 'uploads', 'avatars');
export const AVATAR_URL_PREFIX = '/uploads/avatars/';

const EXT_TYPE = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp' };
const TYPE_EXT = { jpeg: 'jpg', png: 'png', webp: 'webp' };
const STORED_NAME_RE = /^[a-f0-9]{32}\.(jpg|png|webp)$/;

export const avatarInvalid = () =>
  new AppError(400, 'AVATAR_INVALID', '这个文件不能用。请换一张 2MB 内的 jpg / png / webp 图片。');

export function detectImageType(buf) {
  if (!Buffer.isBuffer(buf)) return null;
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

// 扩展名、文件头、大小三者都必须通过，且扩展名要与真实格式一致
export function checkAvatarFile(originalName, buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0 || buf.length > AVATAR_MAX_BYTES) return null;
  const ext = path.extname(String(originalName || '')).slice(1).toLowerCase();
  const declared = EXT_TYPE[ext];
  const actual = detectImageType(buf);
  if (!declared || !actual || declared !== actual) return null;
  return TYPE_EXT[actual];
}

export async function storeAvatar(buf, ext) {
  await mkdir(AVATAR_DIR, { recursive: true });
  const name = `${randomBytes(16).toString('hex')}.${ext}`;
  await writeFile(path.join(AVATAR_DIR, name), buf, { flag: 'wx', mode: 0o644 });
  return AVATAR_URL_PREFIX + name;
}

// 只删除本服务生成的文件名，防止路径被拼接到目录之外
export async function removeAvatarFile(url) {
  if (typeof url !== 'string' || !url.startsWith(AVATAR_URL_PREFIX)) return;
  const name = url.slice(AVATAR_URL_PREFIX.length);
  if (!STORED_NAME_RE.test(name)) return;
  await unlink(path.join(AVATAR_DIR, name)).catch(() => {});
}
