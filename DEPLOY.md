# 读书笔记 · 部署手册

适用于单机部署：一台 Linux 主机上运行 Nginx（HTTPS + 静态文件 + 反向代理）、Node 服务（API）与 MySQL。

## 1. 环境要求

| 组件 | 版本 |
| --- | --- |
| Node.js | ≥ 20（开发验证于 24） |
| MySQL | 8.x（开发验证于 8.4）；`mysqldump` / `mysql` 客户端可用 |
| Nginx | 任意近期版本，负责 HTTPS |

## 2. 拓扑与必须遵守的约束

```
浏览器 ──HTTPS──▶ Nginx ─┬─ /            → client/dist（静态文件，SPA 回退 index.html）
                         ├─ /api/*       → http://127.0.0.1:3001
                         └─ /uploads/*   → http://127.0.0.1:3001（头像，带 CSP sandbox）
```

- **只运行一个 Node 进程。** 限流计数与幂等缓存都在进程内存里；多进程/多实例会让限流失效。不要用 PM2 cluster 模式。重启会清零限流计数，这是已接受的取舍。
- **Nginx 必须与 Node 在同一台机器上。** 服务端设置了 `trust proxy = loopback`：只信任来自 127.0.0.1 的 `X-Forwarded-For`，按它识别客户端 IP 做注册/登录限流。代理放在别的机器上时，需改 `server/src/app.js` 里的 trust proxy 配置。
- **同源部署仍要配置 CORS 白名单。** 浏览器对同源的 POST/PUT/DELETE 也会带 `Origin` 头；`CORS_ORIGINS` 里没有正式域名时，所有写操作都会返回 403 `CORS_FORBIDDEN`。
- **数据库只用 `reading_notes`。** 服务启动时校验库名必须为 `reading_notes` 或 `reading_notes_xxx`，拒绝连接其他库；与旧库 `think_note` 完全隔离。

## 3. 首次部署

```bash
# 1) 取代码并安装依赖（根目录，npm workspaces）
cd reading-notes
npm ci

# 2) 配置环境变量
cp server/.env.example server/.env
chmod 600 server/.env
# 编辑 server/.env，见第 4 节

# 3) 建库并执行迁移（自动 CREATE DATABASE IF NOT EXISTS，可重复执行）
npm run migrate

# 4) 构建前端
npm run build        # 产物在 client/dist/

# 5) 启动 API（建议交给 systemd，见第 6 节）
NODE_ENV=production npm start -w server
curl -s http://127.0.0.1:3001/api/health   # 期望 {"data":{"status":"ok",...,"db":{"connected":true,...}}}
```

## 4. `server/.env`

| 变量 | 生产取值 | 说明 |
| --- | --- | --- |
| `PORT` | `3001` | 只监听本机，由 Nginx 转发 |
| `NODE_ENV` | `production` | 生产模式下 500 错误不回传调试信息 |
| `CORS_ORIGINS` | `https://你的域名` | 逗号分隔；必须包含正式访问域名（见第 2 节） |
| `DB_HOST` / `DB_PORT` | `127.0.0.1` / `3306` | |
| `DB_USER` / `DB_PASSWORD` | 专用账号 | 建议单独建账号，只授予 `reading_notes.*` 权限，不用 root |
| `DB_NAME` | `reading_notes` | 只允许 `reading_notes` 或 `reading_notes_xxx` |
| `JWT_SECRET` | ≥ 32 字符随机串 | 生成：`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`。更换后所有用户需重新登录 |

专用数据库账号示例：

```sql
CREATE USER 'reading_notes'@'127.0.0.1' IDENTIFIED BY '强密码';
GRANT ALL PRIVILEGES ON reading_notes.* TO 'reading_notes'@'127.0.0.1';
-- 首次迁移需要建库权限；也可由 DBA 先手工 CREATE DATABASE reading_notes 再授权
```

`.env` 不进版本库（已在 `.gitignore`），权限设为 600。

## 5. Nginx（HTTPS）

证书可用 certbot 申请（`certbot --nginx -d 你的域名`）。站点配置示例：

```nginx
server {
    listen 80;
    server_name 你的域名;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name 你的域名;

    ssl_certificate     /etc/letsencrypt/live/你的域名/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/你的域名/privkey.pem;
    add_header Strict-Transport-Security "max-age=31536000" always;

    # 头像上限 2MB + multipart 开销；JSON 请求体上限 1MB 由服务端控制
    client_max_body_size 3m;

    root /srv/reading-notes/client/dist;

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location / {
        try_files $uri /index.html;
    }

    location ~ ^/(api|uploads)/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        # 只传真实对端地址，客户端伪造的 X-Forwarded-For 不会被采信
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 6. 进程守护（systemd）

`/etc/systemd/system/reading-notes.service`：

```ini
[Unit]
Description=reading-notes API
After=network.target mysql.service

