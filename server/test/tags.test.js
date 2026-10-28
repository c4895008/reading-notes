import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkTagName } from '../src/validate.js';

test('checkTagName 去除首尾空白并放行正常名称', () => {
  assert.equal(checkTagName('读书'), '读书');
  assert.equal(checkTagName('  创业  '), '创业');
  assert.equal(checkTagName('a'.repeat(40)), 'a'.repeat(40));
});

test('checkTagName 拒绝空名', () => {
  for (const v of ['', '   ', 123, null, undefined]) {
    assert.throws(() => checkTagName(v), { code: 'VALIDATION_ERROR' });
  }
});

test('checkTagName 超长与控制字符', () => {
  assert.throws(() => checkTagName('长'.repeat(41)), { code: 'VALIDATION_ERROR' });
  assert.throws(() => checkTagName('a\nb'), { code: 'VALIDATION_ERROR' });
});
