ALTER TABLE note
  ADD COLUMN visibility ENUM('private', 'friends') NOT NULL DEFAULT 'private' COMMENT '仅自己 / 当前读友可见',
  ADD COLUMN shared_at DATETIME(3) NULL DEFAULT NULL COMMENT '本次分享开始时间；收回分享时清空',
  ADD KEY idx_note_feed (visibility, status, shared_at DESC, id DESC),
  ADD KEY idx_note_user_feed (user_id, visibility, status, shared_at DESC, id DESC),
  ADD CONSTRAINT ck_note_sharing CHECK (
    (visibility = 'private' AND shared_at IS NULL) OR
    (visibility = 'friends' AND shared_at IS NOT NULL)
  );

CREATE TABLE note_like (
  note_id    BIGINT UNSIGNED NOT NULL,
  user_id    BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (note_id, user_id),
  KEY idx_note_like_user (user_id),
  CONSTRAINT fk_note_like_note FOREIGN KEY (note_id) REFERENCES note (id),
  CONSTRAINT fk_note_like_user FOREIGN KEY (user_id) REFERENCES `user` (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
