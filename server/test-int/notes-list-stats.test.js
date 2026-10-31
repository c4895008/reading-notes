import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api, befriend, createNote, register, send, setup } from './helpers.js';

await setup();

const LIST_FIELDS = [
  'id', 'parent_id', 'title', 'kind', 'excerpt', 'excerpt_source', 'depth', 'child_count',
  'content_length', 'discussion_status', 'message_count', 'like_count', 'tags', 'created_at', 'updated_at',
];

async function list(user, query = {}) {
  const res = await api('GET', `/notes?${new URLSearchParams({ view: 'list', ...query })}`, { token: user.token });
  assert.equal(res.status, 200, res.text);
  const data = res.body.data;
  assert.deepEqual(Object.keys(data).sort(), ['items', 'page', 'page_size', 'total', 'has_more'].sort());
  const searching = Boolean(query.q?.trim());
  for (const item of data.items) {
    // 严格限定原有 API 字段，不暴露正文、引文或 SQL 内部位置 / 上下文列。
    assert.deepEqual(Object.keys(item).sort(), [...LIST_FIELDS, ...(searching ? ['path'] : [])].sort());
    assert.ok([...item.excerpt].length <= (searching ? 162 : 81), '摘要码点数有界（含省略号）');
  }
  return data;
}

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

test('搜索摘要：正文尾段首个命中优先于引文，最多返回 160 码点上下文', async () => {
  const user = await register('excerpt_body');
  const q = '尾段检索';
  const prefix = '前'.repeat(18000);
  const content = `${prefix}${q}${'后'.repeat(400)}第二处${q}`;
  const note = await createNote(user, { title: '长正文', content, quote: `引文也有${q}` });
  const atEnd = await createNote(user, { title: '末尾', content: `${prefix}${q}` });
  const data = await list(user, { q });
  assert.equal(data.total, 2);
  const hit = data.items.find((n) => n.id === note.id);
  assert.equal(hit.excerpt_source, 'content');
  assert.equal(hit.excerpt, `…${'前'.repeat(24)}${q}${'后'.repeat(132)}…`);
  assert.equal(hit.content_length, [...content].length);
  assert.equal(data.items.find((n) => n.id === atEnd.id).excerpt, `…${'前'.repeat(24)}${q}`);
  const ordinary = await list(user);
  assert.ok(ordinary.items.every((n) => n.excerpt === `${'前'.repeat(80)}…`));
});

test('搜索摘要：正文未命中时用引文尾段，不压缩连续空格、换行或制表符', async () => {
  const user = await register('excerpt_quote');
  const q = '引文  命中\n换行\t词';
  const prefix = `${'引'.repeat(1500)}${' \n\t'.repeat(30)}`;
  const note = await createNote(user, {
    title: '长引文', content: '正文存在但未含搜索词', quote: `${prefix}${q}${'后'.repeat(200)}`,
  });
  const end = await createNote(user, { title: '引文末尾', content: '', quote: `${'引'.repeat(500)}${q}` });
  const data = await list(user, { q });
  assert.equal(data.total, 2);
  const hit = data.items.find((n) => n.id === note.id);
  assert.equal(hit.excerpt_source, 'quote');
  assert.equal(hit.excerpt, `…${[...prefix].slice(-24).join('')}${q}${'后'.repeat(136 - [...q].length)}…`);
  assert.ok(hit.excerpt.includes(q));
  assert.equal(data.items.find((n) => n.id === end.id).excerpt, `…${'引'.repeat(24)}${q}`);
});

