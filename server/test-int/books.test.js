import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { api, createNote, db, register, setup } from './helpers.js';

await setup();

let host;
let other;
let bookA;
let bookB;
let foreignBook;

const titlesOf = (res) => res.body.data.items.map((n) => n.title);
const list = (user, query) => api('GET', `/notes?${query}`, { token: user.token });

before(async () => {
  host = await register('bookh');
  other = await register('booko');

  const a = await api('POST', '/books', { token: host.token, body: { title: ' 活法 ', author: '稻盛和夫', status: 'reading' } });
  assert.equal(a.status, 201, a.text);
  bookA = a.body.data.book;
  const b = await api('POST', '/books', { token: host.token, body: { title: '小狗钱钱' } });
  bookB = b.body.data.book;
  const f = await api('POST', '/books', { token: other.token, body: { title: '别人的书' } });
  foreignBook = f.body.data.book;
});

test('新建书籍：规整字段，同名复用返回 200', async () => {
  assert.equal(bookA.title, '活法');
  assert.equal(bookA.author, '稻盛和夫');
  assert.equal(bookA.status, 'reading');
  assert.equal(bookA.note_count, 0);

  const dup = await api('POST', '/books', { token: host.token, body: { title: '活法' } });
  assert.equal(dup.status, 200);
  assert.equal(dup.body.data.book.id, bookA.id);

  const bad = await api('POST', '/books', { token: host.token, body: { title: '  ', status: 'later' } });
  assert.equal(bad.status, 400);
});

test('笔记归书：创建、详情、列表都带书籍；子笔记与提炼继承书籍', async () => {
  const root = await createNote(host, { title: '根', book_id: bookA.id });
  assert.deepEqual(root.book, { id: bookA.id, title: '活法' });

  const child = await createNote(host, { title: '子', parent_id: root.id });
  assert.deepEqual(child.book, { id: bookA.id, title: '活法' });

  const explicit = await createNote(host, { title: '子但未归类', parent_id: root.id, book_id: null });
  assert.equal(explicit.book, null);

  const promoted = await api('POST', `/notes/${child.id}/promote`, { token: host.token, body: { title: '提炼' } });
  assert.equal(promoted.status, 201, promoted.text);
  assert.equal(promoted.body.data.note.book.id, bookA.id);

  const plain = await createNote(host, { title: '散记' });
  assert.equal(plain.book, null);

  const res = await list(host, 'book=' + bookA.id);
  assert.deepEqual(new Set(titlesOf(res)), new Set(['根', '子', '提炼']));
  assert.ok(res.body.data.items.every((n) => n.book?.title === '活法'));

  const none = await list(host, 'book=none');
  assert.deepEqual(new Set(titlesOf(none)), new Set(['子但未归类', '散记']));
});

test('不能使用别人的书：创建、编辑、筛选、批量均为 404', async () => {
  const create = await api('POST', '/notes', { token: host.token, body: { title: 'x', book_id: foreignBook.id } });
  assert.equal(create.status, 404);
  assert.equal(create.body.error.code, 'BOOK_NOT_FOUND');

  const note = await createNote(host, { title: '越权检查' });
  const edit = await api('PUT', `/notes/${note.id}`, { token: host.token, body: { title: 'x', book_id: foreignBook.id } });
  assert.equal(edit.status, 404);

  assert.equal((await list(host, `book=${foreignBook.id}`)).status, 404);
  assert.equal((await list(host, 'book=abc')).status, 400);

  const batch = await api('PUT', '/notes/book', { token: host.token, body: { note_ids: [note.id], book_id: foreignBook.id } });
  assert.equal(batch.status, 404);
  assert.equal((await api('PATCH', `/books/${foreignBook.id}`, { token: host.token, body: { title: 'y' } })).status, 404);
  assert.equal((await api('DELETE', `/books/${foreignBook.id}`, { token: host.token })).status, 404);

  const othersNote = await createNote(other, { title: '别人的笔记' });
  const steal = await api('PUT', '/notes/book', { token: host.token, body: { note_ids: [othersNote.id], book_id: bookB.id } });
  assert.equal(steal.status, 404);
});

test('编辑笔记：不传 book_id 保持原书；只换书不刷新 updated_at', async () => {
  const note = await createNote(host, { title: '编辑归书', book_id: bookA.id });
  const keep = await api('PUT', `/notes/${note.id}`, { token: host.token, body: { title: '编辑归书', content: '正文' } });
  assert.equal(keep.body.data.note.book.id, bookA.id);

  const moved = await api('PUT', `/notes/${note.id}`, { token: host.token, body: { title: '编辑归书', content: '正文', book_id: bookB.id } });
  assert.equal(moved.status, 200, moved.text);
  assert.equal(moved.body.data.note.book.id, bookB.id);
  assert.equal(moved.body.data.note.updated_at, keep.body.data.note.updated_at);

  const cleared = await api('PUT', `/notes/${note.id}`, { token: host.token, body: { title: '编辑归书', content: '正文', book_id: null } });
  assert.equal(cleared.body.data.note.book, null);
});

