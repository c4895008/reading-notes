import { after } from 'node:test';
import { config } from '../src/config.js';

// 红线：集成测试会清空数据表，只允许在独立测试库上运行
if (config.db.database !== 'reading_notes_test') {
  throw new Error(`集成测试只能连接 reading_notes_test，当前为「${config.db.database}」`);
}

const { pool } = await import('../src/db/pool.js');
const { createApp } = await import('../src/app.js');

const TABLES = ['user_badge', 'message', 'discussion_participant', 'discussion', 'friendship', 'note_tag', 'tag', 'note', 'user'];
export const PASSWORD = 'int-pass-1234';

let server;
let base;
let ipSeq = 0;
let userSeq = 0;

export async function resetDb() {
  const [[{ db }]] = await pool.query('SELECT DATABASE() AS db');
  if (db !== 'reading_notes_test') throw new Error(`拒绝清库：当前连接 ${db}`);
  const conn = await pool.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of TABLES) await conn.query(`TRUNCATE TABLE \`${t}\``);
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    conn.release();
  }
}

// 顶层 await 调用：在任何钩子与用例之前清库并起服务
export async function setup() {
  await resetDb();
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  after(async () => {
    await new Promise((r) => server.close(r));
    await pool.end();
  });
}

export const nextIp = () => `10.0.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;

export async function api(method, path, { token, body, headers = {}, ip, form } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (ip) h['x-forwarded-for'] = ip;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    h['content-type'] = 'application/json';
    payload = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await fetch(base + path, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json, headers: res.headers, text };
}

export async function register(prefix = 'u', nickname) {
  const username = `${prefix}_${String(++userSeq).padStart(3, "0")}`;
  const res = await api('POST', '/auth/register', {
    body: { username, password: PASSWORD, nickname: nickname ?? username },
    ip: nextIp(),
  });
  if (res.status !== 201) throw new Error(`注册失败 ${res.status} ${res.text}`);
  const user = res.body.data.user;
  return { ...user, id: user.user_id, token: res.body.data.token };
}

export async function befriend(a, b) {
  const req = await api('POST', '/friends/requests', { token: a.token, body: { username: b.username } });
  if (req.status !== 201) throw new Error(`申请失败 ${req.status} ${req.text}`);
  const acc = await api('POST', `/friends/requests/${req.body.data.request.id}/accept`, { token: b.token });
  if (acc.status !== 200) throw new Error(`接受失败 ${acc.status} ${acc.text}`);
}

export async function createNote(user, fields = {}) {
  const res = await api('POST', '/notes', { token: user.token, body: { title: '标题', content: '正文', ...fields } });
  if (res.status !== 201) throw new Error(`建笔记失败 ${res.status} ${res.text}`);
  return res.body.data.note;
}

let clientSeq = 0;
export const clientId = () => `cid-${Date.now().toString(36)}-${++clientSeq}`;

export const send = (user, discussionId, content, cid = clientId()) =>
  api('POST', `/discussions/${discussionId}/messages`, { token: user.token, body: { content, client_message_id: cid } });

export const db = () => pool;
export const origin = () => base.replace(/\/api$/, '');
