CREATE TABLE IF NOT EXISTS tag (
  id         BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED  NOT NULL COMMENT '属主；标签仅限本人使用',
  name       VARCHAR(40)      NOT NULL COMMENT '标签名；同人下唯一',
  created_at DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_tag_user_name (user_id, name),
  CONSTRAINT fk_tag_user FOREIGN KEY (user_id) REFERENCES `user` (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
