import { createApp } from './app.js';
import { config } from './config.js';
import { pool, pingDb } from './db/pool.js';

const app = createApp();

const server = app.listen(config.port, async () => {
  console.log(`[server] 读书笔记 API 已启动：http://localhost:${config.port}`);
  const db = await pingDb();
  console.log(
    db.connected
      ? `[server] 数据库 ${config.db.database} 已连接`
      : `[server] 数据库 ${config.db.database} 未连接（${db.error}）——检查 server/.env 并执行 npm run migrate`,
  );
});

function shutdown() {
  server.close(() => pool.end().finally(() => process.exit(0)));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
