import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { api, befriend, createNote, db, origin, register, send, setup } from './helpers.js';

await setup();

const MISSING_ID = '999999999999999';
const LIST_FIELDS = ['id', 'title', 'kind', 'quote', 'excerpt', 'author', 'shared_at', 'like_count', 'liked'];
const DETAIL_FIELDS = ['id', 'title', 'kind', 'quote', 'content', 'author', 'shared_at', 'like_count', 'liked'];
const PUBLIC_USER_FIELDS = ['user_id', 'username', 'nickname', 'avatar', 'badges'];

function keys(value, expected) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}

function noStore(res) {
  assert.match(res.headers.get('cache-control') ?? '', /(?:^|[,\s])no-store(?:$|[,\s])/i);
}

function ok(res, status = 200) {
  assert.equal(res.status, status, res.text);
  noStore(res);
  return res.body.data;
}

async function visibility(owner, note, value) {
  const data = ok(await api('PUT', `/notes/${note.id}/visibility`, { token: owner.token, body: { visibility: value } }));
  keys(data, ['visibility', 'shared_at']);
  assert.equal(data.visibility, value);
  if (value === 'private') assert.equal(data.shared_at, null);
  else assert.ok(Number.isFinite(Date.parse(data.shared_at)), '分享时间必须有效');
  return data;
}

async function ownNote(owner, note) {
  const res = await api('GET', `/notes/${note.id}`, { token: owner.token });
  assert.equal(res.status, 200, res.text);
  return res.body.data.note;
}

async function feed(user, query = '') {
  const data = ok(await api('GET', `/feed${query}`, { token: user.token }));
  keys(data, ['items', 'page', 'page_size', 'total', 'has_more']);
  return data;
}

async function detail(user, note) {
  const data = ok(await api('GET', `/feed/${note.id}`, { token: user.token }));
  keys(data, ['note']);
  keys(data.note, DETAIL_FIELDS);
  return data.note;
}

async function like(user, note, method = 'PUT') {
  const data = ok(await api(method, `/feed/${note.id}/like`, { token: user.token }));
  keys(data, ['liked', 'like_count']);
  assert.equal(typeof data.liked, 'boolean');
  assert.ok(Number.isInteger(data.like_count) && data.like_count >= 0);
  return data;
}

async function pair() {
  const owner = await register('qa_feed_h');
  const reader = await register('qa_feed_r');
  await befriend(owner, reader);
  const note = await createNote(owner, { title: 'qa_共享笔记', quote: 'qa_引文', content: 'qa_正文' });
  return { owner, reader, note };
}

async function canonical404(user) {
  const res = await api('GET', `/feed/${MISSING_ID}`, { token: user.token });
  assert.equal(res.status, 404, res.text);
  assert.equal(res.body.error.code, 'FEED_NOTE_NOT_FOUND');
  noStore(res);
  return res.body;
}

async function denied(user, id, expected, methods = ['GET', 'PUT', 'DELETE']) {
  for (const method of methods) {
    const path = method === 'GET' ? `/feed/${id}` : `/feed/${id}/like`;
    const res = await api(method, path, { token: user.token });
    assert.equal(res.status, 404, `${method} ${path}: ${res.text}`);
    assert.deepEqual(res.body, expected, '不存在、不可见和禁止点赞必须同码同文');
    noStore(res);
  }
}

async function storedLikes(note) {
  const [[row]] = await db().query('SELECT COUNT(*) AS n FROM note_like WHERE note_id = ?', [note.id]);
  return Number(row.n);
}

async function timestamps(note) {
  const [[row]] = await db().query(
    `SELECT DATE_FORMAT(shared_at, '%Y-%m-%d %H:%i:%s.%f') AS shared_at,
            DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s.%f') AS updated_at FROM note WHERE id = ?`,
    [note.id],
  );
  return row;
}

