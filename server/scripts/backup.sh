#!/usr/bin/env bash
# 每日备份 reading_notes 库（gzip），保留最近 7 天。定时与恢复见 DEPLOY.md。
set -euo pipefail

SERVER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$SERVER_DIR/.env"
[ -f "$ENV_FILE" ] || { echo "[backup] 缺少 $ENV_FILE"; exit 1; }

read_env() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- || true; }

DB_HOST="$(read_env DB_HOST)"; DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="$(read_env DB_PORT)"; DB_PORT="${DB_PORT:-3306}"
DB_USER="$(read_env DB_USER)"; DB_USER="${DB_USER:-root}"
DB_PASSWORD="$(read_env DB_PASSWORD)"
DB_NAME="$(read_env DB_NAME)"; DB_NAME="${DB_NAME:-reading_notes}"

if [[ ! "$DB_NAME" =~ ^reading_notes(_[a-z0-9]+)?$ ]]; then
  echo "[backup] 拒绝备份非 reading_notes 库：$DB_NAME"; exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-$SERVER_DIR/backups}"
RETAIN_DAYS="${RETAIN_DAYS:-7}"
mkdir -p "$BACKUP_DIR"

# 凭据写入临时文件，避免出现在进程参数里
CNF="$(mktemp)"
TMP_OUT=""
chmod 600 "$CNF"
trap 'rm -f "$CNF" ${TMP_OUT:+"$TMP_OUT"}' EXIT
printf '[client]\nhost=%s\nport=%s\nuser=%s\npassword=%s\n' "$DB_HOST" "$DB_PORT" "$DB_USER" "$DB_PASSWORD" > "$CNF"

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/${DB_NAME}-$STAMP.sql.gz"
TMP_OUT="$OUT.part"
# 库内没有存储过程；不加 --routines，避免 9.x 客户端查询 8.x 服务端不存在的 LIBRARIES 表
mysqldump --defaults-extra-file="$CNF" --single-transaction --no-tablespaces "$DB_NAME" | gzip > "$TMP_OUT"
# 完整成功才落为正式文件，失败不会留下半截备份
mv "$TMP_OUT" "$OUT"
TMP_OUT=""
echo "[backup] 已生成 $OUT"

# 自定义头像文件只存在磁盘上，与库同批归档，恢复时一并放回
if [ -d "$SERVER_DIR/uploads/avatars" ]; then
  AV_OUT="$BACKUP_DIR/avatars-$STAMP.tar.gz"
  TMP_OUT="$AV_OUT.part"
  tar -czf "$TMP_OUT" -C "$SERVER_DIR" uploads/avatars
  mv "$TMP_OUT" "$AV_OUT"
  TMP_OUT=""
  echo "[backup] 已生成 $AV_OUT"
fi

find "$BACKUP_DIR" \( -name "${DB_NAME}-*.sql.gz" -o -name "avatars-*.tar.gz" \) -type f -mtime +"$RETAIN_DAYS" -print -delete
