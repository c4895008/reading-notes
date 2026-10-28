import { pool, withTransaction } from '../db/pool.js';
import { AppError } from '../errors.js';
import {
  DISCUSSION,
  STATUS_NAME,
  assertCanInvite,
  assertCanSend,
  discussionExists,
  discussionNotFound,
  excerpt,
  isEligible,
  planInvite,
  planTransition,
} from './discussion.js';
import { FRIENDSHIP, pairKey } from './friendship.js';
import { ACTIVE as NOTE_ACTIVE, captureSnapshot } from './notes.js';
import { fillBadges } from './badges.js';
import { toPublicUser } from './users.js';

const USER_COLS = 'u.id, u.username, u.nickname, u.avatar_type, u.avatar_preset, u.avatar_url, u.status';
const BASE_COLS =
  'd.id, d.status, d.initiator_id, d.snapshot_note_title, JSON_LENGTH(d.snapshot_ancestors) AS layers, d.last_message_at, d.created_at';

// p.user_id 与 d 的发起人互为读友（live_pair 拼法与 pairKey 一致）
const FRIEND_OF_INITIATOR = `EXISTS (
  SELECT 1 FROM friendship f
   WHERE f.live_pair = CONCAT(LEAST(d.initiator_id, p.user_id), ':', GREATEST(d.initiator_id, p.user_id))
     AND f.status = ${FRIENDSHIP.ACCEPTED})`;
// isEligible 的 SQL 等价式，用于列表与名单的批量过滤
const ELIGIBLE = `(p.user_id = d.initiator_id OR ${FRIEND_OF_INITIATOR})`;

const noteForbidden = () => new AppError(403, 'NOTE_FORBIDDEN', '只能就自己的笔记发起讨论');

// 全部讨论接口的统一入口：资格失效与不存在同为 404，不泄露存在性
export async function assertAccess(discussionId, userId, { conn = pool, lock = false } = {}) {
  const [rows] = await conn.query(
    `SELECT d.*, JSON_LENGTH(d.snapshot_ancestors) AS layers, p.id AS participant_id, p.last_read_at, ${FRIEND_OF_INITIATOR} AS is_friend
       FROM discussion d
       LEFT JOIN discussion_participant p ON p.discussion_id = d.id AND p.user_id = ?
      WHERE d.id = ?${lock ? ' FOR UPDATE' : ''}`,
    [userId, discussionId],
  );
  const d = rows[0];
  if (!d || !isEligible({ hasRow: d.participant_id !== null, isInitiator: d.initiator_id === userId, isFriend: d.is_friend === 1 })) {
    throw discussionNotFound();
  }
  return d;
}

async function friendsAmong(conn, meId, ids) {
  if (!ids.length) return [];
  const [rows] = await conn.query(
    `SELECT ${USER_COLS} FROM friendship f
       JOIN \`user\` u ON u.id = IF(f.requester_id = ?, f.addressee_id, f.requester_id)
      WHERE f.live_pair IN (?) AND f.status = ? AND u.status = 1`,
    [meId, ids.map((id) => pairKey(meId, id)), FRIENDSHIP.ACCEPTED],
  );
  return rows;
}

async function addParticipants(conn, discussionId, meId, inviteeIds, participantIds) {
  const friends = await friendsAmong(conn, meId, inviteeIds);
  const { add, skipped } = planInvite(meId, inviteeIds, { participantIds, friendIds: friends.map((u) => u.id) });
  if (add.length) {
    await conn.query('INSERT INTO discussion_participant (discussion_id, user_id) VALUES ?', [add.map((uid) => [discussionId, uid])]);
  }
  const added = new Set(add);
  const invited = friends.filter((u) => added.has(u.id)).map((u) => toPublicUser(u));
  return { invited: await fillBadges(invited), skipped };
}

