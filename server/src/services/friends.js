import { pool } from '../db/pool.js';
import { AppError } from '../errors.js';
import { FRIENDSHIP, checkSend, pairKey, planRespond, relationOf } from './friendship.js';
import { fillBadges } from './badges.js';
import { toPublicUser } from './users.js';

export const SEARCH_LIMIT = 20;
export const LIST_PAGE = { default: 20, max: 50 };

const USER_COLS = 'u.id, u.username, u.nickname, u.avatar_type, u.avatar_preset, u.avatar_url, u.status';
const LIVE_COLS = 'id, requester_id, addressee_id, status';

const escapeLike = (s) => s.replace(/[\\%_]/g, '\\$&');

async function findLive(a, b) {
  const [rows] = await pool.query(`SELECT ${LIVE_COLS} FROM friendship WHERE live_pair = ?`, [pairKey(a, b)]);
  return rows[0] || null;
}

export async function areFriends(a, b, conn = pool) {
  const [rows] = await conn.query('SELECT 1 FROM friendship WHERE live_pair = ? AND status = ?', [
    pairKey(a, b),
    FRIENDSHIP.ACCEPTED,
  ]);
  return rows.length > 0;
}

// 用户名精确 + 昵称模糊；排除自己与停用账号；只返回公开字段
export async function searchUsers(meId, q) {
  const [rows] = await pool.query(
    `SELECT ${USER_COLS} FROM \`user\` u
      WHERE u.status = 1 AND u.id <> ? AND (u.username = ? OR u.nickname LIKE ?)
      ORDER BY (u.username = ?) DESC, CHAR_LENGTH(u.nickname), u.id
      LIMIT ?`,
    [meId, q.toLowerCase(), `%${escapeLike(q)}%`, q.toLowerCase(), SEARCH_LIMIT],
  );
  if (!rows.length) return [];

  const [lives] = await pool.query(`SELECT ${LIVE_COLS}, live_pair FROM friendship WHERE live_pair IN (?)`, [
    rows.map((u) => pairKey(meId, u.id)),
  ]);
  const byPair = new Map(lives.map((l) => [l.live_pair, l]));
  return fillBadges(rows.map((u) => ({ ...toPublicUser(u), ...relationOf(byPair.get(pairKey(meId, u.id)) ?? null, meId) })));
}

export async function listFriends(meId, { page, pageSize }) {
  const from = `FROM friendship f
       JOIN \`user\` u ON u.id = IF(f.requester_id = ?, f.addressee_id, f.requester_id)
      WHERE f.status = ? AND (f.requester_id = ? OR f.addressee_id = ?) AND u.status = 1`;
  const args = [meId, FRIENDSHIP.ACCEPTED, meId, meId];
  const [[rows], [[countRow]]] = await Promise.all([
    pool.query(`SELECT ${USER_COLS}, f.responded_at AS since ${from} ORDER BY f.responded_at DESC, f.id DESC LIMIT ? OFFSET ?`, [
      ...args,
      pageSize + 1,
      (page - 1) * pageSize,
    ]),
    pool.query(`SELECT COUNT(*) AS n ${from}`, args),
  ]);
  const items = rows.slice(0, pageSize).map((r) => ({ ...toPublicUser(r), since: r.since }));
  return {
    items: await fillBadges(items),
    page,
    page_size: pageSize,
    total: Number(countRow.n),
    has_more: rows.length > pageSize,
  };
}