test('批量归书：上限、去重、不改 updated_at，并刷新书籍计数', async () => {
  const a = await createNote(host, { title: '批量1' });
  const b = await createNote(host, { title: '批量2' });
  const before = (await api('GET', `/notes/${a.id}`, { token: host.token })).body.data.note.updated_at;

  const res = await api('PUT', '/notes/book', { token: host.token, body: { note_ids: [a.id, b.id, a.id], book_id: bookB.id } });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.data.updated, 2);

  const after = (await api('GET', `/notes/${a.id}`, { token: host.token })).body.data.note;
  assert.equal(after.book.id, bookB.id);
  assert.equal(after.updated_at, before);

  const books = await api('GET', '/books', { token: host.token });
  const count = books.body.data.items.find((x) => x.id === bookB.id).note_count;
  assert.equal(count, (await list(host, `book=${bookB.id}`)).body.data.total);

  const tooMany = Array.from({ length: 51 }, (_, i) => i + 1);
  assert.equal((await api('PUT', '/notes/book', { token: host.token, body: { note_ids: tooMany, book_id: null } })).status, 400);
  assert.equal((await api('PUT', '/notes/book', { token: host.token, body: { note_ids: [], book_id: null } })).status, 400);

  const back = await api('PUT', '/notes/book', { token: host.token, body: { note_ids: [a.id, b.id], book_id: null } });
  assert.equal(back.status, 200);
  assert.equal((await api('GET', `/notes/${b.id}`, { token: host.token })).body.data.note.book, null);
});

test('书籍列表：计数只算有效笔记，带未归类数与最近笔记时间', async () => {
  const res = await api('GET', '/books', { token: host.token });
  assert.equal(res.status, 200);
  const { items, unfiled_count } = res.body.data;
  assert.ok(items.every((b) => b.id !== foreignBook.id));
  const a = items.find((b) => b.id === bookA.id);
  assert.equal(a.note_count, (await list(host, `book=${bookA.id}`)).body.data.total);
  assert.ok(a.last_note_at);
  assert.equal(unfiled_count, (await list(host, 'book=none')).body.data.total);

  const victim = await createNote(host, { title: '将删除', book_id: bookA.id });
  await api('DELETE', `/notes/${victim.id}`, { token: host.token });
  const again = await api('GET', '/books', { token: host.token });
  assert.equal(again.body.data.items.find((b) => b.id === bookA.id).note_count, a.note_count);
});

test('组合筛选：分类、讨论状态、时间范围与排序', async () => {
  const user = await register('bookf');
  const book = (await api('POST', '/books', { token: user.token, body: { title: '筛选书' } })).body.data.book;
  const q1 = await createNote(user, { title: '问题A', kind: 'question', book_id: book.id });
  const v1 = await createNote(user, { title: '观点B', kind: 'viewpoint', book_id: book.id });
  const s1 = await createNote(user, { title: '总结C', kind: 'summary' });
  await db().query('UPDATE note SET updated_at = ? WHERE id = ?', [new Date('2020-01-01T00:00:00Z'), q1.id]);
  await db().query('UPDATE note SET created_at = ? WHERE id = ?', [new Date('2019-01-01T00:00:00Z'), v1.id]);

  const disc = await api('POST', '/discussions', { token: user.token, body: { note_id: v1.id } });
  assert.equal(disc.status, 201, disc.text);

  assert.deepEqual(titlesOf(await list(user, 'kind=question')), ['问题A']);
  assert.deepEqual(titlesOf(await list(user, `kind=viewpoint&book=${book.id}`)), ['观点B']);
  assert.deepEqual(titlesOf(await list(user, 'discussion=active')), ['观点B']);
  assert.deepEqual(new Set(titlesOf(await list(user, 'discussion=none'))), new Set(['问题A', '总结C']));
  assert.equal((await list(user, 'discussion=ended')).body.data.total, 0);
  assert.equal((await list(user, 'discussion=none')).body.data.total, 2);

  const since = new Date(Date.now() - 86400000).toISOString();
  assert.deepEqual(new Set(titlesOf(await list(user, `since=${encodeURIComponent(since)}`))), new Set(['观点B', '总结C']));

  assert.deepEqual(titlesOf(await list(user, 'sort=updated')).at(-1), '问题A');
  assert.deepEqual(titlesOf(await list(user, 'sort=created')).at(-1), '观点B');

  for (const bad of ['kind=idea', 'discussion=open', 'sort=title', 'since=yesterday']) {
    assert.equal((await list(user, bad)).status, 400, bad);
  }
  void s1;
});

test('修改与删除书籍：重名 409；删书后笔记回到未归类', async () => {
  const renamed = await api('PATCH', `/books/${bookB.id}`, { token: host.token, body: { title: '小狗钱钱2', status: 'deep', author: '博多·舍费尔' } });
  assert.equal(renamed.status, 200, renamed.text);
  assert.equal(renamed.body.data.book.status, 'deep');

  const clash = await api('PATCH', `/books/${bookB.id}`, { token: host.token, body: { title: '活法' } });
  assert.equal(clash.status, 409);
  assert.equal(clash.body.error.code, 'BOOK_EXISTS');

  const note = await createNote(host, { title: '随书而去', book_id: bookB.id });
  const del = await api('DELETE', `/books/${bookB.id}`, { token: host.token });
  assert.equal(del.status, 200);
  assert.equal((await api('GET', `/notes/${note.id}`, { token: host.token })).body.data.note.book, null);
  assert.equal((await api('DELETE', `/books/${bookB.id}`, { token: host.token })).status, 404);
});
