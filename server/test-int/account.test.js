import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { AVATAR_DIR } from '../src/services/avatar.js';
import { PASSWORD, api, nextIp, origin, register, setup } from './helpers.js';

await setup();

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c50000000049454e44ae426082', 'hex');

function avatarForm(buf, name) {
  const form = new FormData();
  form.append('avatar', new Blob([buf]), name);
  return form;
}

test('安全头与 CORS 白名单', async () => {
  const res = await api('GET', '/health');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(res.headers.get('x-powered-by'), null);
  const evil = await api('GET', '/health', { headers: { origin: 'https://evil.example' } });
  assert.equal(evil.status, 403);
  assert.equal(evil.body.error.code, 'CORS_FORBIDDEN');
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
});

test('请求体：非法 JSON 400、超 1MB 413、未知字段 400', async () => {
  const u = await register('acct');
  const bad = await api('POST', '/notes', { token: u.token, body: '{oops' });
  assert.equal(bad.body.error.code, 'INVALID_JSON');
  const big = await api('POST', '/notes', { token: u.token, body: { title: 't', content: 'x'.repeat(1_100_000) } });
  assert.equal(big.status, 413);
  const extra = await api('POST', '/notes', { token: u.token, body: { title: 't', content: 'x', user_id: 1 } });
  assert.equal(extra.status, 400);
  assert.deepEqual(extra.body.error.details.unknown, ['user_id']);
  assert.equal((await api('GET', '/nope', { token: u.token })).body.error.code, 'NOT_FOUND');
});

test('注册：用户名大小写不敏感去重；同 IP 每小时 10 次', async () => {
  const ip = nextIp();
  const reg = (username) => api('POST', '/auth/register', { ip, body: { username, password: PASSWORD } });
  assert.equal((await reg('CaseUser')).status, 201);
  const dup = await reg('caseuser');
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, 'USERNAME_TAKEN');
  for (let i = 0; i < 8; i++) assert.notEqual((await reg(`limit_${i}`)).status, 429);
  const blocked = await reg('limit_last');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, 'RATE_LIMITED');
  // 换一个来源 IP 不受影响
  assert.equal((await api('POST', '/auth/register', { ip: nextIp(), body: { username: 'limit_other', password: PASSWORD } })).status, 201);
});

test('登录：错误口令同文；同账号 5 次失败后锁定，正确口令也拒绝', async () => {
  const u = await register('login');
  const login = (password, username = u.username) => api('POST', '/auth/login', { ip: nextIp(), body: { username, password } });
  const wrong = await login('wrong-password');
  const ghost = await login('wrong-password', 'nobody_here');
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.body, ghost.body);
  for (let i = 0; i < 4; i++) await login('wrong-password');
  const locked = await login(PASSWORD);
  assert.equal(locked.status, 429);
});

test('登录：同 IP 20 次失败后锁定该 IP', async () => {
  const ip = nextIp();
  for (let i = 0; i < 20; i++) {
    await api('POST', '/auth/login', { ip, body: { username: `ghost_${i}`, password: 'x'.repeat(8) } });
  }
  const res = await api('POST', '/auth/login', { ip, body: { username: 'ghost_x', password: 'x'.repeat(8) } });
  assert.equal(res.status, 429);
});

test('改密码：旧 Token 立即失效，新密码可登录；当前密码错 5 次限流', async () => {
  const u = await register('pwd');
  const change = (current_password, new_password = 'brand-new-pass') =>
    api('POST', '/users/me/password', { token: u.token, body: { current_password, new_password } });
  assert.equal((await change('nope-nope')).body.error.code, 'WRONG_PASSWORD');
  assert.equal((await change(PASSWORD, PASSWORD)).status, 400);
  const ok = await change(PASSWORD);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.relogin, true);
  const stale = await api('GET', '/auth/me', { token: u.token });
  assert.equal(stale.status, 401);
  assert.equal(stale.body.error.code, 'TOKEN_REVOKED');
  const relog = await api('POST', '/auth/login', { ip: nextIp(), body: { username: u.username, password: 'brand-new-pass' } });
  assert.equal(relog.status, 200);

  const v = await register('pwd');
  for (let i = 0; i < 5; i++) {
    await api('POST', '/users/me/password', { token: v.token, body: { current_password: 'wrong-pass', new_password: 'another-pass' } });
  }
  const limited = await api('POST', '/users/me/password', { token: v.token, body: { current_password: PASSWORD, new_password: 'another-pass' } });
  assert.equal(limited.status, 429);
});

test('昵称与预置头像', async () => {
  const u = await register('prof');
  assert.equal((await api('PATCH', '/users/me', { token: u.token, body: { nickname: '  新昵称  ' } })).body.data.user.nickname, '新昵称');
  assert.equal((await api('PATCH', '/users/me', { token: u.token, body: { nickname: '字'.repeat(21) } })).status, 400);
  assert.deepEqual((await api('PUT', '/users/me/avatar', { token: u.token, body: { preset: 7 } })).body.data.user.avatar, {
    type: 'preset',
    preset: 7,
  });
  assert.equal((await api('PUT', '/users/me/avatar', { token: u.token, body: { preset: 11 } })).status, 400);
});

test('上传头像：白名单与大小；切回预置后删除文件', async () => {
  const u = await register('avt');
  const upload = (buf, name) => api('POST', '/users/me/avatar', { token: u.token, form: avatarForm(buf, name) });
  const reject = async (buf, name) => {
    const res = await upload(buf, name);
    assert.equal(res.status, 400, name);
    assert.equal(res.body.error.code, 'AVATAR_INVALID');
  };
  await reject(Buffer.from('<svg onload="alert(1)"/>'), 'x.svg');
  await reject(Buffer.from('GIF89a......'), 'x.gif');
  await reject(PNG, 'x.jpg');
  await reject(Buffer.from('not an image'), 'x.png');
  await reject(Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]), 'big.png');

  const ok = await upload(PNG, 'me.png');
  assert.equal(ok.status, 200, ok.text);
  const { url } = ok.body.data.user.avatar;
  assert.match(url, /^\/uploads\/avatars\/[a-f0-9]{32}\.png$/);
  const file = path.join(AVATAR_DIR, path.basename(url));
  assert.ok(existsSync(file));
  const served = await fetch(origin() + url);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-security-policy'), "default-src 'none'; sandbox");
  assert.equal((await fetch(`${origin()}/uploads/avatars/..%2f..%2f.env`)).status, 404);

  await api('PUT', '/users/me/avatar', { token: u.token, body: { preset: 2 } });
  assert.ok(!existsSync(file), '切回预置后应删除自定义头像文件');
});

test('搜索：最多 20 字；读友申请：不能加自己', async () => {
  const u = await register('srch');
  assert.equal((await api('GET', `/users/search?q=${'a'.repeat(21)}`, { token: u.token })).status, 400);
  const self = await api('POST', '/friends/requests', { token: u.token, body: { username: u.username } });
  assert.equal(self.body.error.code, 'CANNOT_ADD_SELF');
  const ghost = await api('POST', '/friends/requests', { token: u.token, body: { username: 'no_such_user' } });
  assert.equal(ghost.body.error.code, 'USER_NOT_FOUND');
});
