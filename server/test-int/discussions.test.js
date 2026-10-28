import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { api, befriend, clientId, createNote, db, register, send, setup } from './helpers.js';

await setup();

let host, r1, r2, stranger;

before(async () => {
  host = await register('dsh');
  r1 = await register('dsr');
  r2 = await register('dsr');
  stranger = await register('dss');
  await befriend(host, r1);
  await befriend(host, r2);
});

const start = async (invitees = [r1.id], note) => {
  const n = note ?? (await createNote(host, { title: '一场', content: '底稿' }));
  const res = await api('POST', '/discussions', { token: host.token, body: { note_id: n.id, invitee_ids: invitees } });
  assert.equal(res.status, 201, res.text);
  return { id: res.body.data.discussion_id, note: n, created: res.body.data };
};
const transition = (user, id, action) => api('POST', `/discussions/${id}/transition`, { token: user.token, body: { action } });
const count = async (sql, args) => Number((await db().query(sql, args))[0][0].n);

test('同一笔记重复发起：409 DISCUSSION_EXISTS 并带回已有讨论 id', async () => {
  const { id, note } = await start();
  const dup = await api('POST', '/discussions', { token: host.token, body: { note_id: note.id } });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, 'DISCUSSION_EXISTS');
  assert.equal(dup.body.error.details.discussion_id, id);
});

test('并发重复发起：恰好一场成功，其余 409', async () => {
  const note = await createNote(host, { title: '并发', content: 'x' });
  const results = await Promise.all(
    Array.from({ length: 4 }, () => api('POST', '/discussions', { token: host.token, body: { note_id: note.id } })),
  );
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [201, 409, 409, 409]);
  assert.equal(await count('SELECT COUNT(*) AS n FROM discussion WHERE note_id = ?', [note.id]), 1);
});

test('邀请含非读友：整单 403 且事务回滚，不留下讨论', async () => {
  const note = await createNote(host, { title: '回滚', content: 'x' });
  const res = await api('POST', '/discussions', { token: host.token, body: { note_id: note.id, invitee_ids: [r1.id, stranger.id] } });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'INVITEE_NOT_FRIEND');
  assert.deepEqual(res.body.error.details.user_ids, [stranger.id]);
  assert.equal(await count('SELECT COUNT(*) AS n FROM discussion WHERE note_id = ?', [note.id]), 0);
});

test('追加邀请：已在场者跳过，新读友加入；完结后不能再邀请', async () => {
  const { id } = await start([r1.id]);
  const more = await api('POST', `/discussions/${id}/invitations`, { token: host.token, body: { invitee_ids: [r1.id, r2.id, host.id] } });
  assert.equal(more.status, 200);
  assert.deepEqual(more.body.data.invited.map((u) => u.user_id), [r2.id]);
  assert.deepEqual(more.body.data.skipped.sort(), [host.id, r1.id].sort());
  assert.equal((await api('GET', `/discussions/${id}`, { token: r2.token })).status, 200);
  assert.equal((await transition(host, id, 'end')).status, 200);
  const late = await api('POST', `/discussions/${id}/invitations`, { token: host.token, body: { invitee_ids: [r2.id] } });
  assert.equal(late.status, 409);
  assert.equal(late.body.error.code, 'DISCUSSION_NOT_ACTIVE');
});

test('状态机：合法路径通过，非法流转 409', async () => {
  const { id } = await start();
  const expect409 = async (action) => {
    const res = await transition(host, id, action);
    assert.equal(res.status, 409, action);
    assert.equal(res.body.error.code, 'INVALID_TRANSITION');
  };
  await expect409('reopen');
  await expect409('archive');
  await expect409('unarchive');
  assert.equal((await transition(host, id, 'end')).body.data.status, 'ended');
  await expect409('end');
  await expect409('unarchive');
  assert.equal((await transition(host, id, 'archive')).body.data.status, 'archived');
  await expect409('end');
  await expect409('reopen');
  assert.equal((await transition(host, id, 'unarchive')).body.data.status, 'ended');
  assert.equal((await transition(host, id, 'reopen')).body.data.status, 'active');
  const bad = await transition(host, id, 'delete');
  assert.equal(bad.status, 400);
});

test('完结/存档后不能发言；重开后恢复', async () => {
  const { id } = await start();
  await transition(host, id, 'end');
  const ended = await send(r1, id, '完结后');
  assert.equal(ended.status, 409);
  assert.equal(ended.body.error.code, 'DISCUSSION_NOT_ACTIVE');
  await transition(host, id, 'archive');
  assert.equal((await send(host, id, '存档后')).body.error.message, '这场讨论已存档');
  await transition(host, id, 'unarchive');
  await transition(host, id, 'reopen');
  assert.equal((await send(r1, id, '重开后')).status, 201);
});