test('搜索摘要：仅标题命中回退原摘要，非 q / 空白 q 的 80 码点行为不变', async () => {
  const user = await register('excerpt_title');
  const cases = [
    { content: '😀'.repeat(81), quote: '不应使用引文', excerpt: `${'😀'.repeat(80)}…`, source: 'content' },
    { content: '', quote: '摘  录\n'.repeat(60), excerpt: `${'摘 录 '.repeat(20)}…`, source: 'quote' },
    { content: '', quote: null, excerpt: '', source: 'none' },
    { content: '字'.repeat(80), excerpt: '字'.repeat(80), source: 'content' },
    { content: '', quote: ' a \n b\tc ', excerpt: 'a b c', source: 'quote' },
  ];
  const notes = [];
  for (const [i, { content, quote }] of cases.entries()) {
    notes.push(await createNote(user, { title: `仅标题${i}`, content, quote }));
  }
  const ordinary = await list(user);
  assert.deepEqual(await list(user, { q: '   ' }), ordinary);
  const found = await list(user, { q: '仅标题' });
  assert.equal(found.total, cases.length);
  for (const [i, note] of notes.entries()) {
    const before = ordinary.items.find((n) => n.id === note.id);
    assert.equal(before.excerpt, cases[i].excerpt);
    assert.equal(before.excerpt_source, cases[i].source);
    assert.deepEqual(found.items.find((n) => n.id === note.id), { ...before, path: [] });
  }
});

test('搜索摘要：中文、英文大小写、100 码点和 emoji 按列 collation 定位且不拆代理对', async () => {
  const user = await register('excerpt_unicode');
  const cases = [
    ['中文命中', '中文命中'],
    ['mixedcase', 'MiXeDCaSe'],
    ['长'.repeat(100), '长'.repeat(100)],
    ['z'.repeat(100), 'Z'.repeat(100)],
    ['😀'.repeat(100), '😀'.repeat(100)],
    ['书😀'.repeat(50), '书😀'.repeat(50)],
  ];
  const prefix = '😀前'.repeat(180);
  const suffix = '后😀'.repeat(100);
  for (const [q, matched] of cases) {
    const notes = [];
    for (const field of ['content', 'quote']) {
      notes.push(await createNote(user, { title: '字符边界', [field]: `${prefix}${matched}${suffix}` }));
    }
    const data = await list(user, { q });
    assert.equal(data.total, 2, q);
    for (const [i, note] of notes.entries()) {
      const hit = data.items.find((n) => n.id === note.id);
      assert.equal(hit.excerpt_source, i === 0 ? 'content' : 'quote');
      assert.equal(hit.excerpt, `…${'😀前'.repeat(12)}${matched}${[...suffix].slice(0, 136 - [...matched].length).join('')}…`);
      assert.ok(hit.excerpt.includes(matched));
      assert.equal([...hit.excerpt].length, 162);
    }
  }
  for (const q of ['字'.repeat(101), 'a'.repeat(101), '😀'.repeat(101)]) {
    const res = await api('GET', `/notes?${new URLSearchParams({ q })}`, { token: user.token });
    assert.equal(res.status, 400, res.text);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.equal(res.body.error.details.fields.q, '搜索词最多 100 字');
  }
});

test('搜索摘要：开头、24 码点前文和 160 / 161 码点边界的省略号准确', async () => {
  const user = await register('excerpt_bounds');
  for (const [i, before, after] of [[0, 0, 0], [1, 24, 132], [2, 25, 133]]) {
    const q = `边界词${i}`;
    for (const field of ['content', 'quote']) {
      const note = await createNote(user, { title: '边界', [field]: `${'前'.repeat(before)}${q}${'后'.repeat(after)}` });
      const hit = (await list(user, { q })).items.find((n) => n.id === note.id);
      assert.equal(hit.excerpt_source, field);
      assert.equal(hit.excerpt, `${before > 24 ? '…' : ''}${'前'.repeat(Math.min(before, 24))}${q}${'后'.repeat(Math.min(after, 132))}${after > 132 ? '…' : ''}`);
    }
  }
});