export async function listRequests(meId, type, { page, pageSize }) {
  const [mine, other] = type === 'in' ? ['addressee_id', 'requester_id'] : ['requester_id', 'addressee_id'];
  const from = `FROM friendship f
       JOIN \`user\` u ON u.id = f.${other}
      WHERE f.${mine} = ? AND f.status = ? AND u.status = 1`;
  const args = [meId, FRIENDSHIP.PENDING];
  const [[rows], [[countRow]]] = await Promise.all([
    pool.query(
      `SELECT f.id AS request_id, f.created_at AS requested_at, ${USER_COLS} ${from} ORDER BY f.created_at DESC, f.id DESC LIMIT ? OFFSET ?`,
      [...args, pageSize + 1, (page - 1) * pageSize],
    ),
    pool.query(`SELECT COUNT(*) AS n ${from}`, args),
  ]);
  const requests = rows.slice(0, pageSize).map((r) => ({ id: r.request_id, user: toPublicUser(r), created_at: r.requested_at }));
  await fillBadges(requests.map((r) => r.user));
  return {
    items: requests,
    page,
    page_size: pageSize,
    total: Number(countRow.n),
    has_more: rows.length > pageSize,
  };
}

// 校验能否向该用户名发申请；通过时返回目标用户行
export async function resolveSendTarget(meId, username) {
  const [rows] = await pool.query(`SELECT ${USER_COLS} FROM \`user\` u WHERE u.username = ?`, [username.toLowerCase()]);
  const target = rows[0] || null;
  checkSend(meId, target, target ? await findLive(meId, target.id) : null);
  return target;
}

export async function createRequest(meId, target) {
  try {
    const [res] = await pool.query('INSERT INTO friendship (requester_id, addressee_id, status) VALUES (?, ?, ?)', [
      meId,
      target.id,
      FRIENDSHIP.PENDING,
    ]);
    const [[row]] = await pool.query('SELECT created_at FROM friendship WHERE id = ?', [res.insertId]);
    const [user] = await fillBadges([toPublicUser(target)]);
    return { id: res.insertId, user, created_at: row.created_at };
  } catch (err) {
    // 并发下对方同时发来申请、或重复提交：唯一约束兜底，按此刻的真实关系给出提示
    if (err.code !== 'ER_DUP_ENTRY') throw err;
    checkSend(meId, target, await findLive(meId, target.id));
    throw new AppError(409, 'REQUEST_EXISTS', '申请状态已变化，请刷新后再试');
  }
}

async function respond(meId, requestId, action) {
  const [rows] = await pool.query(`SELECT ${LIVE_COLS} FROM friendship WHERE id = ?`, [requestId]);
  const row = rows[0] || null;
  const { by, status } = planRespond(row, meId, action);
  const timeCol = status === FRIENDSHIP.WITHDRAWN ? 'ended_at' : 'responded_at';
  // 条件更新防并发：同意与撤回同时到达时只有一方生效
  const [res] = await pool.query(
    `UPDATE friendship SET status = ?, ${timeCol} = CURRENT_TIMESTAMP(3) WHERE id = ? AND ${by} = ? AND status = ?`,
    [status, requestId, meId, FRIENDSHIP.PENDING],
  );
  if (res.affectedRows !== 1) planRespond(null, meId, action);
  return row;
}

export async function acceptRequest(meId, requestId) {
  const row = await respond(meId, requestId, 'accept');
  const [friends] = await pool.query(
    `SELECT ${USER_COLS}, f.responded_at AS since FROM friendship f JOIN \`user\` u ON u.id = f.requester_id WHERE f.id = ?`,
    [row.id],
  );
  const f = friends[0];
  const [friend] = await fillBadges([{ ...toPublicUser(f), since: f.since }]);
  return friend;
}

export const rejectRequest = (meId, requestId) => respond(meId, requestId, 'reject');
export const withdrawRequest = (meId, requestId) => respond(meId, requestId, 'withdraw');

// 只改关系状态；笔谈参与记录与消息全部保留，资格由「是否互为读友」动态判定
export async function removeFriend(meId, otherId) {
  const [res] = await pool.query(
    'UPDATE friendship SET status = ?, ended_at = CURRENT_TIMESTAMP(3) WHERE live_pair = ? AND status = ?',
    [FRIENDSHIP.REMOVED, pairKey(meId, otherId), FRIENDSHIP.ACCEPTED],
  );
  if (res.affectedRows !== 1) throw new AppError(404, 'NOT_FRIENDS', '你们已经不是读友了');
}
