ALTER TABLE note
  ADD COLUMN kind TINYINT UNSIGNED NULL DEFAULT NULL COMMENT '分类：1 观点 / 2 问题 / 3 总结；NULL 未分类' AFTER content_text,
  ADD CONSTRAINT ck_note_kind CHECK (kind IN (1, 2, 3));
