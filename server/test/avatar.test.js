import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AVATAR_MAX_BYTES, checkAvatarFile, detectImageType } from '../src/services/avatar.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const pad = (buf, size) => Buffer.concat([buf, Buffer.alloc(size - buf.length)]);

test('按文件头识别三种格式', () => {
  assert.equal(detectImageType(JPEG), 'jpeg');
  assert.equal(detectImageType(PNG), 'png');
  assert.equal(detectImageType(WEBP), 'webp');
  assert.equal(detectImageType(Buffer.from('GIF89a......')), null);
  assert.equal(detectImageType(Buffer.from('RIFF\0\0\0\0WAVE')), null);
  assert.equal(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">')), null);
  assert.equal(detectImageType(Buffer.alloc(0)), null);
  assert.equal(detectImageType('not a buffer'), null);
});

test('扩展名与真实格式一致时通过，并按真实格式落盘扩展名', () => {
  assert.equal(checkAvatarFile('me.jpg', JPEG), 'jpg');
  assert.equal(checkAvatarFile('ME.JPEG', JPEG), 'jpg');
  assert.equal(checkAvatarFile('a.png', PNG), 'png');
  assert.equal(checkAvatarFile('a.webp', WEBP), 'webp');
});

test('伪造扩展名、错配、白名单外格式一律拒绝', () => {
  assert.equal(checkAvatarFile('evil.jpg', Buffer.from('<html><script>alert(1)</script>')), null);
  assert.equal(checkAvatarFile('a.png', JPEG), null);
  assert.equal(checkAvatarFile('a.webp', PNG), null);
  assert.equal(checkAvatarFile('a.gif', JPEG), null);
  assert.equal(checkAvatarFile('a.svg', PNG), null);
  assert.equal(checkAvatarFile('noext', JPEG), null);
  assert.equal(checkAvatarFile('a.jpg.html', JPEG), null);
  assert.equal(checkAvatarFile(undefined, JPEG), null);
});

test('大小以 2MB 为界，空文件拒绝', () => {
  assert.equal(checkAvatarFile('a.jpg', pad(JPEG, AVATAR_MAX_BYTES)), 'jpg');
  assert.equal(checkAvatarFile('a.jpg', pad(JPEG, AVATAR_MAX_BYTES + 1)), null);
  assert.equal(checkAvatarFile('a.jpg', Buffer.alloc(0)), null);
});
