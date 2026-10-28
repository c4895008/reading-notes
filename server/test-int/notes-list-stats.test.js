import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api, createNote, register, send, setup } from './helpers.js';

await setup();

test('笔记列表带子笔记数、正文字数与讨论发言数', async () => {
  const user = await register('stat');
  const parent = await createNote(user, { title: '上层', content: '读书 笔记\n\n第二段' });
  await createNote(user, { title: '空正文', content: '' });
  for (const title of ['子一', '子二']) {
    const res = await api('POST', '/notes', { token: user.token, body: { title, content: 'x', parent_id: parent.id } });
    assert.equal(res.status, 201, res.text);
  }
  const talk = await api('POST', '/discussions', { token: user.token, body: { note_id: parent.id } });
  assert.equal(talk.status, 201, talk.text);
  for (const text of ['一', '二', '三']) assert.equal((await send(user, talk.body.data.discussion_id, text)).status, 201);

  const list = await api('GET', '/notes?view=list', { token: user.token });
  const byTitle = Object.fromEntries(list.body.data.items.map((n) => [n.title, n]));
  assert.equal(byTitle['上层'].child_count, 2);
  assert.equal(byTitle['上层'].content_length, 7);
  assert.equal(byTitle['上层'].message_count, 3);
  assert.equal(byTitle['上层'].discussion_status, 'active');
  assert.equal(byTitle['空正文'].content_length, 0);
  assert.equal(byTitle['空正文'].message_count, 0);
  assert.equal(byTitle['子一'].child_count, 0);
});
