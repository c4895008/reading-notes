CREATE TABLE IF NOT EXISTS note (
  id           BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED  NOT NULL COMMENT '作者；父子关系仅限同一作者',
  parent_id    BIGINT UNSIGNED  NULL COMMENT 'NULL = 顶层',
  sort_order   INT              NULL COMMENT '同级排序；NULL 时按 created_at 兜底',
  title        VARCHAR(80)      NOT NULL,
  quote        TEXT             NULL COMMENT '引文：纯文本，保留换行',
  content      MEDIUMTEXT       NOT NULL COMMENT '想法：Markdown 源文',
  content_text MEDIUMTEXT       NOT NULL COMMENT '由 content 派生的纯文本，用于摘要与搜索',
  status       TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1 正常 / 2 已删除',
  created_at   DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '仅内容编辑时更新，结构调整不改',
  PRIMARY KEY (id),
  KEY idx_note_user_parent (user_id, parent_id),
  KEY idx_note_user_updated (user_id, status, updated_at),
  CONSTRAINT fk_note_user FOREIGN KEY (user_id) REFERENCES `user` (id),
  CONSTRAINT fk_note_parent FOREIGN KEY (parent_id) REFERENCES note (id),
  CONSTRAINT ck_note_status CHECK (status IN (1, 2))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