test('搜索摘要：百分号、下划线、反斜线与 SQL 文本均按字面匹配', async () => {
  for (const q of ['%', '_', '\\', '%_\\', "' OR 1=1 --"]) {
    const user = await register('excerpt_literal');
    const text = `${'前'.repeat(500)}${q}${'后'.repeat(200)}`;
    const body = await createNote(user, { title: '正文符号', content: `\`\`\`\n${text}\n\`\`\`` });
    const quote = await createNote(user, { title: '引文符号', quote: text });
    const title = await createNote(user, { title: `标题${q}` });
    await createNote(user, { title: '干扰项', content: `${'前'.repeat(500)}任意X字符${'后'.repeat(200)}`, quote: '任意字符' });
    const data = await list(user, { q });
    assert.equal(data.total, 3, q);
    assert.deepEqual(data.items.map((n) => n.id).sort((a, b) => a - b), [body.id, quote.id, title.id]);
    for (const [note, source] of [[body, 'content'], [quote, 'quote']]) {
      const hit = data.items.find((n) => n.id === note.id);
      assert.equal(hit.excerpt_source, source);
      assert.equal(hit.excerpt, `…${'前'.repeat(24)}${q}${'后'.repeat(136 - [...q].length)}…`);
    }
    assert.equal(data.items.find((n) => n.id === title.id).excerpt, '正文');
    assert.equal((await list(user, { q: `${q}未出现` })).total, 0);
  }
});

test('搜索摘要：使用 Markdown 纯文本，HTML 保持文本而不增加 API 字段', async () => {
  const user = await register('excerpt_markup');
  const note = await createNote(user, {
    title: '文本格式',
    content: `# ${'前'.repeat(500)}\n\n**纯文标记** [链接词](https://never-index.example/path)\n\n<em>html标记</em>\n\n${'后'.repeat(300)}`,
  });
  for (const q of ['纯文标记', '链接词', '<em>html标记</em>']) {
    const data = await list(user, { q });
    assert.equal(data.total, 1);
    const hit = data.items[0];
    assert.equal(hit.id, note.id);
    assert.equal(hit.excerpt_source, 'content');
    assert.ok(hit.excerpt.includes(q));
    assert.ok(!hit.excerpt.includes('**'));
    assert.ok(!hit.excerpt.includes('[链接词]'));
    assert.ok(!hit.excerpt.includes('https://'));
  }
  for (const q of ['**纯文标记**', 'never-index.example']) assert.equal((await list(user, { q })).total, 0);
});

test('搜索摘要：超过 10 条的分页、排序、祖先路径、作者隔离与软删除不变', async () => {
  const user = await register('excerpt_pages');
  const other = await register('excerpt_other');
  const q = '分页检索';
  const content = `${'前'.repeat(500)}${q}`;
  const root = await createNote(user, { title: '祖先', content: '' });
  const parent = await createNote(user, { title: '中间层', content: '', parent_id: root.id });
  const notes = [];
  for (let i = 0; i < 12; i += 1) {
    notes.push(await createNote(user, { title: `分页条目${i}`, content, parent_id: parent.id }));
  }
  await createNote(user, { title: '未匹配子笔记', parent_id: notes[0].id });
  const foreign = await createNote(other, { title: '其他作者', content });
  const deleted = await createNote(user, { title: '已删除', content, parent_id: parent.id });
  assert.equal((await api('DELETE', `/notes/${deleted.id}`, { token: user.token })).status, 200);
  const edit = await api('PUT', `/notes/${notes[0].id}`, {
    token: user.token, body: { title: notes[0].title, content: `${content}更新` },
  });
  assert.equal(edit.status, 200, edit.text);
  notes[0] = edit.body.data.note;

  const ordinary = await list(user, { page_size: 50 });
  const path = [root, parent].map(({ id, title }) => ({ id, title }));
  for (const sort of ['updated', 'created']) {
    const first = await list(user, { q, sort });
    const second = await list(user, { q, sort, page: 2 });
    assert.equal(first.page, 1);
    assert.equal(first.page_size, 10);
    assert.equal(first.total, 12);
    assert.equal(first.has_more, true);
    assert.equal(first.items.length, 10);
    assert.equal(second.page, 2);
    assert.equal(second.page_size, 10);
    assert.equal(second.total, 12);
    assert.equal(second.has_more, false);
    assert.equal(second.items.length, 2);
    const timestamp = sort === 'created' ? 'created_at' : 'updated_at';
    const expected = [...notes].sort((a, b) => Date.parse(b[timestamp]) - Date.parse(a[timestamp]) || b.id - a.id);
    const items = [...first.items, ...second.items];
    assert.deepEqual(items.map((n) => n.id), expected.map((n) => n.id));
    for (const item of items) {
      const plain = ordinary.items.find((n) => n.id === item.id);
      assert.deepEqual(item, { ...plain, excerpt: item.excerpt, excerpt_source: 'content', path });
      assert.ok(item.excerpt.includes(q));
      assert.equal(item.depth, 2);
      assert.equal(item.child_count, item.id === notes[0].id ? 1 : 0);
    }
    if (sort === 'updated') assert.deepEqual(await list(user, { q }), first);
  }
  assert.deepEqual(await list(user, { q, page: 3 }), { items: [], page: 3, page_size: 10, total: 12, has_more: false });
  const small = await list(user, { q, sort: 'created', page_size: 2, page: 6 });
  assert.deepEqual(small.items.map((n) => n.id), [notes[1].id, notes[0].id]);
  assert.equal(small.total, 12);
  assert.equal(small.has_more, false);
  const others = await list(other, { q });
  assert.equal(others.total, 1);
  assert.equal(others.items[0].id, foreign.id);
  assert.deepEqual(others.items[0].path, []);
});

