import mysql from 'mysql2/promise';
import { config } from '../config.js';

export const pool = mysql.createPool({
  ...config.db,
  charset: 'utf8mb4',
  timezone: 'Z',
  connectionLimit: 10,
  waitForConnections: true,
  enableKeepAlive: true,
});

// DATETIME 一律按 UTC 写入与读取
pool.pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+00:00'");
});

export async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

export async function pingDb() {
  const started = Date.now();
  try {
    const conn = await pool.getConnection();
    try {
      await conn.ping();
    } finally {
      conn.release();
    }
    return { connected: true, latency_ms: Date.now() - started };
  } catch (err) {
    return { connected: false, error: err.code || 'DB_UNAVAILABLE' };
  }
}
