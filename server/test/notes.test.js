import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markdownToText } from '../src/services/markdown.js';
import { parseNoteInput } from '../src/validate.js';

const fieldsOf = (fn) => {
  try {
    fn();
  } catch (err) {
    return err.details.fields;
  }
  assert.fail('expected validation error');
};

test('markdownToText 去掉语法、保留文字', () => {
  assert.equal(markdownToText('# 标题\n\n**粗**与*斜*，[链接](https://a.com)。'), '标题 粗与斜，链接。');
  assert.equal(markdownToText('- 一\n- 二\n\n> 引用'), '一 二 引用');
  assert.equal(markdownToText('`code` 与\n\n```\nblock\n```'), 'code 与 block');
  assert.equal(markdownToText('![图](http://x/a.png)'), '图');
  assert.equal(markdownToText('<script>x</script>'), '<script>x</script>');
  assert.equal(markdownToText(''), '');
});

test('parseNoteInput 规整三字段', () => {
  assert.deepEqual(parseNoteInput({ title: '  标题 ', quote: ' a\r\nb ', content: '\n\n  code\r\n\n' }), {
    title: '标题',
    quote: 'a\nb',
    content: '  code',
    kind: 'viewpoint',
  });
  assert.deepEqual(parseNoteInput({ title: 't', quote: '   ', content: ' \n ' }), { title: 't', quote: null, content: '', kind: 'viewpoint' });
  assert.deepEqual(parseNoteInput({ title: 't' }), { title: 't', quote: null, content: '', kind: 'viewpoint' });
});

test('parseNoteInput 分类必选：默认观点，只接受观点/问题/总结', () => {
  for (const kind of ['viewpoint', 'question', 'summary']) assert.equal(parseNoteInput({ title: 't', kind }).kind, kind);
  assert.equal(fieldsOf(() => parseNoteInput({ title: 't', kind: null })).kind, '请选择分类');
  assert.ok(fieldsOf(() => parseNoteInput({ title: 't', kind: 'idea' })).kind);
  assert.ok(fieldsOf(() => parseNoteInput({ title: 't', kind: 1 })).kind);
});

test('parseNoteInput 按码点计数并拦截越界', () => {
  assert.doesNotThrow(() => parseNoteInput({ title: '😀'.repeat(80) }));
  assert.deepEqual(fieldsOf(() => parseNoteInput({ title: '字'.repeat(81) })), { title: '标题最多 80 字' });
  assert.ok(fieldsOf(() => parseNoteInput({ title: 't', quote: 'a'.repeat(2001) })).quote);
  assert.ok(fieldsOf(() => parseNoteInput({ title: 't', content: 'a'.repeat(20001) })).content);
});

test('parseNoteInput 拦截空标题、错误类型与控制字符', () => {
  assert.ok(fieldsOf(() => parseNoteInput({ title: '   ' })).title);
  assert.ok(fieldsOf(() => parseNoteInput({ title: 't', quote: 1 })).quote);
  assert.ok(fieldsOf(() => parseNoteInput({ title: 'a\tb' })).title);
  assert.ok(fieldsOf(() => parseNoteInput({ title: 't', content: 'a\u0000b' })).content);
  assert.doesNotThrow(() => parseNoteInput({ title: 't', content: 'a\tb\nc' }));
});
