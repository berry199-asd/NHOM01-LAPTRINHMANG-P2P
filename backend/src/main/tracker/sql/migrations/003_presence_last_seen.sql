-- ============================================================
-- WorkChat — Migration 003: presence — last_seen_at
-- DB thực tế: MariaDB (XAMPP). Idempotent (IF NOT EXISTS).
-- KHÔNG DROP bảng/dữ liệu; chỉ ALTER TABLE ADD COLUMN.
-- BACKUP trước khi chạy:
--   mysqldump -u root workchat > workchat-backup-<yyyyMMdd-HHmmss>.sql
-- ============================================================

USE workchat;

-- Thời điểm cuối cùng Peer Core còn sống (heartbeat), epoch millis.
-- Ghi khi chuyển sang offline và theo chu kỳ thưa (~60s), KHÔNG ghi mỗi nhịp.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_seen_at BIGINT NULL AFTER bio;
