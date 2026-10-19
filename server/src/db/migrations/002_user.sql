CREATE TABLE IF NOT EXISTS `user` (
  id            BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  username      VARCHAR(20)      NOT NULL COMMENT '小写存储，注册后不可改',
  password_hash VARCHAR(72)      NOT NULL COMMENT 'bcrypt',
  nickname      VARCHAR(20)      NOT NULL,
  avatar_type   TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1 预置 / 2 自定义上传',
  avatar_preset TINYINT UNSIGNED NULL COMMENT '预置头像 1–10，注册按 ID 稳定分配',
  avatar_url    VARCHAR(255)     NULL COMMENT '自定义头像路径',
  token_version INT UNSIGNED     NOT NULL DEFAULT 0 COMMENT '改密码时递增，使旧 Token 全部失效',
  status        TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1 正常 / 0 禁用',
  created_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_username (username),
  CONSTRAINT ck_user_avatar_type CHECK (avatar_type IN (1, 2)),
  CONSTRAINT ck_user_avatar_preset CHECK (avatar_preset IS NULL OR avatar_preset BETWEEN 1 AND 10),
  CONSTRAINT ck_user_status CHECK (status IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
