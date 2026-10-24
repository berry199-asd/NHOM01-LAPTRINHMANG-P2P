-- ============================================================
-- WorkChat — Migration 005: bảng theo dõi blob tệp (Tracker)
-- DB thực tế: MariaDB (XAMPP). KHÔNG DROP, KHÔNG sửa cột cũ.
--
-- Trạng thái: CHƯA BẮT BUỘC. Bản hiện tại lưu metadata blob trên đĩa
-- (BLOB_DIR/<blobId>.json) nên tính năng chạy được mà không cần migration.
-- File này chỉ ghi lại schema dự kiến khi chuyển metadata vào MySQL.
--
-- BACKUP trước khi chạy:
--   mysqldump -u root workchat > workchat-backup-<yyyyMMdd-HHmmss>.sql
-- ============================================================

USE workchat;

CREATE TABLE IF NOT EXISTS file_blobs (
  blob_id     CHAR(32)     NOT NULL,
  owner_id    BIGINT       NOT NULL,
  room_id     BIGINT       NULL,
  size_bytes  BIGINT       NOT NULL,
  blocks      INT          NOT NULL,
  state       ENUM('uploading','complete','deleted') NOT NULL DEFAULT 'uploading',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  DATETIME     NOT NULL,
  PRIMARY KEY (blob_id),
  KEY idx_file_blobs_owner_state (owner_id, state),
  KEY idx_file_blobs_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