test('消息：校验、幂等重放 200、他人复用标识 409、楼层连续', async () => {
  const { id } = await start([r1.id, r2.id]);
  assert.equal((await send(r1, id, '   ')).status, 400);
  assert.equal((await send(r1, id, 'x'.repeat(2001))).status, 400);
  assert.equal((await send(r1, id, '字'.repeat(2000))).status, 201);
  assert.equal((await send(r1, id, 'ok', 'short')).status, 400);

  const cid = clientId();
  const first = await send(r1, id, '第一次', cid);
  assert.equal(first.status, 201);
  const replay = await send(r1, id, '第一次', cid);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.data.message.id, first.body.data.message.id);
  const clash = await send(r2, id, '冒用', cid);
  assert.equal(clash.status, 409);
  assert.equal(clash.body.error.code, 'CLIENT_ID_CONFLICT');

  const burst = await Promise.all(Array.from({ length: 6 }, (_, i) => send(i % 2 ? r1 : r2, id, `并发 ${i}`)));
  assert.ok(burst.every((r) => r.status === 201));
  const { messages } = (await api('GET', `/discussions/${id}/messages`, { token: host.token })).body.data;
  assert.deepEqual(
    messages.map((m) => m.seq),
    messages.map((_, i) => i + 1),
  );
  // client_message_id 只回给本人
  assert.ok(messages.every((m) => m.is_mine === false && m.client_message_id === undefined));
  const after = (await api('GET', `/discussions/${id}/messages?after_id=${messages[3].id}`, { token: host.token })).body.data;
  assert.equal(after.messages.length, messages.length - 4);
  assert.equal((await api('GET', `/discussions/${id}/messages?after_id=-1`, { token: host.token })).status, 400);
});

test('消息窗口：latest 取最近一页，before_id 向前，参数互斥', async () => {
  const { id } = await start([r1.id]);
  for (let i = 0; i < 5; i++) {
    assert.equal((await send(host, id, `窗口 ${i}`)).status, 201);
  }
  const all = (await api('GET', `/discussions/${id}/messages?after_id=0`, { token: host.token })).body.data;
  const latest = (await api('GET', `/discussions/${id}/messages?latest=1`, { token: host.token })).body.data;
  assert.deepEqual(
    latest.messages.map((m) => m.id),
    all.messages.map((m) => m.id),
  );
  assert.equal(latest.has_more, false);

  const cut = all.messages[3].id;
  const older = (await api('GET', `/discussions/${id}/messages?before_id=${cut}`, { token: host.token })).body.data;
  assert.deepEqual(
    older.messages.map((m) => m.id),
    all.messages.slice(0, 3).map((m) => m.id),
  );
  assert.equal(older.has_more, false);

  const conflict = await api('GET', `/discussions/${id}/messages?after_id=0&before_id=${cut}`, { token: host.token });
  assert.equal(conflict.status, 400);
  assert.equal((await api('GET', `/discussions/${id}/messages?latest=2`, { token: host.token })).status, 400);
});

test('消息窗口：超过一页时 has_more 指向更早', async () => {
  const { id } = await start([r1.id]);
  const now = Date.now();
  const rows = Array.from({ length: 201 }, (_, i) => [id, i + 1, host.id, `窗口 ${i}`, clientId(), new Date(now + i)]);
  await db().query('INSERT INTO message (discussion_id, seq, sender_id, content, client_message_id, created_at) VALUES ?', [rows]);

  const latest = (await api('GET', `/discussions/${id}/messages?latest=1`, { token: host.token })).body.data;
  assert.equal(latest.messages.length, 200);
  assert.equal(latest.has_more, true);
  assert.equal(latest.messages.at(-1).seq, 201);

  const older = (await api('GET', `/discussions/${id}/messages?before_id=${latest.messages[0].id}`, { token: host.token })).body.data;
  assert.equal(older.messages.length, 1);
  assert.equal(older.messages[0].seq, 1);
  assert.equal(older.has_more, false);
});