export async function createDiscussion(meId, noteId, inviteeIds) {
  try {
    return await withTransaction(async (conn) => {
      const snap = await captureSnapshot(conn, meId, noteId);
      if (!snap) throw noteForbidden();
      const [existing] = await conn.query('SELECT id FROM discussion WHERE note_id = ?', [noteId]);
      if (existing.length) throw discussionExists(existing[0].id);

      const [res] = await conn.query(
        `INSERT INTO discussion
           (note_id, initiator_id, snapshot_note_title, snapshot_note_quote, snapshot_note_content, snapshot_ancestors, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
        [noteId, meId, snap.note.title, snap.note.quote, snap.note.content, JSON.stringify(snap.ancestors)],
      );
      const id = res.insertId;
      await conn.query('INSERT INTO discussion_participant (discussion_id, user_id, last_read_at) VALUES (?, ?, CURRENT_TIMESTAMP(3))', [
        id,
        meId,
      ]);
      return { discussion_id: id, ...(await addParticipants(conn, id, meId, inviteeIds, [])) };
    });
  } catch (err) {
    // 并发重复发起：唯一约束兜底，返回已建成的那一场
    if (err.code !== 'ER_DUP_ENTRY') throw err;
    const [rows] = await pool.query('SELECT id FROM discussion WHERE note_id = ?', [noteId]);
    if (!rows.length) throw err;
    throw discussionExists(rows[0].id);
  }
}

export async function inviteMore(meId, discussionId, inviteeIds) {
  return withTransaction(async (conn) => {
    const d = await assertAccess(discussionId, meId, { conn, lock: true });
    assertCanInvite(d, meId);
    const [rows] = await conn.query('SELECT user_id FROM discussion_participant WHERE discussion_id = ?', [discussionId]);
    return { discussion_id: discussionId, ...(await addParticipants(conn, discussionId, meId, inviteeIds, rows.map((r) => r.user_id))) };
  });
}

// 当前仍有资格的参与者，发起人在前，其余按受邀先后
async function rostersOf(ids) {
  const roster = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return roster;
  const [rows] = await pool.query(
    `SELECT p.discussion_id, p.created_at AS joined_at, d.initiator_id, ${USER_COLS}
       FROM discussion_participant p
       JOIN discussion d ON d.id = p.discussion_id
       JOIN \`user\` u ON u.id = p.user_id
      WHERE p.discussion_id IN (?) AND u.status = 1 AND ${ELIGIBLE}
      ORDER BY p.discussion_id, (p.user_id = d.initiator_id) DESC, p.created_at, p.id`,
    [ids],
  );
  for (const r of rows) {
    roster.get(r.discussion_id).push({ ...toPublicUser(r), is_initiator: r.id === r.initiator_id, joined_at: r.joined_at });
  }
  await fillBadges([...roster.values()].flat());
  return roster;
}

const summaryOf = (d, meId, participants, activity = NO_ACTIVITY) => ({
  id: d.id,
  title: d.snapshot_note_title,
  layers: Number(d.layers),
  status: STATUS_NAME[d.status],
  is_initiator: d.initiator_id === meId,
  participants,
  last_message: activity.last_message,
  unread: d.status === DISCUSSION.ACTIVE ? activity.unread : 0,
  last_message_at: d.last_message_at,
  created_at: d.created_at,
});

const NO_ACTIVITY = { last_message: null, unread: 0 };
// 他人发送、且晚于我的已读游标；游标为 NULL（从未打开）时全部计入
const UNREAD_OF_P = `m.sender_id <> p.user_id AND (p.last_read_at IS NULL OR m.created_at > p.last_read_at)`;

// 列表行的最近一条消息摘要与我的未读数
async function activityOf(meId, ids) {
  const activity = new Map(ids.map((id) => [id, { ...NO_ACTIVITY }]));
  if (!ids.length) return activity;
  const [[last], [unread]] = await Promise.all([
    pool.query(
      `SELECT m.discussion_id, m.sender_id, m.content, u.nickname
         FROM message m JOIN \`user\` u ON u.id = m.sender_id
        WHERE m.id IN (SELECT MAX(id) FROM message WHERE discussion_id IN (?) GROUP BY discussion_id)`,
      [ids],
    ),
    pool.query(
      `SELECT m.discussion_id, COUNT(*) AS n
         FROM message m
         JOIN discussion_participant p ON p.discussion_id = m.discussion_id AND p.user_id = ?
        WHERE m.discussion_id IN (?) AND ${UNREAD_OF_P}
        GROUP BY m.discussion_id`,
      [meId, ids],
    ),
  ]);
  for (const r of last) {
    activity.get(r.discussion_id).last_message = {
      sender_id: r.sender_id,
      sender_nickname: r.nickname,
      is_mine: r.sender_id === meId,
      excerpt: excerpt(r.content),
    };
  }
  for (const r of unread) activity.get(r.discussion_id).unread = Number(r.n);
  return activity;
}

export async function listDiscussions(meId, status, { page, pageSize }) {
  const from = `FROM discussion_participant p JOIN discussion d ON d.id = p.discussion_id WHERE p.user_id = ? AND ${ELIGIBLE}`;
  const [[rows], [counts]] = await Promise.all([
    pool.query(
      `SELECT ${BASE_COLS} ${from} AND d.status = ?
        ORDER BY COALESCE(d.last_message_at, d.created_at) DESC, d.id DESC
        LIMIT ? OFFSET ?`,
      [meId, status, pageSize + 1, (page - 1) * pageSize],
    ),
    pool.query(`SELECT d.status, COUNT(*) AS n ${from} GROUP BY d.status`, [meId]),
  ]);
  const pageRows = rows.slice(0, pageSize);
  const ids = pageRows.map((d) => d.id);
  const [roster, activity] = await Promise.all([rostersOf(ids), activityOf(meId, ids)]);
  const byStatus = new Map(counts.map((c) => [c.status, Number(c.n)]));
  return {
    items: pageRows.map((d) => summaryOf(d, meId, roster.get(d.id), activity.get(d.id))),
    counts: Object.fromEntries(Object.entries(STATUS_NAME).map(([code, name]) => [name, byStatus.get(Number(code)) ?? 0])),
    page,
    page_size: pageSize,
    has_more: rows.length > pageSize,
  };
}

export async function getDiscussion(meId, discussionId) {
  const d = await assertAccess(discussionId, meId);
  const isInitiator = d.initiator_id === meId;
  const [roster, newer] = await Promise.all([rostersOf([d.id]), isInitiator ? noteUpdatedSince(d) : false]);
  return {
    ...summaryOf(d, meId, roster.get(d.id)),
    ended_at: d.ended_at,
    archived_at: d.archived_at,
    snapshot: {
      title: d.snapshot_note_title,
      quote: d.snapshot_note_quote,
      content: d.snapshot_note_content,
      ancestors: d.snapshot_ancestors,
      captured_at: d.captured_at,
    },
    first_visit: !isInitiator && d.last_read_at === null,
    note_has_newer_version: newer,
  };
}

// 原笔记仍存在且内容在快照之后编辑过；已删除时不提示
async function noteUpdatedSince(d) {
  const [rows] = await pool.query('SELECT updated_at FROM note WHERE id = ? AND user_id = ? AND status = ?', [
    d.note_id,
    d.initiator_id,
    NOTE_ACTIVE,
  ]);
  return rows.length > 0 && rows[0].updated_at > d.captured_at;
}

export async function markRead(meId, discussionId) {
  await assertAccess(discussionId, meId);
  await pool.query('UPDATE discussion_participant SET last_read_at = CURRENT_TIMESTAMP(3) WHERE discussion_id = ? AND user_id = ?', [
    discussionId,
    meId,
  ]);
}

// 笔记阅读页的讨论入口；只有作者本人会走到这里
export async function noteDiscussion(meId, noteId) {
  const [rows] = await pool.query(`SELECT ${BASE_COLS} FROM discussion d WHERE d.note_id = ? AND d.initiator_id = ?`, [noteId, meId]);
  if (!rows.length) return null;
  const [roster, activity] = await Promise.all([rostersOf([rows[0].id]), activityOf(meId, [rows[0].id])]);
  return summaryOf(rows[0], meId, roster.get(rows[0].id), activity.get(rows[0].id));
}

// 导航徽标：有未读的进行中讨论数量
export async function unreadDiscussionCount(meId) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS n
       FROM discussion_participant p JOIN discussion d ON d.id = p.discussion_id
      WHERE p.user_id = ? AND d.status = ? AND ${ELIGIBLE}
        AND EXISTS (SELECT 1 FROM message m WHERE m.discussion_id = d.id AND ${UNREAD_OF_P})`,
    [meId, DISCUSSION.ACTIVE],
  );
  return Number(row.n);
}

// m.id 起别名：USER_COLS 里的 u.id 同名会覆盖它
const MESSAGE_COLS = `m.id AS message_id, m.seq, m.sender_id, m.content, m.client_message_id, m.created_at, ${USER_COLS}`;

const messageOf = (r, d, meId) => ({
  id: r.message_id,
  seq: r.seq,
  sender: toPublicUser(r),
  is_initiator: r.sender_id === d.initiator_id,
  is_mine: r.sender_id === meId,
  content: r.content,
  // 只回给本人，供乐观上屏的消息对账
  client_message_id: r.sender_id === meId ? r.client_message_id : undefined,
  created_at: r.created_at,
});

export async function sendMessage(meId, discussionId, { content, clientMessageId }) {
  return withTransaction(async (conn) => {
    // 锁讨论行：同场发言串行化，楼层号连续；也与状态流转互斥
    const d = await assertAccess(discussionId, meId, { conn, lock: true });
    const findByClientId = () =>
      conn
        .query(`SELECT ${MESSAGE_COLS} FROM message m JOIN \`user\` u ON u.id = m.sender_id WHERE m.discussion_id = ? AND m.client_message_id = ?`, [
          discussionId,
          clientMessageId,
        ])
        .then(([rows]) => rows[0]);

    // 重试先对账：已写入的同一条直接返回，即使讨论随后被完结
    const prior = await findByClientId();
    if (prior) {
      if (prior.sender_id !== meId) throw new AppError(409, 'CLIENT_ID_CONFLICT', '消息标识冲突，请重新发送');
      return { message: messageOf(prior, d, meId), created: false, initiatorId: d.initiator_id };
    }
    assertCanSend(d);

    const [[{ next }]] = await conn.query('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM message WHERE discussion_id = ?', [discussionId]);
    await conn.query(
      'INSERT INTO message (discussion_id, seq, sender_id, content, client_message_id, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))',
      [discussionId, next, meId, content, clientMessageId],
    );
    const row = await findByClientId();
    await conn.query('UPDATE discussion SET last_message_at = ? WHERE id = ?', [row.created_at, discussionId]);
    return { message: messageOf(row, d, meId), created: true, initiatorId: d.initiator_id };
  });
}

