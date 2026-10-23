import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkBookAuthor, checkBookTitle, parseBookInput, parseNoteInput } from '../src/validate.js';

const fieldsOf = (fn) => {
  try {
    fn();
  } catch (e) {
    return e.details?.fields;
  }
  return null;
};

test('checkBookTitle 放行正常书名，拒绝空名、超长与控制字符', () => {
  assert.equal(checkBookTitle('活法'), null);
  assert.equal(checkBookTitle('书'.repeat(80)), null);
  for (const v of ['', '   ', null, undefined, 1]) assert.equal(checkBookTitle(v), '请填写书名');
  assert.equal(checkBookTitle('书'.repeat(81)), '书名最多 80 字');
  assert.equal(checkBookTitle('a\nb'), '书名包含不支持的字符');
});

test('checkBookAuthor 可为空，限制长度与类型', () => {
  assert.equal(checkBookAuthor(null), null);
  assert.equal(checkBookAuthor(undefined), null);
  assert.equal(checkBookAuthor('稻盛和夫'), null);
  assert.equal(checkBookAuthor('名'.repeat(61)), '作者最多 60 字');
  assert.equal(checkBookAuthor(3), '作者格式不正确');
});

test('parseBookInput 规整字段：空作者存 null，状态限定取值', () => {
  assert.deepEqual(parseBookInput({ title: ' 活法 ', author: '  ', status: 'reading' }), { title: '活法', author: null, status: 'reading' });
  assert.deepEqual(parseBookInput({ title: '活法' }), { title: '活法' });
  assert.deepEqual(fieldsOf(() => parseBookInput({ title: '活法', status: 'later' })), { status: '阅读状态不正确' });
  assert.deepEqual(parseBookInput({ status: null }, { partial: true }), { status: null });
  assert.ok(fieldsOf(() => parseBookInput({}, { partial: true })));
});

test('parseNoteInput 的 book_id：缺省不出现，null 表示未归类，非法值报错', () => {
  assert.equal('book_id' in parseNoteInput({ title: 't' }), false);
  assert.equal(parseNoteInput({ title: 't', book_id: null }).book_id, null);
  assert.equal(parseNoteInput({ title: 't', book_id: 7 }).book_id, 7);
  for (const v of [0, -1, '3', 1.5]) {
    assert.deepEqual(fieldsOf(() => parseNoteInput({ title: 't', book_id: v })), { book_id: '书籍不正确' });
  }
});
