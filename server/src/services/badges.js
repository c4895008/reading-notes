import { pool } from '../db/pool.js';
import { CATALOG, earnedCodes, evaluationPlan, publicBadges } from './badge.js';

async function heldCodes(userId) {
  const [rows] = await pool.query('SELECT badge_code FROM user_badge WHERE user_id = ?', [userId]);
  return new Set(rows.map((r) => r.badge_code));
}

// 只查本次候选徽章需要的统计项
async function statsFor(userId, codes) {
  const stats = {};
  const jobs = [];
  if (codes.includes('icebreaker') || codes.includes('companion')) {
    jobs.push(
      pool
        .query(
          `SELECT COUNT(DISTINCT m.discussion_id) AS n
             FROM message m JOIN discussion d ON d.id = m.discussion_id
            WHERE m.sender_id = ? AND d.initiator_id <> m.sender_id`,
          [userId],
        )
        .then(([[r]]) => (stats.readerTalks = Number(r.n))),
    );
  }
  if (codes.includes('kindler')) {
    jobs.push(
      pool.query('SELECT COUNT(*) AS n FROM discussion WHERE initiator_id = ?', [userId]).then(([[r]]) => (stats.initiated = Number(r.n))),
    );
  }
  if (codes.includes('fullhouse')) {
    jobs.push(
      pool
        .query(
          `SELECT COALESCE(MAX(n), 0) AS n FROM (
             SELECT COUNT(DISTINCT m.sender_id) AS n
               FROM discussion d JOIN message m ON m.discussion_id = d.id
              WHERE d.initiator_id = ? AND m.sender_id <> d.initiator_id
              GROUP BY d.id) t`,
          [userId],
        )
        .then(([[r]]) => (stats.maxReaderSenders = Number(r.n))),
    );
  }
  await Promise.all(jobs);
  return stats;
}

// 返回本次新授予的代码；并发评估由唯一约束兜底，只有真正插入的那一方算「新获得」
async function award(userId, candidates) {
  const held = await heldCodes(userId);
  const pending = candidates.filter((c) => !held.has(c));
  if (!pending.length) return [];
  const earned = earnedCodes(await statsFor(userId, pending)).filter((c) => pending.includes(c));
  const fresh = [];
  for (const code of earned) {
    const [res] = await pool.query('INSERT IGNORE INTO user_badge (user_id, badge_code) VALUES (?, ?)', [userId, code]);
    if (res.affectedRows === 1) fresh.push(code);
  }
  return fresh;
}

// 主事务提交后调用；失败只记录、不抛出，主操作照常成功（下次同类事件会重新评估）
export async function evaluateBadges(event) {
  try {
    const plan = evaluationPlan(event);
    const results = await Promise.all(plan.map((p) => award(p.userId, p.codes)));
    return publicBadges(results[0] ?? []);
  } catch (err) {
    console.error(`[badge] evaluate ${event.type} failed`, err.code || err.message);
    return [];
  }
}

// 原地填充公开用户对象的 badges（至多为目录全集 4 枚）
export async function fillBadges(users) {
  const ids = [...new Set(users.map((u) => u.user_id))];
  if (!ids.length) return users;
  const [rows] = await pool.query('SELECT user_id, badge_code FROM user_badge WHERE user_id IN (?)', [ids]);
  const byUser = new Map();
  for (const r of rows) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id).push(r.badge_code);
  }
  for (const u of users) u.badges = publicBadges(byUser.get(u.user_id) ?? []);
  return users;
}

export async function badgeWall(userId) {
  const [rows] = await pool.query('SELECT badge_code, awarded_at FROM user_badge WHERE user_id = ?', [userId]);
  const at = new Map(rows.map((r) => [r.badge_code, r.awarded_at]));
  return CATALOG.map((b) => ({ ...b, earned: at.has(b.code), awarded_at: at.get(b.code) ?? null }));
}