[Service]
WorkingDirectory=/srv/reading-notes/server
Environment=NODE_ENV=production
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
User=reading-notes
# 日志进 journald：只含方法、路径、状态、耗时与错误栈，不含请求体、Token、笔记与消息
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now reading-notes
journalctl -u reading-notes -f
```

运行用户需要对 `server/uploads/`（头像）和 `server/backups/` 有写权限。

## 7. 备份与恢复

### 7.1 每日备份

`npm run backup -w server`（即 `server/scripts/backup.sh`）会：

- 用 `mysqldump --single-transaction` 导出 `DB_NAME` 指定的库，生成 `server/backups/reading_notes-时间戳.sql.gz`；
- 把 `server/uploads/avatars/` 打包为 `avatars-时间戳.tar.gz`（自定义头像只在磁盘上）；
- 先写成 `.part` 临时文件，完整成功才改名为正式文件；
- 删除 7 天前的备份（`RETAIN_DAYS` 可调），满足「保留 ≥ 7 天」；
- 凭据写入权限 600 的临时文件，不出现在进程参数里；库名不是 `reading_notes*` 时拒绝执行。

目录可用 `BACKUP_DIR=/path` 覆盖。建议再定期把备份同步到另一台机器或对象存储。

**定时（Linux cron，每天 03:30）：**

```bash
crontab -e
30 3 * * * cd /srv/reading-notes/server && bash scripts/backup.sh >> backups/backup.log 2>&1
```

**定时（macOS 本机开发环境，可选）：** `crontab -e` 写入同样一行，路径换成本机项目路径。

### 7.2 恢复

```bash
# 恢复数据库（目标库名必须是 reading_notes 或 reading_notes_xxx）
bash server/scripts/restore.sh server/backups/reading_notes-时间戳.sql.gz reading_notes_restore
```

- 目标库已有数据表时拒绝执行；确认要覆盖时加 `FORCE=1`（会覆盖同名表）。
- 执行后打印各表行数，便于和备份前核对。
- 恢复头像：`tar -xzf server/backups/avatars-时间戳.tar.gz -C server`。

**正式恢复的推荐步骤：** 先恢复到 `reading_notes_restore` 核对行数 → 停服务 → 用 `FORCE=1` 恢复到 `reading_notes`（或把 `.env` 的 `DB_NAME` 指向已核对的库）→ 解压头像 → `npm run migrate`（应提示「已是最新」）→ 启动服务。

### 7.3 恢复演练记录

| 日期 | 内容 | 结果 |
| --- | --- | --- |
| 2026-10-19 | 备份 `reading_notes` → 恢复到临时库 `reading_notes_restore` → 核对 8 张表行数 → 对临时库执行迁移 → 删除临时库 | 行数与源库完全一致；迁移提示「已是最新（共 8 个迁移）」；`think_note` 未接触 |

## 8. 管理员重置密码

P0 没有自助找回密码。用户忘记密码时，由管理员在服务器上执行：

```bash
npm run reset-password -w server -- 用户名
```

- 生成一次性临时密码，只在当前终端输出一次，不写日志、不落盘；
- 同时让该账号所有已登录设备立即失效（`token_version + 1`）；
- 请经可信渠道交给本人，提醒登录后在「设置」里立即修改。

## 9. 升级

```bash
git pull            # 或替换代码
npm ci
npm run backup -w server     # 升级前先备份
npm run migrate              # 只会执行新增迁移；已执行迁移被改动时会报错拒绝
npm run build
sudo systemctl restart reading-notes
```

## 10. 上线检查表

- [ ] `https://你的域名` 可访问，HTTP 自动跳 HTTPS
- [ ] `CORS_ORIGINS` 含正式域名；登录、写笔记等写操作正常
- [ ] `NODE_ENV=production`；`JWT_SECRET` 为新生成的随机串
- [ ] `/api/health` 显示数据库已连接
- [ ] 上传头像后可显示；`/uploads/avatars/` 响应带 `Content-Security-Policy: default-src 'none'; sandbox`
- [ ] 响应头带 `X-Robots-Tag: noindex, nofollow`
- [ ] 备份 cron 已安装，第二天 `server/backups/` 出现新文件
- [ ] 只有一个 Node 进程在运行
