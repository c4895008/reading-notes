CREATE TABLE IF NOT EXISTS note_tag (
  note_id    BIGINT UNSIGNED  NOT NULL,
  tag_id     BIGINT UNSIGNED  NOT NULL,
  created_at DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (note_id, tag_id),
  KEY idx_note_tag_tag (tag_id),
  CONSTRAINT fk_note_tag_note FOREIGN KEY (note_id) REFERENCES note (id) ON DELETE CASCADE,
  CONSTRAINT fk_note_tag_tag FOREIGN KEY (tag_id) REFERENCES tag (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
