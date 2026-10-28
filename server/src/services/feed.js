import { pool, withTransaction } from '../db/pool.js';
import { AppError } from '../errors.js';
import { FRIENDSHIP, pairKey } from './friendship.js';
import { ACTIVE, kindName } from './notes.js';
import { toPublicUser } from './users.js';

export const feedNoteNotFound = () => new AppError(404, 'FEED_NOTE_NOT_FOUND', '无权访问或不存在');

const AUTHOR_COLUMNS = 'u.id AS author_id, u.username, u.nickname, u.avatar_type, u.avatar_preset, u.avatar_url';
const LIKE_COLUMNS = `(SELECT COUNT(*) FROM note_like nl WHERE nl.note_id = n.id) AS like_count,
  EXISTS (SELECT 1 FROM note_like nl WHERE nl.note_id = n.id AND nl.user_id = ?) AS liked`;

// 每次查询在 SQL 内按当前已接受的关系过滤，不加载私有笔记结构，也不缓存好友列表。
const VISIBLE_FROM = `FROM note n
  JOIN \`user\` u ON u.id = n.user_id
  WHERE n.visibility = 'friends' AND n.status = ? AND u.status = 1
    AND (n.user_id = ? OR n.user_id IN (
      SELECT IF(f.requester_id = ?, f.addressee_id, f.requester_id)
        FROM friendship f
        WHERE f.status = ? AND f.live_pair IS NOT NULL
          AND (f.requester_id = ? OR f.addressee_id = ?)
    ))`;

const visibleArgs = (userId) => [ACTIVE, userId, userId, FRIENDSHIP.ACCEPTED, userId, userId];
const clip = (text, length) => [...(text ?? '')].slice(0, length).join('');

function publicFields(row) {
  return {
    id: row.id,
    title: row.title,
    kind: kindName(row.kind),
    author: toPublicUser({
      id: row.author_id,
      username: row.username,
      nickname: row.nickname,
      avatar_type: row.avatar_type,
      avatar_preset: row.avatar_preset,
      avatar_url: row.avatar_url,
    }),
    shared_at: row.shared_at,
    like_count: Number(row.like_count),
    liked: Boolean(Number(row.liked)),
  };
}

export async function listFeed(userId, { page, pageSize }) {
  const args = visibleArgs(userId);
  const [[rows], [[countRow]]] = await Promise.all([
    pool.query(
      `SELECT n.id, n.title, n.kind, LEFT(n.quote, 240) AS quote,
              LEFT(n.content_text, 180) AS excerpt, n.shared_at, ${AUTHOR_COLUMNS}, ${LIKE_COLUMNS}
         ${VISIBLE_FROM}
         ORDER BY n.shared_at DESC, n.id DESC LIMIT ? OFFSET ?`,
      [userId, ...args, pageSize + 1, (page - 1) * pageSize],
    ),
    pool.query(`SELECT COUNT(*) AS total ${VISIBLE_FROM}`, args),
  ]);
  return {
    items: rows.slice(0, pageSize).map((row) => ({
      ...publicFields(row),
      quote: row.quote === null ? null : clip(row.quote, 240),
      excerpt: clip(row.excerpt, 180),
    })),
    page,
    page_size: pageSize,
    total: Number(countRow.total),
    has_more: rows.length > pageSize,
  };
}

export async function getFeedNote(userId, id) {
  const [rows] = await pool.query(
    `SELECT n.id, n.title, n.kind, n.quote, n.content, n.shared_at, ${AUTHOR_COLUMNS}, ${LIKE_COLUMNS}
       ${VISIBLE_FROM} AND n.id = ?`,
    [userId, ...visibleArgs(userId), id],
  );
  const row = rows[0];
  if (!row) throw feedNoteNotFound();
  return { ...publicFields(row), quote: row.quote, content: row.content };
}

export async function setFeedLike(userId, id, liked) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await withTransaction(async (conn) => {
        // 不锁作者行，避免与先锁作者的结构操作形成反向锁序。
        const [[note]] = await conn.query(
          `SELECT n.user_id FROM note n
            WHERE n.id = ? AND n.status = ? AND n.visibility = 'friends'
              AND EXISTS (SELECT 1 FROM \`user\` u WHERE u.id = n.user_id AND u.status = 1)
            FOR UPDATE`,
          [id, ACTIVE],
        );
        if (!note || note.user_id === userId) throw feedNoteNotFound();

        // 必须是 locking/current read，避免事务快照仍看到解除前的好友关系。
        const [relations] = await conn.query(
          'SELECT id FROM friendship WHERE live_pair = ? AND status = ? FOR UPDATE',
          [pairKey(userId, note.user_id), FRIENDSHIP.ACCEPTED],
        );
        if (!relations.length) throw feedNoteNotFound();

        if (liked) {
          await conn.query(
            'INSERT INTO note_like (note_id, user_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE note_id = note_like.note_id',
            [id, userId],
          );
        } else {
          await conn.query('DELETE FROM note_like WHERE note_id = ? AND user_id = ?', [id, userId]);
        }
        const [[countRow]] = await conn.query('SELECT COUNT(*) AS like_count FROM note_like WHERE note_id = ?', [id]);
        return { liked, like_count: Number(countRow.like_count) };
      });
    } catch (error) {
      // 外键校验仍可能与结构操作形成死锁；回滚后整笔重试，重新校验权限。
      if (error.code !== 'ER_LOCK_DEADLOCK' || attempt >= 2) throw error;
    }
  }
}
