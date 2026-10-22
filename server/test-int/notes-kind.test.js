import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { api, createNote, register, setup } from './helpers.js';

await setup();

let user;

before(async () => {
  user = await register('kind');
});

test('笔记分类：创建、列表、详情、编辑与提炼都带分类', async () => {
  const plain = await createNote(user, { title: '未传分类' });
  assert.equal(plain.kind, 'viewpoint');

  const view = await createNote(user, { title: '书中观点', kind: 'viewpoint' });
  assert.equal(view.kind, 'viewpoint');

  const edited = await api('PUT', `/notes/${view.id}`, {
    token: user.token,
    body: { title: '书中观点', content: '正文', kind: 'question' },
  });
  assert.equal(edited.status, 200, edited.text);
  assert.equal(edited.body.data.note.kind, 'question');

  const promoted = await api('POST', `/notes/${view.id}/promote`, {
    token: user.token,
    body: { title: '更高一层', kind: 'summary' },
  });
  assert.equal(promoted.status, 201, promoted.text);
  assert.equal(promoted.body.data.note.kind, 'summary');

  const list = await api('GET', '/notes?view=list', { token: user.token });
  const kinds = Object.fromEntries(list.body.data.items.map((n) => [n.title, n.kind]));
  assert.deepEqual(kinds, { 未传分类: 'viewpoint', 书中观点: 'question', 更高一层: 'summary' });
});

test('笔记分类必选：显式置空返回字段错误', async () => {
  const note = await createNote(user, { title: '必选', kind: 'summary' });
  const cleared = await api('PUT', `/notes/${note.id}`, { token: user.token, body: { title: '必选', content: '', kind: null } });
  assert.equal(cleared.status, 400);
  assert.equal(cleared.body.error.details.fields.kind, '请选择分类');
});

test('笔记分类：非法值返回字段错误', async () => {
  const res = await api('POST', '/notes', { token: user.token, body: { title: 't', kind: 'idea' } });
  assert.equal(res.status, 400);
  assert.ok(res.body.error.details.fields.kind);
});
