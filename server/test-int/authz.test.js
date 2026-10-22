import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { api, befriend, createNote, register, send, setup } from './helpers.js';

await setup();

const SECRET = '只属于乙的秘密正文';
let a, b, c, bNote, bChild, aNote, talk;

before(async () => {
  a = await register('authza');
  b = await register('authzb');
  c = await register('authzc');
  bNote = await createNote(b, { title: '乙的标题', quote: '乙的引文', content: SECRET });
  bChild = await createNote(b, { title: '乙的子笔记', content: SECRET, parent_id: bNote.id });
  aNote = await createNote(a, { title: '甲的笔记' });
  await befriend(b, c);
  const res = await api('POST', '/discussions', { token: b.token, body: { note_id: bNote.id, invitee_ids: [c.id] } });
  assert.equal(res.status, 201);
  talk = res.body.data.discussion_id;
  assert.equal((await send(c, talk, `读友说：${SECRET}`)).status, 201);
});

const leaks = (res) => res.text.includes(SECRET) || res.text.includes('乙的标题') || res.text.includes('乙的引文');

function expectDenied(res, status, code) {
  assert.equal(res.status, status, res.text);
  assert.equal(res.body.error.code, code);
  assert.ok(!leaks(res), '拒绝响应不应包含任何内容');
}

test('未登录：所有业务接口 401', async () => {
  for (const [m, p] of [
    ['GET', '/notes'],
    ['GET', `/notes/${bNote.id}`],
    ['GET', '/friends'],
    ['GET', '/discussions'],
    ['GET', `/discussions/${talk}`],
    ['GET', '/users/me/badges'],
    ['GET', '/users/search?q=x'],
  ]) {
    const res = await api(m, p);
    assert.equal(res.status, 401, `${m} ${p}`);
  }
  const bad = await api('GET', '/notes', { token: 'not-a-jwt' });
  assert.equal(bad.status, 401);
});

test('甲的 Token 操作乙的笔记：一律 404，无内容', async () => {
  const id = bNote.id;
  expectDenied(await api('GET', `/notes/${id}`, { token: a.token }), 404, 'NOTE_NOT_FOUND');
  expectDenied(await api('PUT', `/notes/${id}`, { token: a.token, body: { title: 'x', content: 'y' } }), 404, 'NOTE_NOT_FOUND');
  expectDenied(await api('POST', `/notes/${id}/promote`, { token: a.token, body: { title: 'x', content: 'y' } }), 404, 'NOTE_NOT_FOUND');
  expectDenied(await api('PUT', `/notes/${bChild.id}/parent`, { token: a.token, body: { parent_id: null } }), 404, 'NOTE_NOT_FOUND');
  expectDenied(await api('DELETE', `/notes/${id}`, { token: a.token }), 404, 'NOTE_NOT_FOUND');
  // 不存在与无权限同码同文
  const missing = await api('GET', '/notes/999999', { token: a.token });
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.body, (await api('GET', `/notes/${id}`, { token: a.token })).body);
  // 非法 id 也是 404
  assert.equal((await api('GET', '/notes/abc', { token: a.token })).status, 404);
});

test('甲不能把笔记挂到乙的笔记下，也不能就乙的笔记发起讨论', async () => {
  expectDenied(
    await api('POST', '/notes', { token: a.token, body: { title: 'x', content: 'x', parent_id: bNote.id } }),
    404,
    'PARENT_NOT_FOUND',
  );
  expectDenied(await api('PUT', `/notes/${aNote.id}/parent`, { token: a.token, body: { parent_id: bNote.id } }), 404, 'PARENT_NOT_FOUND');
  expectDenied(await api('POST', '/discussions', { token: a.token, body: { note_id: bNote.id } }), 403, 'NOTE_FORBIDDEN');
});

test('甲的列表、树、搜索看不到乙的笔记', async () => {
  const list = await api('GET', '/notes', { token: a.token });
  const tree = await api('GET', '/notes?view=tree', { token: a.token });
  const search = await api('GET', `/notes?q=${encodeURIComponent('秘密')}`, { token: a.token });
  for (const r of [list, tree, search]) {
    assert.equal(r.status, 200);
    assert.ok(!leaks(r));
  }
});