test('搜索摘要：组合筛选与 count 参数独立，标签、讨论统计和喜欢计数保留', async () => {
  const user = await register('excerpt_filter');
  const reader = await register('excerpt_reader');
  const q = '筛选命中';
  const content = `${'前'.repeat(500)}${q}`;
  const chosen = await createNote(user, { title: '有讨论', content, kind: 'summary' });
  const question = await createNote(user, { title: '无讨论', content, kind: 'question' });
  await createNote(user, { title: '未打标签', content, kind: 'summary' });
  const noMatch = await createNote(user, { title: '关键词不符', kind: 'summary' });
  const tagRes = await api('POST', '/tags', { token: user.token, body: { name: '检索标签' } });
  assert.equal(tagRes.status, 201, tagRes.text);
  const tag = tagRes.body.data.tag;
  for (const note of [chosen, question, noMatch]) {
    const res = await api('PUT', `/notes/${note.id}/tags`, { token: user.token, body: { tag_ids: [tag.id] } });
    assert.equal(res.status, 200, res.text);
  }
  const talk = await api('POST', '/discussions', { token: user.token, body: { note_id: chosen.id } });
  assert.equal(talk.status, 201, talk.text);
  assert.equal((await send(user, talk.body.data.discussion_id, '发言')).status, 201);
  await befriend(user, reader);
  assert.equal((await api('PUT', `/notes/${chosen.id}/visibility`, {
    token: user.token, body: { visibility: 'friends' },
  })).status, 200);
  assert.equal((await api('PUT', `/feed/${chosen.id}/like`, { token: reader.token })).status, 200);

  const query = { q, tag: tag.id, kind: 'summary', discussion: 'active', sort: 'created' };
  const data = await list(user, query);
  assert.equal(data.total, 1);
  assert.equal(data.has_more, false);
  assert.equal(data.items.length, 1);
  const hit = data.items[0];
  assert.equal(hit.id, chosen.id);
  assert.equal(hit.excerpt_source, 'content');
  assert.equal(hit.excerpt, `…${'前'.repeat(24)}${q}`);
  assert.deepEqual(hit.tags.map(({ id, name }) => ({ id, name })), [{ id: tag.id, name: tag.name }]);
  assert.equal(hit.kind, 'summary');
  assert.equal(hit.discussion_status, 'active');
  assert.equal(hit.message_count, 1);
  assert.equal(hit.like_count, 1);
  assert.equal(hit.content_length, [...content].length);
  for (const overrides of [{ kind: 'question' }, { discussion: 'none' }, { discussion: 'ended' }, { q: '无结果' }]) {
    const empty = await list(user, { ...query, ...overrides });
    assert.equal(empty.total, 0);
    assert.deepEqual(empty.items, []);
    assert.equal(empty.has_more, false);
  }
  const noTalk = await list(user, { ...query, kind: 'question', discussion: 'none' });
  assert.equal(noTalk.total, 1);
  assert.equal(noTalk.items[0].id, question.id);
  assert.equal(noTalk.items[0].message_count, 0);
  assert.equal(noTalk.items[0].like_count, 0);
  assert.equal((await list(reader, { q })).total, 0, '分享且已点赞也不能混入读者的私人笔记搜索');
});
