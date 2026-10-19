CREATE TABLE IF NOT EXISTS user_badge (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  badge_code  VARCHAR(40)     NOT NULL COMMENT '徽章目录为代码常量，本表只存授予记录',
  awarded_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_badge (user_id, badge_code) COMMENT '幂等兜底：每人每枚只授予一次',
  CONSTRAINT fk_user_badge_user FOREIGN KEY (user_id) REFERENCES `user` (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
