import { pool, withTransaction } from '../db/pool.js';
import { AppError } from '../errors.js';
import { STATUS_NAME } from './discussion.js';
import { markdownToText } from './markdown.js';
import { ancestorsOf, buildIndex, childrenOf, planCreate, planDelete, planMove, planPromote, preorder } from './tree.js';
import { listNoteTags, tagsForNotes } from './tags.js';

export const ACTIVE = 1;
export const DELETED = 2;
export const EXCERPT_LENGTH = 80;

export const noteNotFound = () => new AppError(404, 'NOTE_NOT_FOUND', '无权访问或不存在');

const DETAIL_COLUMNS = 'id, parent_id, title, quote, content, kind, created_at, updated_at';

const KIND_CODE = { viewpoint: 1, question: 2, summary: 3 };
const KIND_NAME = { 1: 'viewpoint', 2: 'question', 3: 'summary' };
const kindName = (code) => KIND_NAME[code] ?? null;
const kindCode = (name) => KIND_CODE[name] ?? null;

const brief = (n) => ({ id: n.id, title: n.title });

const DISCUSSION_FILTER = {
  active: 'd.status = 1',
  ended: 'd.status IN (2, 3)',
  none: 'd.id IS NULL',
};

function clip(text) {
  const chars = [...text];
  return chars.length > EXCERPT_LENGTH ? `${chars.slice(0, EXCERPT_LENGTH).join('')}…` : text;
}

// 摘要：正文纯文本优先，正文为空时用引文兜底
function excerptOf(row) {
  const content = (row.content_head ?? '').trim();
  if (content) return { excerpt: clip(content), excerpt_source: 'content' };
  const quote = (row.quote_head ?? '').replace(/\s+/g, ' ').trim();
  if (quote) return { excerpt: clip(quote), excerpt_source: 'quote' };
  return { excerpt: '', excerpt_source: 'none' };
}

const escapeLike = (s) => s.replace(/[\\%_]/g, '\\$&');

// 作者的全部有效笔记的结构骨架（不含正文），供层级计算
async function loadIndex(conn, userId) {
  const [rows] = await conn.query(
    'SELECT id, parent_id, sort_order, title, updated_at FROM note WHERE user_id = ? AND status = ?',
    [userId, ACTIVE],
  );
  return buildIndex(rows);
}

// 锁住作者行：同一作者的排序计算与结构操作串行执行，避免并发下成环或排序冲突
async function lockAuthorAndLoad(conn, userId) {
  await conn.query('SELECT id FROM `user` WHERE id = ? FOR UPDATE', [userId]);
  return loadIndex(conn, userId);
}

async function applyMoves(conn, userId, moves) {
  for (const m of moves) {
    await conn.query('UPDATE note SET parent_id = ?, sort_order = ? WHERE id = ? AND user_id = ? AND status = ?', [
      m.parent_id,
      m.sort_order,
      m.id,
      userId,
      ACTIVE,
    ]);
  }
}

export async function listNotes(userId, { q, page, pageSize, tag, kind, discussion, sort = 'updated' }) {
  const where = ['n.user_id = ?', 'n.status = ?'];
  const params = [userId, ACTIVE];
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push('(n.title LIKE ? OR n.quote LIKE ? OR n.content_text LIKE ?)');
    params.push(like, like, like);
  }
  if (tag) {
    where.push('EXISTS (SELECT 1 FROM note_tag nt WHERE nt.note_id = n.id AND nt.tag_id = ?)');
    params.push(tag);
  }
  if (kind) {
    where.push('n.kind = ?');
    params.push(kindCode(kind));
  }
  if (discussion) where.push(DISCUSSION_FILTER[discussion]);
  const order = sort === 'created' ? 'n.created_at DESC, n.id DESC' : 'n.updated_at DESC, n.id DESC';
  const [[rows], [countRows], index] = await Promise.all([
    pool.query(
      `SELECT n.id, n.parent_id, n.title, n.kind,
              LEFT(n.content_text, ${EXCERPT_LENGTH + 1}) AS content_head,
              LEFT(n.quote, ${EXCERPT_LENGTH * 4}) AS quote_head,
              CHAR_LENGTH(REGEXP_REPLACE(n.content_text, '[[:space:]]+', '')) AS content_length,
              n.created_at, n.updated_at, d.status AS discussion_status,
              (SELECT COUNT(*) FROM message m WHERE m.discussion_id = d.id) AS message_count
         FROM note n
         LEFT JOIN discussion d ON d.note_id = n.id
        WHERE ${where.join(' AND ')}
        ORDER BY ${order}
        LIMIT ? OFFSET ?`,
      [...params, pageSize + 1, (page - 1) * pageSize],
    ),
    pool.query(`SELECT COUNT(*) AS n FROM note n LEFT JOIN discussion d ON d.note_id = n.id WHERE ${where.join(' AND ')}`, params),
    loadIndex(pool, userId),
  ]);
  const tagMap = await tagsForNotes(rows.slice(0, pageSize).map((r) => r.id));
  return {
    items: rows.slice(0, pageSize).map((row) => {
      const ancestors = ancestorsOf(index, row.id);
      return {
        id: row.id,
        parent_id: row.parent_id,
        title: row.title,
        kind: kindName(row.kind),
        ...excerptOf(row),
        depth: ancestors.length,
        ...(q ? { path: ancestors.map(brief) } : {}),
        child_count: childrenOf(index, row.id).length,
        content_length: Number(row.content_length ?? 0),
        discussion_status: STATUS_NAME[row.discussion_status] ?? null,
        message_count: Number(row.message_count),
        tags: tagMap.get(row.id) ?? [],
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    }),
    page,
    page_size: pageSize,
    total: Number(countRows[0].n),
    has_more: rows.length > pageSize,
  };
}