// 仅竞态请求使用有取消能力的 fetch；普通用例均复用 api()，不改变 helpers 的行为。
async function boundedLike(reader, note) {
  const res = await fetch(`${origin()}/api/feed/${note.id}/like`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${reader.token}` },
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.json();
  return { status: res.status, body, headers: res.headers, text: JSON.stringify(body) };
}

// 唯一索引的优化阶段也可能等待行锁，此时 innodb_trx 尚无记录；直接观察锁等待边。
async function waitForLock(observer, holderId, observerId, table, outcome) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const [[row]] = await observer.query(
      `SELECT COUNT(*) AS n FROM performance_schema.data_lock_waits w
         JOIN performance_schema.data_locks l
           ON l.ENGINE = w.ENGINE AND l.ENGINE_LOCK_ID = w.REQUESTING_ENGINE_LOCK_ID
         JOIN performance_schema.threads h ON h.THREAD_ID = w.BLOCKING_THREAD_ID
         JOIN performance_schema.threads r ON r.THREAD_ID = w.REQUESTING_THREAD_ID
        WHERE l.OBJECT_SCHEMA = DATABASE() AND l.OBJECT_NAME = ?
          AND h.PROCESSLIST_ID = ? AND r.PROCESSLIST_ID NOT IN (?, ?)`,
      [table, holderId, holderId, observerId],
    );
    if (Number(row.n) > 0) return;
    assert.equal(outcome.settled, false, '点赞请求未等待受控行锁，不能证明竞态权限校验');
  }
  assert.fail(`5 秒内未观察到 ${table} 行锁等待`);
}

async function revokeWhileLikeWaits({ owner, reader, note }, table, privateVisibility) {
  const expected = await canonical404(reader);
  assert.equal(await storedLikes(note), 0);
  const holder = await db().getConnection();
  let observer;
  let pending;
  const outcome = { settled: false };
  try {
    observer = await db().getConnection();
    const [[{ id: holderId }]] = await holder.query('SELECT CONNECTION_ID() AS id');
    const [[{ id: observerId }]] = await observer.query('SELECT CONNECTION_ID() AS id');
    assert.notEqual(holderId, observerId, '必须使用两个独立连接');
    await holder.beginTransaction();
    let friendshipId;
    if (table === 'note') {
      const [rows] = await holder.query('SELECT id FROM note WHERE id = ? AND user_id = ? FOR UPDATE', [note.id, owner.id]);
      assert.equal(rows.length, 1);
    } else {
      const [rows] = await holder.query(
        'SELECT id FROM friendship WHERE live_pair = ? AND status = 1 FOR UPDATE',
        [`${Math.min(owner.id, reader.id)}:${Math.max(owner.id, reader.id)}`],
      );
      assert.equal(rows.length, 1);
      friendshipId = rows[0].id;
    }
    // 马上挂接成功/失败处理，避免观察期间发生未处理 rejection。
    pending = boundedLike(reader, note).then(
      (res) => { outcome.settled = true; return { res }; },
      (error) => { outcome.settled = true; return { error }; },
    );
    await waitForLock(observer, holderId, observerId, table, outcome);
    const [changed] = table === 'note'
      ? await holder.query('UPDATE note SET visibility = ?, shared_at = NULL WHERE id = ?', [privateVisibility, note.id])
      : await holder.query('UPDATE friendship SET status = 4, ended_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [friendshipId]);
    assert.equal(changed.affectedRows, 1);
    await holder.commit();
    const result = await pending;
    assert.ifError(result.error);
    assert.equal(result.res.status, 404, result.res.text);
    assert.deepEqual(result.res.body, expected);
    noStore(result.res);
    assert.equal(await storedLikes(note), 0, '锁释放后的最新权限校验应拒绝点赞，不能新增历史赞');
    assert.equal((await feed(reader)).total, 0);
  } finally {
    // 失败、超时也先释放行锁，再等有界 HTTP 请求结束；不占着锁等请求，避免自身死锁。
    try {
      await holder.rollback();
    } finally {
      holder.release();
      observer?.release();
      if (pending) await pending;
    }
  }
}

describe('好友动态与点赞：独立 qa_ fixtures，单文件顺序执行', { concurrency: false }, () => {
  test('默认私密：普通、子笔记、共享后的补充与提炼均不继承可见性', async () => {
    const { owner, reader, note } = await pair();
    const child = await createNote(owner, { title: 'qa_先有子笔记', parent_id: note.id });
    for (const n of [note, child]) {
      const own = await ownNote(owner, n);
      assert.equal(own.visibility, 'private');
      assert.equal(own.shared_at, null);
    }
    assert.equal((await feed(owner)).total, 0);
    assert.equal((await feed(reader)).total, 0);
    await visibility(owner, note, 'friends');
    const supplement = await createNote(owner, { title: 'qa_分享后补充', parent_id: note.id });
    const promoted = await api('POST', `/notes/${note.id}/promote`, { token: owner.token, body: { title: 'qa_提炼', kind: 'summary' } });
    assert.equal(promoted.status, 201, promoted.text);
    const parent = promoted.body.data.note;
    for (const n of [child, supplement, parent]) {
      const own = await ownNote(owner, n);
      assert.equal(own.visibility, 'private');
      assert.equal(own.shared_at, null);
    }
    assert.equal((await ownNote(owner, note)).visibility, 'friends');
    for (const user of [owner, reader]) assert.deepEqual((await feed(user)).items.map((n) => n.id), [note.id]);
    const error = await canonical404(reader);
    for (const n of [child, supplement, parent]) await denied(reader, n.id, error);
  });

  test('visibility：仅作者可改、严格字段和枚举、非法/缺失/已删 ID 同码同文', async () => {
    const { owner, reader, note } = await pair();
    const stranger = await register('qa_feed_x');
    const badBodies = [
      {}, { visibility: null }, { visibility: '' }, { visibility: 'public' }, { visibility: 'Friends' },
      { visibility: 1 }, { visibility: true }, { visibility: ['friends'] }, { visibility: {} },
    ];
    for (const body of badBodies) {
      const res = await api('PUT', `/notes/${note.id}/visibility`, { token: owner.token, body });
      assert.equal(res.status, 400, res.text);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      noStore(res);
    }
    for (const field of ['user_id', 'title', 'content', 'kind', 'shared_at', 'updated_at', 'status']) {
      const res = await api('PUT', `/notes/${note.id}/visibility`, {
        token: owner.token, body: { visibility: 'friends', [field]: 'qa_非法字段' },
      });
      assert.equal(res.status, 400, field);
      assert.deepEqual(res.body.error.details.unknown, [field]);
      noStore(res);
    }
    for (const [method, path, body] of [
      ['POST', '/notes', { title: 'qa_不能创建时共享', visibility: 'friends' }],
      ['PUT', `/notes/${note.id}`, { title: 'qa_不能编辑时共享', visibility: 'friends' }],
      ['POST', `/notes/${note.id}/promote`, { title: 'qa_不能提炼时共享', visibility: 'friends' }],
    ]) {
      const res = await api(method, path, { token: owner.token, body });
      assert.equal(res.status, 400, res.text);
    }
    assert.equal((await ownNote(owner, note)).visibility, 'private');
    const missing = await api('PUT', `/notes/${MISSING_ID}/visibility`, { token: owner.token, body: { visibility: 'friends' } });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'NOTE_NOT_FOUND');
    noStore(missing);
    await visibility(owner, note, 'friends');
    for (const user of [reader, stranger]) {
      for (const value of ['private', 'friends']) {
        const res = await api('PUT', `/notes/${note.id}/visibility`, { token: user.token, body: { visibility: value } });
        assert.equal(res.status, 404, res.text);
        assert.deepEqual(res.body, missing.body);
        noStore(res);
      }
    }
    for (const id of ['abc', '0', '-1', '01', '1.5', '1e2', '9007199254740993']) {
      const res = await api('PUT', `/notes/${id}/visibility`, { token: owner.token, body: { visibility: 'friends' } });
      assert.equal(res.status, 404, id);
      assert.deepEqual(res.body, missing.body);
      noStore(res);
    }
    assert.equal((await api('DELETE', `/notes/${note.id}`, { token: owner.token })).status, 200);
    const deleted = await api('PUT', `/notes/${note.id}/visibility`, { token: owner.token, body: { visibility: 'friends' } });
    assert.equal(deleted.status, 404);
    assert.deepEqual(deleted.body, missing.body);
    noStore(deleted);
  });

  test('动态包含本人和双向已接受读友；第三者、未接受和非传递关系不能访问', async () => {
    const { owner, reader, note } = await pair();
    const third = await register('qa_feed_third');
    const incoming = await register('qa_feed_in');
    const outgoing = await register('qa_feed_out');
    await befriend(third, reader);
    for (const [from, to] of [[incoming, owner], [owner, outgoing]]) {
      const req = await api('POST', '/friends/requests', { token: from.token, body: { username: to.username } });
      assert.equal(req.status, 201, req.text);
    }
    const otherNotes = [];
    for (const user of [reader, third, incoming, outgoing]) {
      const n = await createNote(user, { title: `qa_${user.username}_共享` });
      await visibility(user, n, 'friends');
      otherNotes.push(n);
    }
    await createNote(owner, { title: 'qa_本人未分享' });
    await createNote(reader, { title: 'qa_读友未分享' });
    await visibility(owner, note, 'friends');
    const ids = async (user) => (await feed(user)).items.map((n) => n.id).sort((a, b) => a - b);
    assert.deepEqual(await ids(owner), [note.id, otherNotes[0].id].sort((a, b) => a - b));
    assert.deepEqual(await ids(reader), [note.id, otherNotes[0].id, otherNotes[1].id].sort((a, b) => a - b));
    assert.deepEqual(await ids(third), [otherNotes[0].id, otherNotes[1].id].sort((a, b) => a - b));
    assert.equal((await detail(owner, otherNotes[0])).author.user_id, reader.id);
    assert.equal((await detail(reader, note)).author.user_id, owner.id);
    const error = await canonical404(owner);
    for (const user of [third, incoming, outgoing]) await denied(user, note.id, error);
    for (const n of otherNotes.slice(1)) await denied(owner, n.id, error);
  });

  test('list/detail DTO 白名单：不泄露私密祖先、子孙、标签和讨论；列表只给片段', async () => {
    const { owner, reader } = await pair();
    const ancestorSecret = 'qa_私密祖先唯一秘密';
    const descendantSecret = 'qa_私密子孙唯一秘密';
    const tagSecret = 'qa_隐藏标签';
    const talkSecret = 'qa_隐藏讨论唯一秘密';
    const root = await createNote(owner, { title: ancestorSecret, content: ancestorSecret });
    const quote = `qa_公开引文${'引'.repeat(1_000)}qa_引文末尾`;
    const content = `**qa_公开正文**\n\n${'公开内容 '.repeat(150)}qa_正文末尾`;
    const note = await createNote(owner, { title: 'qa_仅共享中间节点', quote, content, parent_id: root.id, kind: 'question' });
    await createNote(owner, { title: descendantSecret, content: descendantSecret, parent_id: note.id });
    const tagRes = await api('POST', '/tags', { token: owner.token, body: { name: tagSecret } });
    assert.equal(tagRes.status, 201, tagRes.text);
    const tagged = await api('PUT', `/notes/${note.id}/tags`, { token: owner.token, body: { tag_ids: [tagRes.body.data.tag.id] } });
    assert.equal(tagged.status, 200, tagged.text);
    const talk = await api('POST', '/discussions', { token: owner.token, body: { note_id: note.id, invitee_ids: [reader.id] } });
    assert.equal(talk.status, 201, talk.text);
    assert.equal((await send(owner, talk.body.data.discussion_id, talkSecret)).status, 201);
    await visibility(owner, note, 'friends');
    const list = await feed(reader);
    assert.equal(list.total, 1);
    const item = list.items[0];
    keys(item, LIST_FIELDS);
    keys(item.author, PUBLIC_USER_FIELDS);
    assert.equal(item.id, note.id);
    assert.equal(item.kind, 'question');
    assert.equal(item.author.user_id, owner.id);
    assert.equal(item.author.username, owner.username);
    assert.equal(item.author.nickname, owner.nickname);
    assert.deepEqual(item.author.avatar, owner.avatar);
    assert.ok(Array.isArray(item.author.badges));
    assert.equal(item.like_count, 0);
    assert.equal(item.liked, false);
    assert.ok(item.quote.startsWith('qa_公开引文'));
    assert.ok(item.quote.length < quote.length, '列表引文应截断');
    assert.ok(item.excerpt.includes('qa_公开正文'));
    assert.ok(item.excerpt.length < content.length, '摘要不能返回完整正文');
    assert.ok(!item.excerpt.includes('**'), '摘要使用正文纯文本');
    assert.ok(!JSON.stringify(item).includes('qa_正文末尾'));
    assert.ok(!JSON.stringify(item).includes('qa_引文末尾'));
    const full = await detail(reader, note);
    keys(full.author, PUBLIC_USER_FIELDS);
    assert.equal(full.quote, quote);
    assert.equal(full.content, content);
    assert.equal(full.shared_at, item.shared_at);
    for (const dto of [list, full]) {
      const text = JSON.stringify(dto);
      for (const secret of [ancestorSecret, descendantSecret, tagSecret, talkSecret]) assert.ok(!text.includes(secret), secret);
    }
    // 原讨论快照可以包含祖先，但不得被 feed DTO 借道返回。
    assert.equal((await api('GET', `/discussions/${talk.body.data.discussion_id}/messages`, { token: reader.token })).status, 200);
  });

  test('默认 10、最大 50、跨页不重复；shared_at DESC 再 id DESC 而非编辑时间', async () => {
    const { owner, reader } = await pair();
    const notes = [];
    for (let i = 0; i < 12; i += 1) {
      const author = i % 2 ? reader : owner;
      const n = await createNote(author, { title: `qa_分页_${i}` });
      await visibility(author, n, 'friends');
      const shared = i < 6 ? '2020-01-02 00:00:00.000' : '2020-01-01 00:00:00.000';
      await db().query('UPDATE note SET shared_at = ?, updated_at = ? WHERE id = ?', [shared, `2021-01-${String(i + 1).padStart(2, '0')} 00:00:00.000`, n.id]);
      notes.push(n);
    }
    const expected = [...notes.slice(0, 6).reverse(), ...notes.slice(6).reverse()].map((n) => n.id);
    const first = await feed(owner);
    assert.equal(first.page, 1);
    assert.equal(first.page_size, 10);
    assert.equal(first.total, 12);
    assert.equal(first.has_more, true);
    assert.deepEqual(first.items.map((n) => n.id), expected.slice(0, 10));
    const second = await feed(owner, '?page=2');
    assert.equal(second.page, 2);
    assert.equal(second.page_size, 10);
    assert.equal(second.total, 12);
    assert.equal(second.has_more, false);
    assert.deepEqual(second.items.map((n) => n.id), expected.slice(10));
    const allIds = [...first.items, ...second.items].map((n) => n.id);
    assert.equal(new Set(allIds).size, 12);
    const seen = [];
    for (let page = 1; page <= 4; page += 1) {
      const data = await feed(reader, `?page=${page}&page_size=3`);
      assert.equal(data.page, page);
      assert.equal(data.page_size, 3);
      assert.equal(data.total, 12);
      assert.equal(data.has_more, page < 4);
      seen.push(...data.items.map((n) => n.id));
    }
    assert.deepEqual(seen, expected);
    const beyond = await feed(owner, '?page=9&page_size=3');
    assert.deepEqual(beyond.items, []);
    assert.equal(beyond.total, 12);
    assert.equal(beyond.has_more, false);
    const max = await feed(owner, '?page_size=50');
    assert.equal(max.page_size, 50);
    assert.deepEqual(max.items.map((n) => n.id), expected);
    for (const query of ['page=0', 'page=-1', 'page=x', 'page=1.5', 'page_size=0', 'page_size=51', 'page_size=x']) {
      const res = await api('GET', `/feed?${query}`, { token: owner.token });
      assert.equal(res.status, 400, query);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      noStore(res);
    }
  });

  test('重复 visibility 和点赞不改 shared_at/updated_at，也不顶序', async () => {
    const { owner, reader, note } = await pair();
    const newer = await createNote(owner, { title: 'qa_排在前面' });
    // 固定旧时间，避免同一毫秒内错误更新时间的实现侥幸通过。
    await db().query("UPDATE note SET updated_at = '2000-01-01 00:00:00.000' WHERE id = ?", [note.id]);
    const privateState = await timestamps(note);
    await visibility(owner, note, 'private');
    await visibility(owner, note, 'private');
    assert.deepEqual(await timestamps(note), privateState);
    await visibility(owner, note, 'friends');
    assert.equal((await timestamps(note)).updated_at, privateState.updated_at, '首次分享也不是内容编辑');
    await visibility(owner, newer, 'friends');
    await db().query("UPDATE note SET shared_at = '2020-01-01 00:00:00.000' WHERE id = ?", [note.id]);
    await db().query("UPDATE note SET shared_at = '2020-01-02 00:00:00.000' WHERE id = ?", [newer.id]);
    const before = await timestamps(note);
    const beforeOwn = await ownNote(owner, note);
    for (let i = 0; i < 2; i += 1) {
      const again = await visibility(owner, note, 'friends');
      assert.equal(again.shared_at, beforeOwn.shared_at);
      assert.deepEqual(await timestamps(note), before);
    }
    for (const method of ['PUT', 'PUT', 'DELETE', 'DELETE']) {
      await like(reader, note, method);
      assert.deepEqual(await timestamps(note), before);
      assert.deepEqual((await feed(reader)).items.map((n) => n.id), [newer.id, note.id]);
    }
  });

  test('正常编辑更新时间但不改分享时间/排序；详情、摘要和作者信息 live 读取', async () => {
    const { owner, reader, note } = await pair();
    const newer = await createNote(owner, { title: 'qa_编辑前排序锚点' });
    await visibility(owner, note, 'friends');
    await visibility(owner, newer, 'friends');
    await db().query("UPDATE note SET shared_at = '2020-01-01 00:00:00.000', updated_at = '2000-01-01 00:00:00.000' WHERE id = ?", [note.id]);
    await db().query("UPDATE note SET shared_at = '2020-01-02 00:00:00.000' WHERE id = ?", [newer.id]);
    const before = await timestamps(note);
    const input = { title: 'qa_编辑后标题', quote: 'qa_编辑后引文', content: '**qa_编辑后正文**', kind: 'summary' };
    const edited = await api('PUT', `/notes/${note.id}`, { token: owner.token, body: input });
    assert.equal(edited.status, 200, edited.text);
    const after = await timestamps(note);
    assert.equal(after.shared_at, before.shared_at);
    assert.ok(after.updated_at > before.updated_at, '正常内容编辑应更新 updated_at');
    const own = await ownNote(owner, note);
    assert.equal(own.visibility, 'friends');
    assert.equal(own.shared_at, edited.body.data.note.shared_at);
    const full = await detail(reader, note);
    for (const field of ['title', 'quote', 'content', 'kind']) assert.equal(full[field], input[field]);
    assert.equal(full.shared_at, own.shared_at);
    const list = await feed(reader);
    assert.deepEqual(list.items.map((n) => n.id), [newer.id, note.id]);
    assert.equal(list.items[1].excerpt, 'qa_编辑后正文');
    assert.equal(list.items[1].quote, input.quote);
    const same = await api('PUT', `/notes/${note.id}`, { token: owner.token, body: input });
    assert.equal(same.status, 200, same.text);
    assert.deepEqual(await timestamps(note), after, '相同内容的重复编辑不更新时间');
    const profile = await api('PATCH', '/users/me', { token: owner.token, body: { nickname: 'qa_分享后新昵称' } });
    assert.equal(profile.status, 200, profile.text);
    assert.equal((await detail(reader, note)).author.nickname, 'qa_分享后新昵称');
    assert.equal((await feed(reader)).items[1].author.nickname, 'qa_分享后新昵称');
  });

  test('点赞与取消幂等；Promise.all 同用户不重复、多用户计数、交错写入一致', async () => {
    const { owner, reader, note } = await pair();
    const another = await register('qa_feed_like');
    await befriend(another, owner);
    await visibility(owner, note, 'friends');
    const [primary] = await db().query("SHOW KEYS FROM note_like WHERE Key_name = 'PRIMARY'");
    assert.deepEqual(primary.map((row) => row.Column_name).sort(), ['note_id', 'user_id']);
    const puts = await Promise.all(Array.from({ length: 6 }, () => like(reader, note)));
    for (const data of puts) assert.deepEqual(data, { liked: true, like_count: 1 });
    assert.equal(await storedLikes(note), 1);
    assert.deepEqual(await like(another, note), { liked: true, like_count: 2 });
    assert.equal(await storedLikes(note), 2);
    assert.equal((await detail(owner, note)).liked, false);
    assert.equal((await detail(owner, note)).like_count, 2);
    assert.equal((await detail(reader, note)).liked, true);
    assert.equal((await feed(reader)).items[0].liked, true);
    const deletes = await Promise.all(Array.from({ length: 6 }, () => like(reader, note, 'DELETE')));
    for (const data of deletes) assert.deepEqual(data, { liked: false, like_count: 1 });
    assert.equal(await storedLikes(note), 1);
    assert.deepEqual(await like(another, note, 'DELETE'), { liked: false, like_count: 0 });
    const interleaved = await Promise.all(['PUT', 'DELETE', 'PUT', 'DELETE', 'PUT', 'DELETE'].map((method) => like(reader, note, method)));
    assert.ok(interleaved.every((data) => data.like_count <= 1));
    const count = await storedLikes(note);
    assert.ok(count === 0 || count === 1);
    const current = await detail(reader, note);
    assert.equal(current.like_count, count);
    assert.equal(current.liked, count === 1, '最终状态与实际唯一赞行一致，不假定并发完成顺序');
    assert.deepEqual(await like(reader, note, 'DELETE'), { liked: false, like_count: 0 });
    assert.deepEqual(await like(reader, note, 'DELETE'), { liked: false, like_count: 0 });
    assert.equal(await storedLikes(note), 0);
  });

  test('作者笔记列表：喜欢计数、取消与历史赞；筛选、排序、分页和作者隔离不变', async () => {
    const { owner, reader, note } = await pair();
    const another = await register('qa_feed_count');
    await befriend(another, owner);
    const others = [];
    for (let i = 0; i < 11; i += 1) {
      others.push(await createNote(owner, { title: `qa_计数分页_${i}`, kind: 'summary' }));
    }
    const expected = [...others].reverse().map((n) => n.id).concat(note.id);
    const list = async (user, query = '') => {
      const res = await api('GET', `/notes?view=list${query}`, { token: user.token });
      assert.equal(res.status, 200, res.text);
      for (const item of res.body.data.items) {
        assert.ok(Number.isInteger(item.like_count) && item.like_count >= 0);
        assert.equal(Object.hasOwn(item, 'liked'), false);
        assert.equal(Object.hasOwn(item, 'likers'), false);
      }
      return res.body.data;
    };
    const count = async () => {
      const data = await list(owner, `&q=${encodeURIComponent(note.title)}`);
      assert.equal(data.total, 1);
      assert.equal(data.items[0].id, note.id);
      return data.items[0].like_count;
    };
    assert.equal(await count(), 0);
    await visibility(owner, note, 'friends');
    await like(reader, note);
    await like(another, note);
    assert.equal(await count(), 2);
    await like(reader, note, 'DELETE');
    assert.equal(await count(), 1);

    const tagRes = await api('POST', '/tags', { token: owner.token, body: { name: 'qa_喜欢统计' } });
    assert.equal(tagRes.status, 201, tagRes.text);
    const tagId = tagRes.body.data.tag.id;
    assert.equal((await api('PUT', `/notes/${note.id}/tags`, { token: owner.token, body: { tag_ids: [tagId] } })).status, 200);
    const filtered = await list(owner, `&tag=${tagId}&kind=viewpoint&discussion=none&sort=created`);
    assert.equal(filtered.total, 1);
    assert.equal(filtered.items[0].id, note.id);
    assert.equal(filtered.items[0].like_count, 1);
    assert.equal((await list(owner, `&tag=${tagId}&kind=summary`)).total, 0);

    for (const sort of ['updated', 'created']) {
      const first = await list(owner, `&sort=${sort}`);
      const second = await list(owner, `&sort=${sort}&page=2`);
      assert.equal(first.page_size, 10);
      assert.equal(first.total, 12);
      assert.equal(first.has_more, true);
      assert.equal(second.total, 12);
      assert.equal(second.has_more, false);
      assert.deepEqual([...first.items, ...second.items].map((n) => n.id), expected);
      assert.ok(first.items.every((n) => n.like_count === 0));
      assert.equal(second.items.find((n) => n.id === note.id).like_count, 1);
    }
    await visibility(owner, note, 'private');
    assert.equal(await count(), 1, '撤回分享不清除作者可见的历史赞数');
    await visibility(owner, note, 'friends');
    assert.equal((await api('DELETE', `/friends/${owner.id}`, { token: another.token })).status, 200);
    assert.equal(await count(), 1, '解除关系不清除历史赞数');
    const readerNote = await createNote(reader, { title: 'qa_读友自己的笔记' });
    const readerList = await list(reader);
    assert.deepEqual(readerList.items.map((n) => n.id), [readerNote.id]);
    assert.equal(readerList.items[0].like_count, 0);
    const forbidden = await api('GET', `/notes/${note.id}`, { token: reader.token });
    assert.equal(forbidden.status, 404);
    assert.equal((await api('DELETE', `/notes/${note.id}`, { token: owner.token })).status, 200);
    assert.equal((await list(owner)).total, 11);
    assert.equal((await list(owner, `&q=${encodeURIComponent(note.title)}`)).total, 0);
  });

  test('私密/陌生/待接受/缺失/非法 ID/自赞均 404 FEED_NOTE_NOT_FOUND，同码同文', async () => {
    const { owner, reader, note } = await pair();
    const stranger = await register('qa_feed_denied');
    const pending = await register('qa_feed_pending');
    const req = await api('POST', '/friends/requests', { token: owner.token, body: { username: pending.username } });
    assert.equal(req.status, 201, req.text);
    const error = await canonical404(reader);
    for (const user of [owner, reader, stranger, pending]) await denied(user, note.id, error);
    for (const id of [MISSING_ID, 'abc', '0', '-1', '01', '1.5', '1e2', '9007199254740993']) await denied(reader, id, error);
    await visibility(owner, note, 'friends');
    await detail(owner, note);
    await denied(owner, note.id, error, ['PUT', 'DELETE']);
    for (const user of [stranger, pending]) await denied(user, note.id, error);
    assert.equal(await storedLikes(note), 0);
  });

  test('撤回清空时间并立刻隐藏；重新分享换时间且历史赞保留', async () => {
    const { owner, reader, note } = await pair();
    await visibility(owner, note, 'friends');
    await db().query("UPDATE note SET shared_at = '2020-01-01 00:00:00.000', updated_at = '2000-01-01 00:00:00.000' WHERE id = ?", [note.id]);
    const old = await timestamps(note);
    assert.deepEqual(await like(reader, note), { liked: true, like_count: 1 });
    await visibility(owner, note, 'private');
    assert.deepEqual(await timestamps(note), { shared_at: null, updated_at: old.updated_at });
    const own = await ownNote(owner, note);
    assert.equal(own.visibility, 'private');
    assert.equal(own.shared_at, null);
    for (const user of [owner, reader]) assert.equal((await feed(user)).total, 0);
    const error = await canonical404(reader);
    await denied(reader, note.id, error);
    assert.equal(await storedLikes(note), 1, '私密时取消赞不得删除历史赞');
    await visibility(owner, note, 'private');
    assert.deepEqual(await timestamps(note), { shared_at: null, updated_at: old.updated_at });
    await visibility(owner, note, 'friends');
    const next = await timestamps(note);
    assert.ok(next.shared_at > old.shared_at, '再分享必须产生新分享时间');
    assert.equal(next.updated_at, old.updated_at);
    const restored = await detail(reader, note);
    assert.equal(restored.like_count, 1);
    assert.equal(restored.liked, true);
    assert.deepEqual(await like(reader, note), { liked: true, like_count: 1 });
    assert.equal((await feed(reader)).items[0].like_count, 1);
  });

  test('解除关系双向隐藏且拒赞；反向加回恢复原时间和历史赞', async () => {
    const { owner, reader, note } = await pair();
    const reverse = await createNote(reader, { title: 'qa_双向分享' });
    await visibility(owner, note, 'friends');
    await visibility(reader, reverse, 'friends');
    await like(reader, note);
    const old = await timestamps(note);
    const removed = await api('DELETE', `/friends/${owner.id}`, { token: reader.token });
    assert.equal(removed.status, 200, removed.text);
    assert.deepEqual((await feed(owner)).items.map((n) => n.id), [note.id]);
    assert.deepEqual((await feed(reader)).items.map((n) => n.id), [reverse.id]);
    const error = await canonical404(reader);
    await denied(reader, note.id, error);
    await denied(owner, reverse.id, error);
    assert.equal(await storedLikes(note), 1);
    await befriend(reader, owner);
    const restored = await detail(reader, note);
    assert.equal(restored.liked, true);
    assert.equal(restored.like_count, 1);
    assert.deepEqual(await timestamps(note), old, '恢复关系不应重新分享');
    await detail(owner, reverse);
    assert.deepEqual(await like(reader, note, 'DELETE'), { liked: false, like_count: 0 });
  });

  test('删除笔记或停用作者：列表立即排除，详情/点赞/取消同码同文', async () => {
    const { owner, reader, note } = await pair();
    const remaining = await createNote(owner, { title: 'qa_停用作者的共享' });
    await visibility(owner, note, 'friends');
    await visibility(owner, remaining, 'friends');
    await like(reader, note);
    await like(reader, remaining);
    const error = await canonical404(reader);
    assert.equal((await api('DELETE', `/notes/${note.id}`, { token: owner.token })).status, 200);
    await denied(reader, note.id, error);
    assert.deepEqual((await feed(reader)).items.map((n) => n.id), [remaining.id]);
    await db().query('UPDATE `user` SET status = 0 WHERE id = ?', [owner.id]);
    try {
      const hidden = await feed(reader);
      assert.equal(hidden.total, 0);
      assert.deepEqual(hidden.items, []);
      await denied(reader, remaining.id, error);
      assert.equal(await storedLikes(remaining), 1, '停用作者不能借取消赞改写历史记录');
    } finally {
      await db().query('UPDATE `user` SET status = 1 WHERE id = ?', [owner.id]);
    }
  });

  test('行锁竞态：点赞等待笔记锁，撤回先提交后拒绝且无新赞', { timeout: 20_000 }, async () => {
    const fixture = await pair();
    // 从实际默认私密行读取存储值，不依赖 visibility 是数字还是字符串。
    const [[{ visibility: privateVisibility }]] = await db().query('SELECT visibility FROM note WHERE id = ?', [fixture.note.id]);
    await visibility(fixture.owner, fixture.note, 'friends');
    await revokeWhileLikeWaits(fixture, 'note', privateVisibility);
    assert.equal((await ownNote(fixture.owner, fixture.note)).shared_at, null);
  });

  test('行锁竞态：点赞等待友情锁，解除先提交后拒绝且无新赞', { timeout: 20_000 }, async () => {
    const fixture = await pair();
    await visibility(fixture.owner, fixture.note, 'friends');
    await revokeWhileLikeWaits(fixture, 'friendship');
    assert.equal((await ownNote(fixture.owner, fixture.note)).visibility, 'friends', '这里只撤销读友关系，不撤销笔记分享');
  });
});