test('未读：他人消息计入，已读后清零，完结即清零；导航徽标计数', async () => {
  const { id } = await start([r1.id]);
  await api('POST', `/discussions/${id}/read`, { token: r1.token });
  await send(host, id, '一');
  await send(host, id, '二');
  const unreadOf = async (u) => (await api('GET', '/discussions', { token: u.token })).body.data.items.find((d) => d.id === id).unread;
  assert.equal(await unreadOf(r1), 2);
  assert.equal(await unreadOf(host), 0);
  assert.ok((await api('GET', '/discussions/unread', { token: r1.token })).body.data.count >= 1);
  await api('POST', `/discussions/${id}/read`, { token: r1.token });
  assert.equal(await unreadOf(r1), 0);
  await send(host, id, '三');
  assert.equal(await unreadOf(r1), 1);
  await transition(host, id, 'end');
  const ended = (await api('GET', '/discussions?status=ended', { token: r1.token })).body.data;
  assert.equal(ended.items.find((d) => d.id === id).unread, 0);
  assert.ok(ended.counts.ended >= 1);
});

test('删除原笔记：子笔记升为顶层，讨论与快照照常可用', async () => {
  const parent = await createNote(host, { title: '父', quote: '父的引文', content: '父的正文' });
  const child = await createNote(host, { title: '子', content: '子的正文', parent_id: parent.id });
  const { id } = await start([r1.id], child);
  await send(r1, id, '删之前');
  const del = await api('DELETE', `/notes/${parent.id}`, { token: host.token });
  assert.equal(del.status, 200);
  assert.equal(del.body.data.promoted_children, 1);
  const moved = (await api('GET', `/notes/${child.id}`, { token: host.token })).body.data.note;
  assert.equal(moved.parent_id ?? null, null);

  const own = await createNote(host, { title: '自删', content: '原文' });
  const t2 = await start([r1.id], own);
  await api('DELETE', `/notes/${own.id}`, { token: host.token });
  const view = await api('GET', `/discussions/${t2.id}`, { token: r1.token });
  assert.equal(view.status, 200);
  assert.equal(view.body.data.discussion.snapshot.content, '原文');
  assert.equal(view.body.data.discussion.note_has_newer_version, false);
  assert.equal((await send(r1, t2.id, '笔记删了还能聊')).status, 201);

  // 快照之后编辑原笔记：发起人看到「有新版本」，快照不变
  const edited = await createNote(host, { title: '会改', content: '旧' });
  const t3 = await start([r1.id], edited);
  await new Promise((r) => setTimeout(r, 20));
  await api('PUT', `/notes/${edited.id}`, { token: host.token, body: { title: '会改', content: '新' } });
  const d3 = (await api('GET', `/discussions/${t3.id}`, { token: host.token })).body.data.discussion;
  assert.equal(d3.note_has_newer_version, true);
  assert.equal(d3.snapshot.content, '旧');
});

test('徽章：幂等写入，重放不重复，公开形状只含 code/name', async () => {
  const h = await register('bdh');
  const a = await register('bdr');
  const b = await register('bdr');
  const c = await register('bdr');
  for (const u of [a, b, c]) await befriend(h, u);
  const note = await createNote(h, { title: '徽章', content: 'x' });
  const created = await api('POST', '/discussions', { token: h.token, body: { note_id: note.id, invitee_ids: [a.id, b.id, c.id] } });
  assert.deepEqual(created.body.data.new_badges.map((x) => x.code), ['kindler']);
  const id = created.body.data.discussion_id;

  const cid = clientId();
  const first = await send(a, id, '破冰', cid);
  assert.deepEqual(first.body.data.new_badges.map((x) => x.code), ['icebreaker']);
  const replay = await send(a, id, '破冰', cid);
  assert.deepEqual(replay.body.data.new_badges, []);
  assert.deepEqual((await send(a, id, '再说一句')).body.data.new_badges, []);
  assert.equal(await count('SELECT COUNT(*) AS n FROM user_badge WHERE user_id = ?', [a.id]), 1);

  await send(b, id, '第二位');
  const third = await send(c, id, '第三位');
  assert.deepEqual(third.body.data.new_badges.map((x) => x.code), ['icebreaker']);
  // 满座归发起人
  const wallOf = async () => (await api('GET', '/users/me/badges', { token: h.token })).body.data.badges;
  const wall = await wallOf();
  assert.ok(wall.find((x) => x.code === 'fullhouse').earned && wall.find((x) => x.code === 'fullhouse').awarded_at);
  // 发起人在自己的讨论里发言不计破冰
  await send(h, id, '主人发言');
  assert.equal((await wallOf()).find((x) => x.code === 'icebreaker').earned, false);
  assert.equal(await count("SELECT COUNT(*) AS n FROM user_badge WHERE user_id = ? AND badge_code = 'icebreaker'", [h.id]), 0);
  // 公开形状
  const sender = third.body.data.message.sender;
  assert.deepEqual(Object.keys(sender.badges[0]).sort(), ['code', 'name']);
});