test('局外人对乙的讨论：全部 404，无内容', async () => {
  const t = a.token;
  expectDenied(await api('GET', `/discussions/${talk}`, { token: t }), 404, 'DISCUSSION_NOT_FOUND');
  expectDenied(await api('GET', `/discussions/${talk}/messages`, { token: t }), 404, 'DISCUSSION_NOT_FOUND');
  expectDenied(await send(a, talk, '闯入'), 404, 'DISCUSSION_NOT_FOUND');
  expectDenied(await api('POST', `/discussions/${talk}/read`, { token: t }), 404, 'DISCUSSION_NOT_FOUND');
  expectDenied(await api('POST', `/discussions/${talk}/invitations`, { token: t, body: { invitee_ids: [a.id] } }), 404, 'DISCUSSION_NOT_FOUND');
  expectDenied(await api('POST', `/discussions/${talk}/transition`, { token: t, body: { action: 'end' } }), 404, 'DISCUSSION_NOT_FOUND');
  const list = await api('GET', '/discussions', { token: t });
  assert.equal(list.body.data.items.length, 0);
});

test('乙的读友但未受邀：同样 404', async () => {
  const d = await register('authzd');
  await befriend(b, d);
  expectDenied(await api('GET', `/discussions/${talk}`, { token: d.token }), 404, 'DISCUSSION_NOT_FOUND');
  expectDenied(await send(d, talk, '未受邀'), 404, 'DISCUSSION_NOT_FOUND');
});

test('受邀读友调用状态流转、邀请：403 NOT_INITIATOR', async () => {
  for (const action of ['end', 'reopen', 'archive', 'unarchive']) {
    const res = await api('POST', `/discussions/${talk}/transition`, { token: c.token, body: { action } });
    assert.equal(res.status, 403, action);
    assert.equal(res.body.error.code, 'NOT_INITIATOR');
  }
  const inv = await api('POST', `/discussions/${talk}/invitations`, { token: c.token, body: { invitee_ids: [b.id] } });
  assert.equal(inv.status, 403);
  assert.equal(inv.body.error.code, 'NOT_INITIATOR');
});

test('读友申请：非当事人不能接受、拒绝或撤回', async () => {
  const e = await register('authze');
  const req = await api('POST', '/friends/requests', { token: e.token, body: { username: b.username } });
  const id = req.body.data.request.id;
  for (const [m, p] of [
    ['POST', `/friends/requests/${id}/accept`],
    ['POST', `/friends/requests/${id}/reject`],
    ['DELETE', `/friends/requests/${id}`],
  ]) {
    const res = await api(m, p, { token: a.token });
    assert.equal(res.status, 404, `${m} ${p}`);
    assert.equal(res.body.error.code, 'REQUEST_NOT_FOUND');
  }
  // 申请人自己不能替对方接受
  assert.equal((await api('POST', `/friends/requests/${id}/accept`, { token: e.token })).status, 404);
  assert.equal((await api('POST', `/friends/requests/${id}/accept`, { token: b.token })).status, 200);
});

test('删除读友后：前参与者 404；重新加回后恢复可见', async () => {
  const rm = await api('DELETE', `/friends/${b.id}`, { token: c.token });
  assert.equal(rm.status, 200);
  expectDenied(await api('GET', `/discussions/${talk}`, { token: c.token }), 404, 'DISCUSSION_NOT_FOUND');
  expectDenied(await api('GET', `/discussions/${talk}/messages`, { token: c.token }), 404, 'DISCUSSION_NOT_FOUND');
  expectDenied(await send(c, talk, '已非读友'), 404, 'DISCUSSION_NOT_FOUND');
  assert.equal((await api('GET', '/discussions', { token: c.token })).body.data.items.length, 0);
  // 发起人这边的名单不再显示他
  const roster = (await api('GET', `/discussions/${talk}`, { token: b.token })).body.data.discussion.participants;
  assert.deepEqual(
    roster.map((p) => p.user_id),
    [b.id],
  );
  // 再删一次：NOT_FRIENDS
  assert.equal((await api('DELETE', `/friends/${b.id}`, { token: c.token })).body.error.code, 'NOT_FRIENDS');

  await befriend(c, b);
  const back = await api('GET', `/discussions/${talk}/messages`, { token: c.token });
  assert.equal(back.status, 200);
  assert.equal(back.body.data.messages.length, 1);
  assert.equal((await send(c, talk, '回来了')).status, 201);
});
