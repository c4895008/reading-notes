CREATE TABLE IF NOT EXISTS discussion_participant (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  discussion_id BIGINT UNSIGNED NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL COMMENT '只增不删；解除读友靠动态资格判定控制可见性',
  last_read_at  DATETIME(3)     NULL COMMENT '本人已读游标；NULL = 受邀后尚未打开过',
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '加入（受邀）时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_participant (discussion_id, user_id),
  KEY idx_participant_user (user_id),
  CONSTRAINT fk_participant_discussion FOREIGN KEY (discussion_id) REFERENCES discussion (id),
  CONSTRAINT fk_participant_user FOREIGN KEY (user_id) REFERENCES `user` (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
