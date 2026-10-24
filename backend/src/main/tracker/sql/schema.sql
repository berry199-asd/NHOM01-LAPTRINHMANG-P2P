-- ============================================================
-- WorkChat — Discovery Server schema (Phase 1+2)
-- MySQL 8.4+  |  utf8mb4 / utf8mb4_unicode_ci
-- Nguyên tắc: MySQL CHỈ lưu metadata + cache offline.
-- Nội dung tin nhắn/file và lịch sử nằm ở client (P2P).
-- Phase 1: CHƯA mã hoá E2E — payload trong message_cache là PLAINTEXT.
--          E2E sẽ thêm ở phase 3 (không giả định mã hoá ở đây).
-- ============================================================

CREATE DATABASE IF NOT EXISTS workchat
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE workchat;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS message_cache;
DROP TABLE IF EXISTS broadcasts;
DROP TABLE IF EXISTS system_config;
DROP TABLE IF EXISTS system_logs;
DROP TABLE IF EXISTS call_participants;
DROP TABLE IF EXISTS calls;
DROP TABLE IF EXISTS reports;
DROP TABLE IF EXISTS reactions;
DROP TABLE IF EXISTS message_hidden;
DROP TABLE IF EXISTS message_receipts;
DROP TABLE IF EXISTS message_meta;
DROP TABLE IF EXISTS room_invites;
DROP TABLE IF EXISTS room_members;
DROP TABLE IF EXISTS rooms;
DROP TABLE IF EXISTS blocks;
DROP TABLE IF EXISTS friendships;
DROP TABLE IF EXISTS friend_requests;
DROP TABLE IF EXISTS otp_codes;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
SET FOREIGN_KEY_CHECKS = 1;

-- ============ NHÓM A — METADATA CỐ ĐỊNH ============

