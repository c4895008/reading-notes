CREATE TABLE IF NOT EXISTS message (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '增量拉取游标',
  discussion_id     BIGINT UNSIGNED NOT NULL,
  seq               INT UNSIGNED    NOT NULL COMMENT '场内楼层号 #1、#2…；锁笔谈行后取 MAX+1，连续无空洞',
  sender_id         BIGINT UNSIGNED NOT NULL COMMENT '写入时必须是本场有资格的参与者',
  content           TEXT            NOT NULL COMMENT '纯文本，≤ 2000 字',
  client_message_id VARCHAR(64)     NOT NULL COMMENT '客户端生成，重试幂等',
  created_at        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_message_client (discussion_id, client_message_id),
  UNIQUE KEY uk_message_seq (discussion_id, seq),
  KEY idx_message_unread (discussion_id, created_at),
  KEY idx_message_sender (sender_id),
  CONSTRAINT fk_message_discussion FOREIGN KEY (discussion_id) REFERENCES discussion (id),
  CONSTRAINT fk_message_sender FOREIGN KEY (sender_id) REFERENCES `user` (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
