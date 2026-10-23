CREATE TABLE IF NOT EXISTS book (
  id         BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED  NOT NULL COMMENT '属主；书籍仅限本人使用',
  title      VARCHAR(80)      NOT NULL COMMENT '书名；同人下唯一',
  author     VARCHAR(60)      NULL,
  status     TINYINT UNSIGNED NULL COMMENT '阅读状态：1 在读 / 2 精读 / 3 读完；NULL 未设置',
  created_at DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_book_user_title (user_id, title),
  CONSTRAINT fk_book_user FOREIGN KEY (user_id) REFERENCES `user` (id),
  CONSTRAINT ck_book_status CHECK (status IN (1, 2, 3))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
