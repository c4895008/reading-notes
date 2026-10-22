# 读书笔记

摘引文、写笔记、把笔记长成结构，再邀请读友就某一条笔记同场讨论。

- 产品需求：`../docs/PRD-读书笔记.md`
- 开发计划：`../docs/开发计划-读书笔记.md`
- 部署与运维：[`DEPLOY.md`](DEPLOY.md)

## 目录

```
reading-notes/
├── client/   Vite + React + TypeScript（开发端口 5173，/api 与 /uploads 代理到 3001）
└── server/   Express + mysql2（端口 3001）
    ├── src/db/migrations/   有序 SQL 迁移（带校验和，已执行的不可改）
    ├── scripts/             backup.sh / restore.sh / reset-password.mjs
    ├── test/                单元测试（纯函数，不连库）
    └── test-int/            集成测试与 E2E 主流程（连 reading_notes_test 库）
```

## 本地运行

前置：Node ≥ 20、本机 MySQL 8.x。

```bash
cd reading-notes
npm install

cp server/.env.example server/.env
# 编辑 server/.env：填 DB_PASSWORD；JWT_SECRET 用下面命令生成
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

npm run migrate   # 创建 reading_notes 库并建表
npm run dev       # 同时启动 server(3001) 与 client(5173)
```

打开 http://localhost:5173 注册即可使用。

> 服务只允许连接 `reading_notes` 或 `reading_notes_xxx` 库，旧库 `think_note` 不会被触碰。

## 测试

```bash
# 单元测试（不需要数据库）
npm test -w server

# 集成测试 + E2E 主流程：自动建/迁移 reading_notes_test 库，每个测试文件开始前清空该库
npm run test:int -w server

# 前端类型检查
cd client && npx tsc --noEmit -p .
```

集成测试会清空 `reading_notes_test` 的数据，代码里有双重保护：库名不是 `reading_notes_test` 时拒绝运行，清表前再确认当前连接的库名。

## 常用脚本

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 同时启动前后端（热重载） |
| `npm run migrate` | 执行待执行的迁移 |
| `npm run build` | 构建前端到 `client/dist/` |
| `npm run backup -w server` | 备份数据库与头像到 `server/backups/`，保留 7 天 |
| `npm run restore -w server -- backups/<备份.sql.gz> <目标库>` | 恢复备份（路径相对 `server/`；目标库非空时需 `FORCE=1`） |
| `npm run reset-password -w server -- <用户名>` | 管理员重置密码并吊销该账号全部登录 |
