import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { config } from '../config.js';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

async function listMigrationFiles() {
  const files = await fs.readdir(migrationsDir);
  return files.filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f)).sort();
}

async function main() {
  const { database, ...connOpts } = config.db;
  const conn = await mysql.createConnection({ ...connOpts, charset: 'utf8mb4', multipleStatements: true });

  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    await conn.query(`USE \`${database}\``);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    VARCHAR(100) NOT NULL PRIMARY KEY,
        checksum   CHAR(64)     NOT NULL,
        applied_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const [rows] = await conn.query('SELECT version, checksum FROM schema_migrations');
    const applied = new Map(rows.map((r) => [r.version, r.checksum]));
    const files = await listMigrationFiles();

    let ran = 0;
    for (const file of files) {
      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');

      if (applied.has(file)) {
        if (applied.get(file) !== checksum) {
          throw new Error(`已执行的迁移 ${file} 内容被修改；请新增迁移文件而不是改动旧文件`);
        }
        continue;
      }

      await conn.query(sql);
      await conn.query('INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)', [file, checksum]);
      console.log(`  ✓ ${file}`);
      ran += 1;
    }

    console.log(
      ran === 0
        ? `[migrate] ${database}：已是最新（共 ${files.length} 个迁移，无待执行）`
        : `[migrate] ${database}：本次执行 ${ran} 个迁移`,
    );
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(`[migrate] 失败：${err.code || ''} ${err.message}`);
  process.exit(1);
});