// 结构视图：整片森林按先序平铺，客户端按 depth 缩进、按 child_count 决定是否可折叠
export async function listTree(userId) {
  const index = await loadIndex(pool, userId);
  return {
    items: preorder(index).map(({ node, depth }) => ({
      id: node.id,
      parent_id: depth === 0 ? null : node.parent_id,
      title: node.title,
      depth,
      child_count: childrenOf(index, node.id).length,
      updated_at: node.updated_at,
    })),
  };
}

async function findOwnRow(userId, id, conn = pool) {
  const [rows] = await conn.query(`SELECT ${DETAIL_COLUMNS} FROM note WHERE id = ? AND user_id = ? AND status = ?`, [
    id,
    userId,
    ACTIVE,
  ]);
  return rows[0] ?? null;
}

export async function getNote(userId, id) {
  const [row, index, tags] = await Promise.all([findOwnRow(userId, id), loadIndex(pool, userId), listNoteTags(userId, id)]);
  if (!row || !index.byId.has(row.id)) throw noteNotFound();
  const ancestors = ancestorsOf(index, row.id);
  return {
    id: row.id,
    parent_id: ancestors.length ? row.parent_id : null,
    title: row.title,
    quote: row.quote,
    content: row.content,
    kind: kindName(row.kind),
    tags,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ancestors: ancestors.map(brief),
    children: childrenOf(index, row.id).map((c) => ({ id: c.id, title: c.title, updated_at: c.updated_at })),
  };
}

// 在调用方事务内冻结笔记与祖先链（根 → 近）；锁作者行，避免快照与结构调整交错。非本人有效笔记返回 null
export async function captureSnapshot(conn, userId, id) {
  const index = await lockAuthorAndLoad(conn, userId);
  if (!index.byId.has(id)) return null;
  const chainIds = [...ancestorsOf(index, id).map((a) => a.id), id];
  const [rows] = await conn.query('SELECT id, title, quote, content FROM note WHERE id IN (?) AND user_id = ? AND status = ?', [
    chainIds,
    userId,
    ACTIVE,
  ]);
  const byId = new Map(rows.map((r) => [r.id, { title: r.title, quote: r.quote, content: r.content }]));
  const chain = chainIds.map((cid) => byId.get(cid));
  return { note: chain.pop(), ancestors: chain };
}

async function insertNote(conn, userId, { parent_id, sort_order }, { title, quote, content, kind }) {
  const [result] = await conn.query(
    'INSERT INTO note (user_id, parent_id, sort_order, title, quote, content, content_text, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [userId, parent_id, sort_order, title, quote, content, markdownToText(content), kindCode(kind)],
  );
  return result.insertId;
}

// parentId 非空即「向下补充」：成为该笔记的最后一个子级
export async function createNote(userId, input, parentId = null) {
  const id = await withTransaction(async (conn) => {
    const index = await lockAuthorAndLoad(conn, userId);
    return insertNote(conn, userId, planCreate(index, parentId), input);
  });
  return getNote(userId, id);
}

export async function updateNote(userId, id, { title, quote, content, kind }) {
  const current = await findOwnRow(userId, id);
  if (!current) throw noteNotFound();
  const code = kindCode(kind);
  if (current.title === title && current.quote === quote && current.content === content && current.kind === code) {
    return getNote(userId, id);
  }

  // 只改内容，不动 parent_id / sort_order（编辑不变位）
  const [result] = await pool.query(
    `UPDATE note SET title = ?, quote = ?, content = ?, content_text = ?, kind = ?, updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ? AND user_id = ? AND status = ?`,
    [title, quote, content, markdownToText(content), code, id, userId, ACTIVE],
  );
  if (result.affectedRows === 0) throw noteNotFound();
  return getNote(userId, id);
}

export async function promoteNote(userId, sourceId, input) {
  const id = await withTransaction(async (conn) => {
    const index = await lockAuthorAndLoad(conn, userId);
    if (!index.byId.has(sourceId)) throw noteNotFound();
    const plan = planPromote(index, sourceId);
    const newId = await insertNote(conn, userId, plan.insert, input);
    await applyMoves(conn, userId, [{ id: sourceId, parent_id: newId, sort_order: plan.source.sort_order }]);
    return newId;
  });
  return getNote(userId, id);
}

export async function moveNote(userId, sourceId, parentId) {
  await withTransaction(async (conn) => {
    const index = await lockAuthorAndLoad(conn, userId);
    if (!index.byId.has(sourceId)) throw noteNotFound();
    await applyMoves(conn, userId, planMove(index, sourceId, parentId));
  });
  return getNote(userId, sourceId);
}

export async function deleteNote(userId, sourceId) {
  return withTransaction(async (conn) => {
    const index = await lockAuthorAndLoad(conn, userId);
    if (!index.byId.has(sourceId)) throw noteNotFound();
    const moves = planDelete(index, sourceId);
    await conn.query('UPDATE note SET status = ? WHERE id = ? AND user_id = ?', [DELETED, sourceId, userId]);
    await applyMoves(conn, userId, moves);
    return { promoted_children: moves.length };
  });
}