export const MESSAGE_PAGE = 200;

// after_id 增量向后；before_id 与 latest 向前翻页，has_more 表示请求方向上是否还有下一页
export async function listMessages(meId, discussionId, { afterId = 0, beforeId = null, latest = false } = {}) {
  const d = await assertAccess(discussionId, meId);
  const descending = latest || beforeId !== null;
  const where = latest ? '' : beforeId !== null ? 'AND m.id < ?' : 'AND m.id > ?';
  const cursor = latest ? [] : [beforeId ?? afterId];
  const [[rows], roster] = await Promise.all([
    pool.query(
      `SELECT ${MESSAGE_COLS} FROM message m JOIN \`user\` u ON u.id = m.sender_id
        WHERE m.discussion_id = ? ${where} ORDER BY m.id ${descending ? 'DESC' : 'ASC'} LIMIT ?`,
      [discussionId, ...cursor, MESSAGE_PAGE + 1],
    ),
    rostersOf([d.id]),
  ]);
  const page = rows.slice(0, MESSAGE_PAGE);
  const messages = (descending ? page.reverse() : page).map((r) => messageOf(r, d, meId));
  await fillBadges(messages.map((m) => m.sender));
  return {
    discussion_id: d.id,
    status: STATUS_NAME[d.status],
    participants: roster.get(d.id),
    messages,
    has_more: rows.length > MESSAGE_PAGE,
  };
}

const STATUS_STAMPS = {
  [DISCUSSION.ACTIVE]: 'ended_at = NULL, archived_at = NULL',
  [DISCUSSION.ENDED]: 'ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP(3)), archived_at = NULL',
  [DISCUSSION.ARCHIVED]: 'archived_at = CURRENT_TIMESTAMP(3)',
};

export async function transition(meId, discussionId, action) {
  return withTransaction(async (conn) => {
    const d = await assertAccess(discussionId, meId, { conn, lock: true });
    const to = planTransition(d, meId, action);
    await conn.query(`UPDATE discussion SET status = ?, ${STATUS_STAMPS[to]} WHERE id = ?`, [to, discussionId]);
    if (action === 'end') {
      // 完结即未读清零；从未打开过的受邀者保持 NULL，留住首次进入的说明
      await conn.query(
        'UPDATE discussion_participant SET last_read_at = CURRENT_TIMESTAMP(3) WHERE discussion_id = ? AND last_read_at IS NOT NULL',
        [discussionId],
      );
    }
    return { discussion_id: discussionId, status: STATUS_NAME[to] };
  });
}
