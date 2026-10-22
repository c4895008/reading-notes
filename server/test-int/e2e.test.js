import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PASSWORD, api, nextIp, send, setup } from './helpers.js';

await setup();

// PRD 11.4 端到端主流程：全部走公开接口，按真实用户的操作顺序
test('主流程：注册 → 引文笔记 → 提炼/补充/挂载 → 加读友 → 多人讨论 → 徽章 → 追加邀请 → 完结/存档/取消存档/重开', async () => {
  const signup = async (username, nickname) => {
    const res = await api('POST', '/auth/register', { ip: nextIp(), body: { username, password: PASSWORD, nickname } });
    assert.equal(res.status, 201, res.text);
    const user = res.body.data.user;
    return { ...user, id: user.user_id, token: res.body.data.token };
  };
  const host = await signup('e2e_host', '主人');
  const [lin, mo, su] = [await signup('e2e_lin', '林'), await signup('e2e_mo', '墨'), await signup('e2e_su', '苏')];

  // 重新登录拿到的 Token 同样可用
  const login = await api('POST', '/auth/login', { ip: nextIp(), body: { username: 'E2E_HOST', password: PASSWORD } });
  assert.equal(login.status, 200);
  host.token = login.body.data.token;

  // 写一条带引文的笔记（幂等键重放只建一条）
  const key = 'e2e-create-0001';
  const draft = { title: '论读书', quote: '读书之法，在循序而渐进，熟读而精思。', content: '**循序**与*精思*。' };
  const created = await api('POST', '/notes', { token: host.token, body: draft, headers: { 'Idempotency-Key': key } });
  const again = await api('POST', '/notes', { token: host.token, body: draft, headers: { 'Idempotency-Key': key } });
  assert.equal(created.status, 201);
  assert.equal(again.body.data.note.id, created.body.data.note.id);
  const base = created.body.data.note;
  assert.equal(base.quote, draft.quote);

  // 提炼：新建上层，原笔记成为它的子级
  const promoted = await api('POST', `/notes/${base.id}/promote`, { token: host.token, body: { title: '读书方法', content: '提炼' } });
  assert.equal(promoted.status, 201);
  const top = promoted.body.data.note;
  assert.deepEqual(top.children.map((c) => c.id), [base.id]);
  // 补充：在原笔记下新增子级
  const extra = (await api('POST', '/notes', { token: host.token, body: { title: '补一句', content: '精思之要', parent_id: base.id } })).body.data.note;
  // 挂载：另一条独立笔记挂到顶层下
  const loose = (await api('POST', '/notes', { token: host.token, body: { title: '散记', content: '另起一行' } })).body.data.note;
  const mounted = await api('PUT', `/notes/${loose.id}/parent`, { token: host.token, body: { parent_id: top.id } });
  assert.equal(mounted.body.data.note.parent_id, top.id);
  // 不能挂到自己的下层
  assert.equal((await api('PUT', `/notes/${top.id}/parent`, { token: host.token, body: { parent_id: extra.id } })).body.error.code, 'CYCLE_NOT_ALLOWED');
  const tree = (await api('GET', '/notes?view=tree', { token: host.token })).body.data.items;
  assert.deepEqual(
    tree.map((n) => [n.title, n.depth]),
    [
      ['读书方法', 0],
      ['论读书', 1],
      ['补一句', 2],
      ['散记', 1],
    ],
  );

  // 加读友：申请 → 对方接受
  for (const friend of [lin, mo, su]) {
    const req = await api('POST', '/friends/requests', { token: host.token, body: { username: friend.username } });
    assert.equal(req.status, 201);
    const inbox = (await api('GET', '/friends/requests?type=in', { token: friend.token })).body.data.items;
    assert.equal(inbox.length, 1);
    assert.equal((await api('POST', `/friends/requests/${inbox[0].id}/accept`, { token: friend.token })).status, 200);
  }
  assert.equal((await api('GET', '/friends', { token: host.token })).body.data.items.length, 3);

  // 就「补一句」发起讨论，邀请林与墨；快照带上两层祖先
  const start = await api('POST', '/discussions', { token: host.token, body: { note_id: extra.id, invitee_ids: [lin.id, mo.id] } });
  assert.equal(start.status, 201);
  assert.deepEqual(start.body.data.new_badges.map((b) => b.code), ['kindler']);
  const talk = start.body.data.discussion_id;
  const linView = (await api('GET', `/discussions/${talk}`, { token: lin.token })).body.data.discussion;
  assert.equal(linView.first_visit, true);
  assert.equal(linView.layers, 2);
  assert.deepEqual(linView.snapshot.ancestors.map((a) => a.title), ['读书方法', '论读书']);
  assert.equal((await api('GET', '/discussions/unread', { token: lin.token })).body.data.count, 0);

  // 往来对话 + 破冰徽章
  const m1 = await send(lin, talk, '我先说：循序最难。');
  assert.equal(m1.status, 201);
  assert.deepEqual(m1.body.data.new_badges.map((b) => b.code), ['icebreaker']);
  assert.equal((await send(host, talk, '同感。')).body.data.new_badges.length, 0);
  const m3 = await send(mo, talk, '精思需要时间。');
  assert.deepEqual(m3.body.data.new_badges.map((b) => b.code), ['icebreaker']);
  assert.equal((await api('GET', '/discussions/unread', { token: lin.token })).body.data.count, 1);
  await api('POST', `/discussions/${talk}/read`, { token: lin.token });
  assert.equal((await api('GET', '/discussions/unread', { token: lin.token })).body.data.count, 0);

  // 追加邀请苏，第三位读友发言 → 发起人得「满座」
  const invited = await api('POST', `/discussions/${talk}/invitations`, { token: host.token, body: { invitee_ids: [su.id] } });
  assert.deepEqual(invited.body.data.invited.map((u) => u.user_id), [su.id]);
  await send(su, talk, '我来晚了。');
  const hostWall = (await api('GET', '/users/me/badges', { token: host.token })).body.data.badges;
  assert.deepEqual(hostWall.filter((b) => b.earned).map((b) => b.code).sort(), ['fullhouse', 'kindler']);
  const me = (await api('GET', '/auth/me', { token: host.token })).body.data.user;
  assert.deepEqual(me.badges.map((b) => b.code).sort(), ['fullhouse', 'kindler']);

  const msgs = (await api('GET', `/discussions/${talk}/messages`, { token: su.token })).body.data;
  assert.deepEqual(msgs.messages.map((m) => m.seq), [1, 2, 3, 4]);
  assert.deepEqual(msgs.participants.map((p) => p.nickname), ['主人', '林', '墨', '苏']);

  // 完结 → 存档 → 取消存档 → 重开
  const step = async (action, status) => {
    const res = await api('POST', `/discussions/${talk}/transition`, { token: host.token, body: { action } });
    assert.equal(res.body.data.status, status, action);
    const listed = (await api('GET', `/discussions?status=${status}`, { token: lin.token })).body.data.items;
    assert.ok(listed.some((d) => d.id === talk), `${status} 分组应包含该讨论`);
  };
  await step('end', 'ended');
  assert.equal((await send(lin, talk, '还能说吗')).status, 409);
  await step('archive', 'archived');
  await step('unarchive', 'ended');
  await step('reopen', 'active');
  assert.equal((await send(lin, talk, '又开了。')).status, 201);

  // 删除父笔记：子笔记升为顶层，讨论仍在
  const del = await api('DELETE', `/notes/${base.id}`, { token: host.token });
  assert.equal(del.body.data.promoted_children, 1);
  const after = (await api('GET', '/notes?view=tree', { token: host.token })).body.data.items;
  assert.deepEqual(after.find((n) => n.id === extra.id).depth, 0);
  assert.equal((await api('GET', `/notes/${base.id}`, { token: host.token })).status, 404);
  const still = await api('GET', `/discussions/${talk}`, { token: mo.token });
  assert.equal(still.status, 200);
  assert.deepEqual(still.body.data.discussion.snapshot.ancestors.map((a) => a.title), ['读书方法', '论读书']);
  assert.equal((await api('GET', `/notes/${extra.id}`, { token: host.token })).body.data.note.discussion.id, talk);

  // 解除读友：对方看不到；重新加回：恢复
  assert.equal((await api('DELETE', `/friends/${mo.id}`, { token: host.token })).status, 200);
  assert.equal((await api('GET', `/discussions/${talk}`, { token: mo.token })).status, 404);
  assert.equal((await api('GET', '/discussions', { token: mo.token })).body.data.items.length, 0);
  const roster = (await api('GET', `/discussions/${talk}`, { token: host.token })).body.data.discussion.participants;
  assert.ok(!roster.some((p) => p.user_id === mo.id));
  const req = await api('POST', '/friends/requests', { token: mo.token, body: { username: host.username } });
  await api('POST', `/friends/requests/${req.body.data.request.id}/accept`, { token: host.token });
  const back = await api('GET', `/discussions/${talk}/messages`, { token: mo.token });
  assert.equal(back.status, 200);
  assert.equal(back.body.data.messages.length, 5);
});
