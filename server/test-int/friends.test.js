import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { api, befriend, register, setup } from './helpers.js';

await setup();

let host;
const friends = [];
const outgoing = [];
const incoming = [];

before(async () => {
  host = await register('frh');
  for (let i = 0; i < 5; i += 1) friends.push(await register('frf'));
  for (const f of friends) await befriend(host, f);
  for (let i = 0; i < 3; i += 1) {
    const target = await register('fro');
    outgoing.push(target);
    const res = await api('POST', '/friends/requests', { token: host.token, body: { username: target.username } });
    assert.equal(res.status, 201, res.text);
  }
  for (let i = 0; i < 3; i += 1) {
    const sender = await register('fri');
    incoming.push(sender);
    const res = await api('POST', '/friends/requests', { token: sender.token, body: { username: host.username } });
    assert.equal(res.status, 201, res.text);
  }
});

test('读友列表：默认 page_size=20，返回分页元信息', async () => {
  const res = await api('GET', '/friends', { token: host.token });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.page, 1);
  assert.equal(res.body.data.page_size, 20);
  assert.equal(res.body.data.total, 5);
  assert.equal(res.body.data.has_more, false);
  assert.equal(res.body.data.items.length, 5);
});

test('读友列表：page/page_size 翻页，跨页不重复', async () => {
  const seen = [];
  for (let page = 1; page <= 3; page += 1) {
    const res = await api('GET', `/friends?page=${page}&page_size=2`, { token: host.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.page, page);
    assert.equal(res.body.data.page_size, 2);
    assert.equal(res.body.data.total, 5);
    assert.equal(res.body.data.has_more, page < 3);
    seen.push(...res.body.data.items.map((f) => f.user_id));
  }
  assert.equal(seen.length, 5);
  assert.equal(new Set(seen).size, 5);

  const beyond = await api('GET', '/friends?page=9&page_size=2', { token: host.token });
  assert.equal(beyond.status, 200);
  assert.deepEqual(beyond.body.data.items, []);
  assert.equal(beyond.body.data.has_more, false);
});

test('申请列表：收到与发出都支持翻页', async () => {
  const out1 = await api('GET', '/friends/requests?type=out&page=1&page_size=2', { token: host.token });
  assert.equal(out1.status, 200);
  assert.equal(out1.body.data.total, 3);
  assert.equal(out1.body.data.items.length, 2);
  assert.equal(out1.body.data.has_more, true);

  const out2 = await api('GET', '/friends/requests?type=out&page=2&page_size=2', { token: host.token });
  assert.equal(out2.body.data.items.length, 1);
  assert.equal(out2.body.data.has_more, false);

  const in1 = await api('GET', '/friends/requests?type=in&page=1&page_size=2', { token: host.token });
  assert.equal(in1.status, 200);
  assert.equal(in1.body.data.total, 3);
  assert.equal(in1.body.data.items.length, 2);
  assert.equal(in1.body.data.has_more, true);

  const in2 = await api('GET', '/friends/requests?type=in&page=2&page_size=2', { token: host.token });
  assert.equal(in2.body.data.items.length, 1);
  assert.equal(in2.body.data.has_more, false);
});

test('分页参数：非法值 400，page_size 上限 50', async () => {
  for (const q of ['page=0', 'page=abc', 'page_size=0', 'page_size=51', 'page_size=x']) {
    const res = await api('GET', `/friends?${q}`, { token: host.token });
    assert.equal(res.status, 400, q);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  }
  const req = await api('GET', '/friends/requests?type=in&page_size=51', { token: host.token });
  assert.equal(req.status, 400);
  assert.equal(req.body.error.code, 'VALIDATION_ERROR');

  const max = await api('GET', '/friends?page=1&page_size=50', { token: host.token });
  assert.equal(max.status, 200);
  assert.equal(max.body.data.page_size, 50);
});
