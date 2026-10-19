// 管理员重置密码：生成一次性临时密码并吊销该账号全部登录态。
// 用法：npm run reset-password -w server -- <用户名>
// 临时密码只输出到当前终端一次，不写日志、不落盘；请经可信渠道交给本人并提醒登录后立即修改。
import { randomBytes } from 'node:crypto';
import { config } from '../src/config.js';
import { pool } from '../src/db/pool.js';
import { hashPassword } from '../src/services/auth.js';
import { findByUsername, updatePassword } from '../src/services/users.js';

const username = (process.argv[2] || '').trim().toLowerCase();
if (!/^[a-z0-9_]{3,20}$/.test(username)) {
  console.error('用法：npm run reset-password -w server -- <用户名>');
  process.exit(1);
}

try {
  const user = await findByUsername(username);
  if (!user) {
    console.error(`[reset-password] ${config.db.database} 中没有用户「${username}」`);
    process.exitCode = 1;
  } else {
    const temp = randomBytes(9).toString('base64url');
    await updatePassword(user.id, await hashPassword(temp));
    console.log(`[reset-password] 已重置 ${username}（id ${user.id}，库 ${config.db.database}），全部旧登录已失效。`);
    console.log(`临时密码：${temp}`);
  }
} finally {
  await pool.end();
}
