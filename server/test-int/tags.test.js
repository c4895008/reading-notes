import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { api, createNote, register, setup } from './helpers.js';

await setup();

let host;
let other;
let notes = [];
let tagA;
let tagB;

before(async () => {
  host = await register('tagh');
  other = await register('tago');
  for (let i = 0; i < 3; i += 1) notes.push(await createNote(host, { title: `笔记${i + 1}` }));
  await createNote(other, { title: '别人的笔记' });

  const a = await api('POST', '/tags', { token: host.token, body: { name: '  读书  ' } });
  assert.equal(a.status, 201, a.text);
  tagA = a.body.data.tag;
  assert.equal(tagA.name, '读书');

  const b = await api('POST', '/tags', { token: host.token, body: { name: '创业' } });
  assert.equal(b.status, 201, b.text);
  tagB = b.body.data.tag;
});

test('标签列表：按创建顺序返回并带笔记计数', async () => {
  await api('PUT', `/notes/${notes[0].id}/tags`, { token: host.token, body: { tag_ids: [tagA.id] } });
  await api('PUT', `/notes/${notes[1].id}/tags`, { token: host.token, body: { tag_ids: [tagA.id, tagB.id] } });

  const res = await api('GET', '/tags', { token: host.token });
  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.data.items.map((t) => ({ id: t.id, name: t.name, note_count: t.note_count })),
    [
      { id: tagA.id, name: '读书', note_count: 2 },
      { id: tagB.id, name: '创业', note_count: 1 },
    ],
  );
});

test('同名标签重复创建：复用已有，200 而非 201', async () => {
  const res = await api('POST', '/tags', { token: host.token, body: { name: '读书' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.tag.id, tagA.id);

  const list = await api('GET', '/tags', { token: host.token });
  assert.equal(list.body.data.items.length, 2);
});

test('重命名标签：成功后列表与笔记上的标签同步更新', async () => {
  const res = await api('PATCH', `/tags/${tagB.id}`, { token: host.token, body: { name: ' 生活 ' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.tag.name, '生活');

  const note = await api('GET', `/notes/${notes[1].id}`, { token: host.token });
  assert.deepEqual(
    note.body.data.note.tags.map((t) => t.name),
    ['读书', '生活'],
  );
});

test('重命名为已有同名：409', async () => {
  const res = await api('PATCH', `/tags/${tagB.id}`, { token: host.token, body: { name: '读书' } });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'TAG_EXISTS');
});

test('设置笔记标签：整体替换，重复的 id 去重', async () => {
  const res = await api('PUT', `/notes/${notes[0].id}/tags`, { token: host.token, body: { tag_ids: [tagB.id, tagB.id] } });
  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.data.tags.map((t) => t.id),
    [tagB.id],
  );

  const again = await api('GET', `/notes/${notes[0].id}`, { token: host.token });
  assert.deepEqual(
    again.body.data.note.tags.map((t) => t.name),
    ['生活'],
  );
});

test('按标签过滤笔记列表：只含该标签的笔记，且条目带标签', async () => {
  const res = await api('GET', `/notes?tag=${tagA.id}`, { token: host.token });
  assert.equal(res.status, 200);
  const ids = res.body.data.items.map((n) => n.id).sort();
  assert.deepEqual(ids, [notes[1].id].sort());
  assert.equal(res.body.data.items[0].tags.length, 2);
});

test('笔记列表默认每条都带 tags 数组', async () => {
  const res = await api('GET', '/notes', { token: host.token });
  assert.equal(res.status, 200);
  assert.ok(res.body.data.items.every((n) => Array.isArray(n.tags)));
});

test('删除标签：关联清除，过滤结果为空，列表不再出现', async () => {
  const del = await api('DELETE', `/tags/${tagB.id}`, { token: host.token });
  assert.equal(del.status, 200);

  const note = await api('GET', `/notes/${notes[0].id}`, { token: host.token });
  assert.deepEqual(note.body.data.note.tags, []);

  const filtered = await api('GET', `/notes?tag=${tagB.id}`, { token: host.token });
  assert.equal(filtered.status, 404);

  const list = await api('GET', '/tags', { token: host.token });
  assert.deepEqual(
    list.body.data.items.map((t) => t.id),
    [tagA.id],
  );
});

test('删除笔记后：标签保留但计数回落，过滤结果不再含该笔记', async () => {
  const temp = await createNote(host, { title: '待删除' });
  await api('PUT', `/notes/${temp.id}/tags`, { token: host.token, body: { tag_ids: [tagA.id] } });
  const before = await api('GET', '/tags', { token: host.token });
  assert.equal(before.body.data.items.find((t) => t.id === tagA.id).note_count, 2);

  const del = await api('DELETE', `/notes/${temp.id}`, { token: host.token });
  assert.equal(del.status, 200);

  const after = await api('GET', '/tags', { token: host.token });
  assert.equal(after.body.data.items.find((t) => t.id === tagA.id).note_count, 1);

  const filtered = await api('GET', `/notes?tag=${tagA.id}`, { token: host.token });
  assert.equal(
    filtered.body.data.items.some((n) => n.id === temp.id),
    false,
  );
});

test('越权与不存在：他人标签不可见、不可改、不可删', async () => {
  for (const [method, path, body] of [
    ['GET', `/notes?tag=${tagA.id}`, undefined],
    ['PATCH', `/tags/${tagA.id}`, { name: 'x' }],
    ['DELETE', `/tags/${tagA.id}`, undefined],
    ['PUT', `/notes/${notes[2].id}/tags`, { tag_ids: [tagA.id] }],
  ]) {
    const res = await api(method, path, { token: other.token, body });
    assert.equal(res.status, 404, `${method} ${path}`);
  }

  const strangers = await api('GET', '/tags', { token: other.token });
  assert.deepEqual(strangers.body.data.items, []);
});

test('校验：未登录 401；空名/超长名 400；非数组 tag_ids 400；他人笔记 404', async () => {
  assert.equal((await api('GET', '/tags')).status, 401);
  assert.equal((await api('POST', '/tags', { token: host.token, body: { name: '  ' } })).status, 400);
  assert.equal((await api('POST', '/tags', { token: host.token, body: { name: '长'.repeat(41) } })).status, 400);
  assert.equal((await api('PATCH', `/tags/${tagA.id}`, { token: host.token, body: { name: '' } })).status, 400);

  assert.equal(
    (await api('PUT', `/notes/${notes[2].id}/tags`, { token: host.token, body: { tag_ids: 'x' } })).status,
    400,
  );
  assert.equal(
    (await api('PUT', `/notes/${notes[2].id}/tags`, { token: host.token, body: { tag_ids: [tagA.id, 999999] } })).status,
    400,
  );

  const foreign = await createNote(other, { title: '目标' });
  assert.equal(
    (await api('PUT', `/notes/${foreign.id}/tags`, { token: host.token, body: { tag_ids: [tagA.id] } })).status,
    404,
  );
});
