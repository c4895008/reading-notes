import { pool, withTransaction } from '../db/pool.js';
import { AppError } from '../errors.js';
import { fillBadges } from './badges.js';

export const PRESET_COUNT = 10;

// 按 ID 稳定分配：同一用户永远得到同一款
export const presetForId = (id) => ((Number(id) - 1) % PRESET_COUNT) + 1;

const COLUMNS = 'id, username, password_hash, nickname, avatar_type, avatar_preset, avatar_url, token_version, status';

export async function findByUsername(username) {
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM \`user\` WHERE username = ?`, [username]);
  return rows[0] || null;
}

export async function findById(id) {
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM \`user\` WHERE id = ?`, [id]);
  return rows[0] || null;
}

export async function usernameExists(username) {
  const [rows] = await pool.query('SELECT 1 FROM `user` WHERE username = ?', [username]);
  return rows.length > 0;
}

export async function createUser({ username, passwordHash, nickname }) {
  try {
    return await withTransaction(async (conn) => {
      const [res] = await conn.query(
        'INSERT INTO `user` (username, password_hash, nickname, avatar_type) VALUES (?, ?, ?, 1)',
        [username, passwordHash, nickname],
      );
      const id = res.insertId;
      await conn.query('UPDATE `user` SET avatar_preset = ? WHERE id = ?', [presetForId(id), id]);
      const [rows] = await conn.query(`SELECT ${COLUMNS} FROM \`user\` WHERE id = ?`, [id]);
      return rows[0];
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      throw new AppError(409, 'USERNAME_TAKEN', '这个用户名已经被使用了', { fields: { username: '这个用户名已经被使用了' } });
    }
    throw err;
  }
}

export async function updateNickname(id, nickname) {
  await pool.query('UPDATE `user` SET nickname = ? WHERE id = ?', [nickname, id]);
  return findById(id);
}

// 返回被替换下来的自定义头像地址，由调用方在提交后清理文件
async function replaceAvatar(id, { type, preset, url }) {
  return withTransaction(async (conn) => {
    const [[prev]] = await conn.query('SELECT avatar_url FROM `user` WHERE id = ? FOR UPDATE', [id]);
    if (type === 'preset') {
      await conn.query('UPDATE `user` SET avatar_type = 1, avatar_preset = ?, avatar_url = NULL WHERE id = ?', [preset, id]);
    } else {
      await conn.query('UPDATE `user` SET avatar_type = 2, avatar_url = ? WHERE id = ?', [url, id]);
    }
    const [rows] = await conn.query(`SELECT ${COLUMNS} FROM \`user\` WHERE id = ?`, [id]);
    return { user: rows[0], replacedUrl: prev?.avatar_url && prev.avatar_url !== url ? prev.avatar_url : null };
  });
}

export const setPresetAvatar = (id, preset) => replaceAvatar(id, { type: 'preset', preset });
export const setCustomAvatar = (id, url) => replaceAvatar(id, { type: 'custom', url });

// token_version 递增后，所有已签发的 Token（含当前这一个）立即失效
export async function updatePassword(id, passwordHash) {
  await pool.query('UPDATE `user` SET password_hash = ?, token_version = token_version + 1 WHERE id = ?', [passwordHash, id]);
}

// 公开用户对象（PRD 8.1）；badges 由 fillBadges 批量填充
export function toPublicUser(row, badges = []) {
  return {
    user_id: row.id,
    username: row.username,
    nickname: row.nickname,
    avatar:
      row.avatar_type === 2 && row.avatar_url
        ? { type: 'custom', url: row.avatar_url }
        : { type: 'preset', preset: row.avatar_preset || presetForId(row.id) },
    badges,
  };
}

export const toPublicUserWithBadges = async (row) => (await fillBadges([toPublicUser(row)]))[0];
