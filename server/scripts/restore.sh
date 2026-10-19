#!/usr/bin/env bash
# 把 backup.sh 生成的备份恢复到指定库。用法：scripts/restore.sh <备份.sql.gz> <目标库名>
# 目标库已有数据表时拒绝执行，除非显式 FORCE=1（会覆盖同名表）。
set -euo pipefail

SERVER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$SERVER_DIR/.env"
[ -f "$ENV_FILE" ] || { echo "[restore] 缺少 $ENV_FILE"; exit 1; }
[ $# -eq 2 ] || { echo "用法：$0 <备份.sql.gz> <目标库名>"; exit 1; }

FILE="$1"
TARGET="$2"
[ -f "$FILE" ] || { echo "[restore] 找不到备份文件 $FILE"; exit 1; }
if [[ ! "$TARGET" =~ ^reading_notes(_[a-z0-9]+)?$ ]]; then
  echo "[restore] 目标库必须为 reading_notes 或 reading_notes_xxx：$TARGET"; exit 1
fi

read_env() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- || true; }
DB_HOST="$(read_env DB_HOST)"; DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="$(read_env DB_PORT)"; DB_PORT="${DB_PORT:-3306}"
DB_USER="$(read_env DB_USER)"; DB_USER="${DB_USER:-root}"
DB_PASSWORD="$(read_env DB_PASSWORD)"

CNF="$(mktemp)"
chmod 600 "$CNF"
trap 'rm -f "$CNF"' EXIT
printf '[client]\nhost=%s\nport=%s\nuser=%s\npassword=%s\n' "$DB_HOST" "$DB_PORT" "$DB_USER" "$DB_PASSWORD" > "$CNF"

gzip -t "$FILE" || { echo "[restore] 备份文件已损坏"; exit 1; }

mysql --defaults-extra-file="$CNF" -e \
  "CREATE DATABASE IF NOT EXISTS \`$TARGET\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
TABLES="$(mysql --defaults-extra-file="$CNF" -N -e \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$TARGET'")"
if [ "$TABLES" != "0" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "[restore] 目标库 $TARGET 已有 $TABLES 张表；确认覆盖请加 FORCE=1"; exit 1
fi

gunzip -c "$FILE" | mysql --defaults-extra-file="$CNF" "$TARGET"
echo "[restore] 已恢复到 $TARGET，各表行数："
mysql --defaults-extra-file="$CNF" -t -e "
  SELECT 'user' AS tbl, COUNT(*) AS n FROM \`$TARGET\`.\`user\`
  UNION ALL SELECT 'note', COUNT(*) FROM \`$TARGET\`.note
  UNION ALL SELECT 'friendship', COUNT(*) FROM \`$TARGET\`.friendship
  UNION ALL SELECT 'discussion', COUNT(*) FROM \`$TARGET\`.discussion
  UNION ALL SELECT 'discussion_participant', COUNT(*) FROM \`$TARGET\`.discussion_participant
  UNION ALL SELECT 'message', COUNT(*) FROM \`$TARGET\`.message
  UNION ALL SELECT 'user_badge', COUNT(*) FROM \`$TARGET\`.user_badge
  UNION ALL SELECT 'schema_migrations', COUNT(*) FROM \`$TARGET\`.schema_migrations"