CREATE TABLE users (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id       VARCHAR(24)  NULL,          -- base62 12-16 ký tự; backfill khi khởi động
  username        VARCHAR(32)  NOT NULL,
  email           VARCHAR(255) NOT NULL,
  pass_hash       VARCHAR(255) NOT NULL,
  phone           VARCHAR(20)  NULL,
  show_phone      BOOLEAN      NOT NULL DEFAULT FALSE,
  date_of_birth   DATE         NULL,
  display_name    VARCHAR(100) NOT NULL,
  avatar_url      MEDIUMTEXT   NULL,
  cover_url       MEDIUMTEXT   NULL,
  bio             VARCHAR(150) NULL,
  last_seen_at    BIGINT       NULL,          -- epoch ms lần cuối Peer Core còn sống
  public_key      VARBINARY(1024) NULL,       -- DER X.509 RSA-2048 (E2E offline)
  key_fingerprint CHAR(64)        NULL,        -- SHA-256(public_key) hex
  email_verified_at DATETIME NULL,
  role            ENUM('user','moderator','admin') NOT NULL DEFAULT 'user',
  is_locked       BOOLEAN      NOT NULL DEFAULT FALSE,
  theme_mode      ENUM('light','dark') NOT NULL DEFAULT 'light',
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_public_id (public_id),
  KEY idx_users_username_like (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sessions (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NOT NULL,
  token        VARCHAR(255) NOT NULL,
  device_info  VARCHAR(255) NULL,
  expires_at   DATETIME     NOT NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at   DATETIME     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sessions_token (token),
  KEY idx_sessions_user (user_id, expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE otp_codes (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED NULL,
  target        VARCHAR(255) NOT NULL,
  purpose       ENUM('register','forgot_password','change_email_old','change_email_new') NOT NULL,
  code_hash     VARCHAR(255) NOT NULL,
  expires_at    DATETIME NOT NULL,
  consumed_at   DATETIME NULL,
  attempt_count TINYINT  NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_otp_target (target, purpose),
  KEY idx_otp_user (user_id),
  CONSTRAINT fk_otp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Request CÓ HƯỚNG (A→B khác B→A) nhưng MỘT cặp chỉ có 1 request đang pending.
-- Xử lý tại service: nếu A→B đang pending mà B gửi A → trả lời request cũ,
-- KHÔNG tạo bản ghi mới. DB chỉ chặn "tự kết bạn".
CREATE TABLE friend_requests (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  from_user_id BIGINT UNSIGNED NOT NULL,
  to_user_id   BIGINT UNSIGNED NOT NULL,
  status       ENUM('pending','accepted','declined') NOT NULL DEFAULT 'pending',
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fr_pair (from_user_id, to_user_id),
  KEY idx_fr_to (to_user_id, status),
  CONSTRAINT chk_fr_not_self CHECK (from_user_id <> to_user_id),
  CONSTRAINT fk_fr_from FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_fr_to   FOREIGN KEY (to_user_id)   REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Quan hệ bạn bè ĐỐI XỨNG → luôn lưu user_a_id < user_b_id
-- (server chuẩn hoá LEAST/GREATEST trước khi INSERT).
CREATE TABLE friendships (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_a_id  BIGINT UNSIGNED NOT NULL,
  user_b_id  BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fs_pair (user_a_id, user_b_id),
  KEY idx_fs_a (user_a_id),
  KEY idx_fs_b (user_b_id),
  CONSTRAINT chk_fs_order CHECK (user_a_id < user_b_id),
  CONSTRAINT fk_fs_a FOREIGN KEY (user_a_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_fs_b FOREIGN KEY (user_b_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE blocks (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  blocker_id BIGINT UNSIGNED NOT NULL,
  blocked_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_blocks_pair (blocker_id, blocked_id),
  CONSTRAINT chk_blocks_not_self CHECK (blocker_id <> blocked_id),
  CONSTRAINT fk_blk_a FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_blk_b FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- rooms. QUY ƯỚC 1-1: member_a_id = LEAST(u1,u2), member_b_id = GREATEST(u1,u2).
CREATE TABLE rooms (
  id                        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  is_direct                 BOOLEAN NOT NULL,
  name                      VARCHAR(100) NULL,
  avatar_url                MEDIUMTEXT NULL,
  background_url            VARCHAR(500) NULL,
  theme_color               VARCHAR(20) NOT NULL DEFAULT '#1A1A1A',
  default_reaction_emoji    VARCHAR(10) NOT NULL DEFAULT '👍',
  member_a_id               BIGINT UNSIGNED NULL,
  member_b_id               BIGINT UNSIGNED NULL,
  max_members               INT NOT NULL DEFAULT 20,   -- sức chứa (admin cấu hình max_room_members); SocialDao.addMemberChecked bắt buộc có
  created_by                BIGINT UNSIGNED NULL,
  created_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rooms_direct (member_a_id, member_b_id),
  KEY idx_rooms_created_by (created_by),
  CONSTRAINT fk_rooms_a FOREIGN KEY (member_a_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_rooms_b FOREIGN KEY (member_b_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_rooms_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_rooms_state CHECK (
      is_direct = (member_a_id IS NOT NULL AND member_b_id IS NOT NULL)
      AND (NOT is_direct OR member_a_id < member_b_id)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- QUY ƯỚC vòng đời thành viên: rời → left_at != NULL;
-- JOIN LẠI = UPDATE left_at = NULL, banned_at = NULL trên CHÍNH record.
CREATE TABLE room_members (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  room_id               BIGINT UNSIGNED NOT NULL,
  user_id               BIGINT UNSIGNED NOT NULL,
  room_role             ENUM('member','leader') NOT NULL DEFAULT 'member',
  nickname              VARCHAR(100) NULL,
  is_pinned             BOOLEAN NOT NULL DEFAULT FALSE,
  pinned_at             DATETIME NULL,
  is_muted              BOOLEAN NOT NULL DEFAULT FALSE,
  last_read_message_id  VARCHAR(64) NULL,
  joined_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  left_at               DATETIME NULL,
  banned_at             DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rm_room_user (room_id, user_id),
  KEY idx_rm_user (user_id, room_id),
  KEY idx_rm_room_pin (room_id, is_pinned, pinned_at),
  CONSTRAINT fk_rm_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_rm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE room_invites (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  room_id     BIGINT UNSIGNED NOT NULL,
  invite_code VARCHAR(32) NOT NULL,
  created_by  BIGINT UNSIGNED NOT NULL,
  expires_at  DATETIME NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ri_code (invite_code),
  KEY idx_ri_room (room_id),
  CONSTRAINT fk_ri_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_ri_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- message_meta: KHÔNG lưu file. client_msg_id do client sinh
-- trước khi server ghi nhận → dùng làm khoá liên kết (tránh race), đồng thời là
-- khoá dedupe idempotent (UNIQUE). content: nội dung văn bản của tin nhắn để FE
-- khôi phục lịch sử sau khi reload; media lớn không lưu base64 tại đây.
CREATE TABLE message_meta (
  id                        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  client_msg_id             VARCHAR(64) NOT NULL,
  room_id                   BIGINT UNSIGNED NOT NULL,
  sender_id                 BIGINT UNSIGNED NOT NULL,
  type                      ENUM('text','image','video','file','voice','call','system') NOT NULL,
  reply_to_client_id        VARCHAR(64) NULL,
  forwarded_from_client_id  VARCHAR(64) NULL,
  content                   TEXT NULL,
  is_pinned                 BOOLEAN NOT NULL DEFAULT FALSE,
  is_recalled_all           BOOLEAN NOT NULL DEFAULT FALSE,
  is_edited                 BOOLEAN NOT NULL DEFAULT FALSE,
  sent_at                   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  edited_at                 DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mm_client (client_msg_id),
  KEY idx_mm_room_time (room_id, sent_at),
  KEY idx_mm_room_sender (room_id, sender_id, sent_at),
  CONSTRAINT fk_mm_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_mm_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE message_receipts (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  client_msg_id VARCHAR(64) NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  status        ENUM('delivered','seen') NOT NULL,
  at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_receipt (client_msg_id, user_id, status),
  KEY idx_receipt_msg (client_msg_id),
  KEY idx_receipt_user (user_id),
  CONSTRAINT fk_rcpt_msg FOREIGN KEY (client_msg_id) REFERENCES message_meta(client_msg_id) ON DELETE CASCADE,
  CONSTRAINT fk_rcpt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE reactions (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  client_msg_id VARCHAR(64) NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  emoji         VARCHAR(10) NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_react_msg_user (client_msg_id, user_id),
  KEY idx_react_msg (client_msg_id),
  CONSTRAINT fk_react_msg FOREIGN KEY (client_msg_id) REFERENCES message_meta(client_msg_id) ON DELETE CASCADE,
  CONSTRAINT fk_react_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- message_hidden: "xoá chỉ ở phía tôi" — người dùng ẩn tin khỏi lịch sử PHÍA RIÊNG mình.
CREATE TABLE message_hidden (
  client_msg_id VARCHAR(64) NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  hidden_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_msg_id, user_id),
  KEY idx_hidden_user (user_id),
  CONSTRAINT fk_hidden_msg FOREIGN KEY (client_msg_id) REFERENCES message_meta(client_msg_id) ON DELETE CASCADE,
  CONSTRAINT fk_hidden_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE reports (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reporter_id   BIGINT UNSIGNED NOT NULL,
  target_type   ENUM('user','room','message') NOT NULL,
  target_id     VARCHAR(64) NOT NULL,
  reason        VARCHAR(255) NOT NULL,
  evidence_note TEXT NULL,
  status        ENUM('pending','resolved','dismissed') NOT NULL DEFAULT 'pending',
  handled_by    BIGINT UNSIGNED NULL,
  handled_at    DATETIME NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_rpt_status (status, created_at),
  KEY idx_rpt_target (target_type, target_id),
  CONSTRAINT fk_rpt_reporter FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_rpt_handler  FOREIGN KEY (handled_by)  REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- LỊCH SỬ cuộc gọi (trạng thái CUỐI). Trạng thái realtime sống trong bộ nhớ
-- Discovery Server, chỉ ghi DB một dòng khi call kết thúc.
CREATE TABLE calls (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  room_id            BIGINT UNSIGNED NOT NULL,
  initiator_id       BIGINT UNSIGNED NOT NULL,
  type               ENUM('audio','video') NOT NULL,
  status             ENUM('missed','answered','rejected','cancelled','failed') NOT NULL,
  started_at         DATETIME NOT NULL,
  connected_at       DATETIME NULL,
  ended_at           DATETIME NULL,
  duration_seconds   INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_calls_room (room_id, started_at),
  KEY idx_calls_initiator (initiator_id, started_at),
  CONSTRAINT fk_calls_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_calls_initiator FOREIGN KEY (initiator_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE call_participants (
  id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  call_id   BIGINT UNSIGNED NOT NULL,
  user_id   BIGINT UNSIGNED NOT NULL,
  joined_at DATETIME NULL,
  left_at   DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_cp_call (call_id),
  KEY idx_cp_user (user_id),
  CONSTRAINT fk_cp_call FOREIGN KEY (call_id) REFERENCES calls(id) ON DELETE CASCADE,
  CONSTRAINT fk_cp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE system_logs (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_type ENUM('LOGIN','LOGOUT','LOOKUP','TIMEOUT') NOT NULL,
  user_id    BIGINT UNSIGNED NULL,
  ip_address VARCHAR(45) NULL,
  detail     VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sl_type (event_type, created_at),
  KEY idx_sl_user (user_id),
  CONSTRAINT fk_sl_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE system_config (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  config_key    VARCHAR(100) NOT NULL,
  config_value  VARCHAR(255) NOT NULL,
  updated_by    BIGINT UNSIGNED NULL,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sc_key (config_key),
  CONSTRAINT fk_sc_updater FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE broadcasts (
  id       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title    VARCHAR(255) NOT NULL,
  content  TEXT NOT NULL,
  sent_by  BIGINT UNSIGNED NULL,
  sent_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bc_time (sent_at),
  CONSTRAINT fk_bc_sender FOREIGN KEY (sent_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============ NHÓM B — CACHE TẠM (STORE-AND-FORWARD) ============
-- Bảng DUY NHẤT server chạm "nội dung". PHASE 3: E2E — mỗi dòng là một
-- PHONG BÌ ĐÃ MÃ HÓA cho đúng một recipient_id (kể cả nhóm: 1 dòng/người nhận).
-- Server KHÔNG có private key nên không đọc được nội dung.
-- content_type/envelope_json/media_file_path giữ cho tương thích legacy.
-- Giao thành công → set delivered_at; worker định kỳ xoá bản ghi đã giao
-- (delivered_at IS NOT NULL) hoặc quá hạn (expires_at < NOW()).
CREATE TABLE message_cache (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  client_msg_id    VARCHAR(64) NOT NULL,
  room_id          BIGINT UNSIGNED NOT NULL,
  sender_id        BIGINT UNSIGNED NOT NULL,
  recipient_id     BIGINT UNSIGNED NOT NULL,
  content_type     ENUM('text','voice_short','media_ref') NOT NULL DEFAULT 'text',
  algo             VARCHAR(32)     NULL,      -- nhãn thuật toán phong bì E2E
  iv               VARBINARY(16)   NULL,      -- nonce AES-GCM
  wrapped_key      VARBINARY(1024) NULL,      -- khóa AES bọc RSA-OAEP cho người nhận
  signature        VARBINARY(1024) NULL,      -- chữ ký RSA-PSS của người gửi
  ciphertext       MEDIUMBLOB      NULL,      -- nội dung mã hóa AES-256-GCM
  sent_at          DATETIME        NULL,      -- thời điểm client gửi
  envelope_json    TEXT NULL,
  media_file_path  VARCHAR(500) NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at       DATETIME NOT NULL,
  delivered_at     DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mc_client (client_msg_id, recipient_id),
  KEY idx_mc_recipient (recipient_id, expires_at),
  KEY idx_mc_delivery (delivered_at),
  KEY idx_mc_pending (recipient_id, delivered_at, id),
  CONSTRAINT chk_mc_payload CHECK (
      (envelope_json IS NOT NULL)
      OR (media_file_path IS NOT NULL)
      OR (ciphertext IS NOT NULL AND wrapped_key IS NOT NULL AND iv IS NOT NULL)
  ),
  CONSTRAINT fk_mc_msg FOREIGN KEY (client_msg_id) REFERENCES message_meta(client_msg_id) ON DELETE CASCADE,
  CONSTRAINT fk_mc_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_mc_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_mc_recipient FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============ DỮ LIỆU NỀN ============
INSERT INTO system_config (config_key, config_value) VALUES
  ('max_file_size_mb', '100'),
  ('heartbeat_timeout_sec', '90'),
  ('max_login_attempts', '5'),
  ('message_cache_ttl_days', '7'),
  ('offline_ttl_days', '30'),
  ('offline_mailbox_limit', '500'),
  ('offline_pull_limit', '100'),
  ('offline_max_text_bytes', '4096'),
  ('otp_ttl_minutes', '10'),
  ('session_ttl_days', '30')
ON DUPLICATE KEY UPDATE config_value = config_value;