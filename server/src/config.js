import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(serverRoot, '.env') });

const env = process.env;

const dbName = env.DB_NAME || 'reading_notes';
// 红线：只允许连接本应用的独立库，杜绝误连 think_note 旧库
if (!/^reading_notes(_[a-z0-9]+)?$/.test(dbName)) {
  throw new Error(`DB_NAME 必须为 reading_notes（或 reading_notes_xxx），当前为「${dbName}」`);
}

const jwtSecret = env.JWT_SECRET || '';
if (jwtSecret.length < 32) {
  throw new Error('JWT_SECRET 未设置或少于 32 字符，请在 server/.env 中配置');
}

export const config = {
  serverRoot,
  env: env.NODE_ENV || 'development',
  isProd: env.NODE_ENV === 'production',
  port: Number(env.PORT) || 3001,
  corsOrigins: (env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  db: {
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT) || 3306,
    user: env.DB_USER || 'root',
    password: env.DB_PASSWORD || '',
    database: dbName,
  },
  jwt: {
    secret: jwtSecret,
    expiresIn: '14d',
  },
  bcryptCost: 11,
};
