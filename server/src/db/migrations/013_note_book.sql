ALTER TABLE note
  ADD COLUMN book_id BIGINT UNSIGNED NULL DEFAULT NULL COMMENT '所属书籍；NULL 未归类' AFTER kind,
  ADD KEY idx_note_user_book (user_id, book_id),
  ADD CONSTRAINT fk_note_book FOREIGN KEY (book_id) REFERENCES book (id) ON DELETE SET NULL;
