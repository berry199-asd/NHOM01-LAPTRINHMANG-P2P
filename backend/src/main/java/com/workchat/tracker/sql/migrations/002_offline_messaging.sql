-- ============================================================
-- WorkChat — Migration 002: Nhắn tin ngoại tuyến (store-and-forward E2E)
-- DB thực tế: MariaDB (XAMPP). Dùng IF NOT EXISTS / DROP CONSTRAINT IF EXISTS
-- nên chạy lại nhiều lần vẫn an toàn (idempotent). KHÔNG DROP bảng/dữ liệu.
-- ============================================================

USE workchat;

-- ------------------------------------------------------------
-- 1) Thư mục khóa công khai RSA của mỗi người dùng.
--    public_key: DER (X.509 SubjectPublicKeyInfo) của RSA-2048, thô.
--    key_fingerprint: SHA-256(public_key) dạng hex thường (64 ký tự).
-- ------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS public_key      VARBINARY(1024) NULL AFTER bio,
  ADD COLUMN IF NOT EXISTS key_fingerprint CHAR(64)        NULL AFTER public_key;

-- ------------------------------------------------------------
-- 2) Hộp thư offline: mở rộng message_cache để chứa PHONG BÌ ĐÃ MÃ HÓA.
--    Mỗi dòng là một phong bì cho đúng một recipient_id (kể cả nhóm).
--    - algo: nhãn thuật toán, ví dụ "RSA-2048/OAEP-SHA256 + AES-256-GCM + RSA-PSS-SHA256".
--    - iv: nonce AES-GCM (12 byte; cột rộng 16 cho an toàn).
--    - wrapped_key: khóa AES bọc bằng RSA-OAEP(public key người nhận).
--    - signature: chữ ký RSA-PSS của người gửi trên (client_msg_id, recipient_id, sent_at, ciphertext).
--    - ciphertext: nội dung đã mã hóa AES-256-GCM (gồm cả tag).
--    - sent_at: thời điểm client gửi (dùng cho thứ tự hiển thị + ký).
--    Các cột legacy (envelope_json, media_file_path, content_type) giữ lại
--    cho tương thích; CHECK được nới để chấp nhận dạng phong bì mới.
-- ------------------------------------------------------------
ALTER TABLE message_cache
  ADD COLUMN IF NOT EXISTS algo        VARCHAR(32)     NULL AFTER content_type,
  ADD COLUMN IF NOT EXISTS iv          VARBINARY(16)   NULL AFTER algo,
  ADD COLUMN IF NOT EXISTS wrapped_key VARBINARY(1024) NULL AFTER iv,
  ADD COLUMN IF NOT EXISTS signature   VARBINARY(1024) NULL AFTER wrapped_key,
  ADD COLUMN IF NOT EXISTS ciphertext  MEDIUMBLOB      NULL AFTER signature,
  ADD COLUMN IF NOT EXISTS sent_at     DATETIME        NULL AFTER ciphertext;

ALTER TABLE message_cache DROP CONSTRAINT IF EXISTS chk_mc_payload;

ALTER TABLE message_cache
  ADD CONSTRAINT chk_mc_payload CHECK (
      (envelope_json IS NOT NULL)
      OR (media_file_path IS NOT NULL)
      OR (ciphertext IS NOT NULL AND wrapped_key IS NOT NULL AND iv IS NOT NULL)
  );

-- Truy vấn pull: WHERE recipient_id = ? AND delivered_at IS NULL AND id > ? ORDER BY id LIMIT ?.
ALTER TABLE message_cache
  ADD INDEX IF NOT EXISTS idx_mc_pending (recipient_id, delivered_at, id);

-- ------------------------------------------------------------
-- 3) Cấu hình nền cho tính năng offline.
-- ------------------------------------------------------------
INSERT INTO system_config (config_key, config_value) VALUES
  ('offline_ttl_days', '30'),
  ('offline_mailbox_limit', '500'),
  ('offline_pull_limit', '100'),
  ('offline_max_text_bytes', '4096')
ON DUPLICATE KEY UPDATE config_value = config_value;

-- ------------------------------------------------------------
-- Ghi chú:
-- - Lịch sử tin nằm ở client (SQLite). Server chỉ giữ metadata (message_meta,
--   content NULL cho tin mới) + phong bì trong message_cache cho tới khi
--   người nhận OFFLINE_ACK hoặc hết hạn.
-- - Tin cũ: message_meta.content IS NOT NULL = bản legacy plaintext, giữ nguyên,
--   không thể backfill mã hóa (khi đó chưa có public key).
-- ------------------------------------------------------------
