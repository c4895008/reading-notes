import { pool, withTransaction } from '../db/pool.js';
import { AppError } from '../errors.js';

export const bookNotFound = () => new AppError(404, 'BOOK_NOT_FOUND', '书籍不存在');
const bookExists = () => new AppError(409, 'BOOK_EXISTS', '同名书籍已存在');

const ACTIVE_NOTE = 1;
export const BATCH_MAX = 50;

const STATUS_CODE = { reading: 1, deep: 2, done: 3 };
const STATUS_NAME = { 1: 'reading', 2: 'deep', 3: 'done' };
const statusCode = (name) => (name == null ? null : STATUS_CODE[name]);

const shape = (r) => ({
  id: r.id,
  title: r.title,
  author: r.author,
  status: STATUS_NAME[r.status] ?? null,
  note_count: Number(r.note_count ?? 0),
  last_note_at: r.last_note_at ?? null,
  created_at: r.created_at,
});

export async function listBooks(userId) {
  const [[rows], [[unfiled]]] = await Promise.all([
    pool.query(
      `SELECT b.id, b.title, b.author, b.status, b.created_at,
              COUNT(n.id) AS note_count, MAX(n.updated_at) AS last_note_at
         FROM book b
         LEFT JOIN note n ON n.book_id = b.id AND n.status = ?
        WHERE b.user_id = ?
        GROUP BY b.id
        ORDER BY COALESCE(MAX(n.updated_at), b.created_at) DESC, b.id DESC`,
      [ACTIVE_NOTE, userId],
    ),
    pool.query('SELECT COUNT(*) AS n FROM note WHERE user_id = ? AND status = ? AND book_id IS NULL', [userId, ACTIVE_NOTE]),
  ]);
  return { items: rows.map(shape), unfiled_count: Number(unfiled.n) };
}

export async function findBook(userId, id, conn = pool) {
  const [rows] = await conn.query('SELECT id, title FROM book WHERE id = ? AND user_id = ?', [id, userId]);
  return rows[0] ?? null;
}

async function loadBook(userId, id) {
  const [rows] = await pool.query(
    `SELECT b.id, b.title, b.author, b.status, b.created_at,
            COUNT(n.id) AS note_count, MAX(n.updated_at) AS last_note_at
       FROM book b
       LEFT JOIN note n ON n.book_id = b.id AND n.status = ?
      WHERE b.id = ? AND b.user_id = ?
      GROUP BY b.id`,
    [ACTIVE_NOTE, id, userId],
  );
  if (!rows[0]) throw bookNotFound();
  return shape(rows[0]);
}

// 同名书籍直接复用，保证编辑器里「输入即新建」在重复提交下幂等
export async function createBook(userId, { title, author = null, status = null }) {
  try {
    const [result] = await pool.query('INSERT INTO book (user_id, title, author, status) VALUES (?, ?, ?, ?)', [
      userId,
      title,
      author,
      statusCode(status),
    ]);
    return { book: await loadBook(userId, result.insertId), existed: false };
  } catch (e) {
    if (e.code !== 'ER_DUP_ENTRY') throw e;
    const [rows] = await pool.query('SELECT id FROM book WHERE user_id = ? AND title = ?', [userId, title]);
    return { book: await loadBook(userId, rows[0].id), existed: true };
  }
}

export async function updateBook(userId, id, fields) {
  const columns = { title: fields.title, author: fields.author, status: fields.status === undefined ? undefined : statusCode(fields.status) };
  const entries = Object.entries(columns).filter(([, v]) => v !== undefined);
  try {
    const [result] = await pool.query(`UPDATE book SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ? AND user_id = ?`, [
      ...entries.map(([, v]) => v),
      id,
      userId,
    ]);
    if (result.affectedRows === 0) throw bookNotFound();
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw bookExists();
    throw e;
  }
  return loadBook(userId, id);
}

// 笔记的 book_id 由外键 ON DELETE SET NULL 置空，回到「未归类」
export async function deleteBook(userId, id) {
  const [result] = await pool.query('DELETE FROM book WHERE id = ? AND user_id = ?', [id, userId]);
  if (result.affectedRows === 0) throw bookNotFound();
}

// 批量归书：归属调整不算内容编辑，不触碰 updated_at
export async function setNotesBook(userId, noteIds, bookId) {
  return withTransaction(async (conn) => {
    if (bookId !== null && !(await findBook(userId, bookId, conn))) throw bookNotFound();
    const [owned] = await conn.query('SELECT id FROM note WHERE user_id = ? AND status = ? AND id IN (?) FOR UPDATE', [
      userId,
      ACTIVE_NOTE,
      noteIds,
    ]);
    if (owned.length !== noteIds.length) throw new AppError(404, 'NOTE_NOT_FOUND', '包含无权访问或不存在的笔记');
    await conn.query('UPDATE note SET book_id = ? WHERE user_id = ? AND status = ? AND id IN (?)', [bookId, userId, ACTIVE_NOTE, noteIds]);
    return { updated: noteIds.length };
  });
}
