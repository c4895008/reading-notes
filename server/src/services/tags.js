import { pool, withTransaction } from '../db/pool.js';
import { AppError } from '../errors.js';

export const tagNotFound = () => new AppError(404, 'TAG_NOT_FOUND', '标签不存在');
const noteMissing = () => new AppError(404, 'NOTE_NOT_FOUND', '无权访问或不存在');

// 笔记为软删除：关联行保留，计数与过滤一律关联有效笔记
const ACTIVE_NOTE = 1;

export async function listTags(userId) {
  const [rows] = await pool.query(
    `SELECT t.id, t.name, COUNT(n.id) AS note_count
       FROM tag t
       LEFT JOIN note_tag nt ON nt.tag_id = t.id
       LEFT JOIN note n ON n.id = nt.note_id AND n.status = ?
      WHERE t.user_id = ?
      GROUP BY t.id, t.name
      ORDER BY t.created_at, t.id`,
    [ACTIVE_NOTE, userId],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, note_count: Number(r.note_count) }));
}

export async function findTag(userId, id) {
  const [rows] = await pool.query('SELECT id, name FROM tag WHERE id = ? AND user_id = ?', [id, userId]);
  return rows[0] ?? null;
}

async function findTagByName(userId, name) {
  const [rows] = await pool.query('SELECT id, name FROM tag WHERE user_id = ? AND name = ?', [userId, name]);
  return rows[0] ?? null;
}

// 同名标签直接复用，保证「即时新建」在并发/重复提交下幂等
export async function createTag(userId, name) {
  try {
    const [result] = await pool.query('INSERT INTO tag (user_id, name) VALUES (?, ?)', [userId, name]);
    return { tag: { id: result.insertId, name }, existed: false };
  } catch (e) {
    if (e.code !== 'ER_DUP_ENTRY') throw e;
    return { tag: await findTagByName(userId, name), existed: true };
  }
}

export async function renameTag(userId, id, name) {
  try {
    const [result] = await pool.query('UPDATE tag SET name = ? WHERE id = ? AND user_id = ?', [name, id, userId]);
    if (result.affectedRows === 0) throw tagNotFound();
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new AppError(409, 'TAG_EXISTS', '同名标签已存在');
    throw e;
  }
  return { id, name };
}

export async function deleteTag(userId, id) {
  const [result] = await pool.query('DELETE FROM tag WHERE id = ? AND user_id = ?', [id, userId]);
  if (result.affectedRows === 0) throw tagNotFound();
}

// 多条笔记的标签，一次取回（笔记列表分页结果用）
export async function tagsForNotes(noteIds) {
  if (!noteIds.length) return new Map();
  const [rows] = await pool.query(
    `SELECT nt.note_id, t.id, t.name
       FROM note_tag nt
       JOIN tag t ON t.id = nt.tag_id
      WHERE nt.note_id IN (?)
      ORDER BY t.created_at, t.id`,
    [noteIds],
  );
  const map = new Map();
  for (const row of rows) {
    const list = map.get(row.note_id) ?? [];
    list.push({ id: row.id, name: row.name });
    map.set(row.note_id, list);
  }
  return map;
}

export async function listNoteTags(userId, noteId) {
  const [rows] = await pool.query(
    `SELECT t.id, t.name
       FROM note_tag nt
       JOIN tag t ON t.id = nt.tag_id
       JOIN note n ON n.id = nt.note_id AND n.user_id = ? AND n.status = ?
      WHERE nt.note_id = ?
      ORDER BY t.created_at, t.id`,
    [userId, ACTIVE_NOTE, noteId],
  );
  return rows;
}

// 整体替换一条笔记的标签集；tagIds 须全部属于该用户
export async function setNoteTags(userId, noteId, tagIds) {
  await withTransaction(async (conn) => {
    const [notes] = await conn.query('SELECT id FROM note WHERE id = ? AND user_id = ? AND status = ?', [
      noteId,
      userId,
      ACTIVE_NOTE,
    ]);
    if (notes.length === 0) throw noteMissing();
    if (tagIds.length) {
      const [owned] = await conn.query('SELECT id FROM tag WHERE user_id = ? AND id IN (?)', [userId, tagIds]);
      if (owned.length !== tagIds.length) {
        throw new AppError(400, 'VALIDATION_ERROR', '包含无效标签', { fields: { tag_ids: '包含无效标签' } });
      }
      for (const tagId of tagIds) {
        await conn.query('INSERT IGNORE INTO note_tag (note_id, tag_id) VALUES (?, ?)', [noteId, tagId]);
      }
    }
    await conn.query('DELETE FROM note_tag WHERE note_id = ? AND tag_id NOT IN (?)', [noteId, tagIds.length ? tagIds : [0]]);
  });
  return listNoteTags(userId, noteId);
}
