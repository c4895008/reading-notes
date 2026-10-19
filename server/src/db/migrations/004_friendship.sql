CREATE TABLE IF NOT EXISTS friendship (
  id           BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  requester_id BIGINT UNSIGNED  NOT NULL COMMENT '发起申请方',
  addressee_id BIGINT UNSIGNED  NOT NULL COMMENT '接收方',
  status       TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0 待处理 / 1 已同意 / 2 已拒绝 / 3 已撤回 / 4 已解除',
  created_at   DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  responded_at DATETIME(3)      NULL COMMENT '同意或拒绝的时间',
  ended_at     DATETIME(3)      NULL COMMENT '撤回或解除的时间',
  -- 同一对用户（无论方向）最多一条「待处理或已同意」记录；其余状态为 NULL 不参与唯一约束
  live_pair    VARCHAR(41) AS (
    IF(status IN (0, 1), CONCAT(LEAST(requester_id, addressee_id), ':', GREATEST(requester_id, addressee_id)), NULL)
  ) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uk_friendship_live_pair (live_pair),
  KEY idx_friendship_addressee (addressee_id, status),
  KEY idx_friendship_requester (requester_id, status),
  CONSTRAINT fk_friendship_requester FOREIGN KEY (requester_id) REFERENCES `user` (id),
  CONSTRAINT fk_friendship_addressee FOREIGN KEY (addressee_id) REFERENCES `user` (id),
  CONSTRAINT ck_friendship_status CHECK (status IN (0, 1, 2, 3, 4)),
  CONSTRAINT ck_friendship_not_self CHECK (requester_id <> addressee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
