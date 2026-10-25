-- ==============================================================================
-- MIGRATION: 007_group_permissions.sql
-- MỤC ĐÍCH: Bổ sung phân quyền nhóm (owner, admin, member), cài đặt nhóm,
--           danh sách chặn và phê duyệt thành viên mới (join requests).
-- NGUYÊN TẮC AN TOÀN: CHỈ ALTER/ADD hoặc CREATE TABLE IF NOT EXISTS.
--                     KHÔNG DROP TABLE, KHÔNG XOÁ DỮ LIỆU CŨ.
-- ==============================================================================

-- 1. CẬP NHẬT CỘT room_role TRONG BẢNG room_members ĐỂ HỖ TRỢ 'owner', 'admin', 'member'
-- (Giữ tương thích ngược với 'leader' hiện tại trước khi chuyển đổi)
ALTER TABLE room_members
  MODIFY COLUMN room_role ENUM('member','leader','owner','admin') NOT NULL DEFAULT 'member';

-- Cập nhật tất cả 'leader' hiện có thành 'owner' (Trưởng nhóm)
UPDATE room_members
SET room_role = 'owner'
WHERE room_role = 'leader';

-- Thu hẹp lại ENUM chuẩn: 'member', 'admin', 'owner'
ALTER TABLE room_members
  MODIFY COLUMN room_role ENUM('member','admin','owner') NOT NULL DEFAULT 'member';

-- Đảm bảo mỗi nhóm đều có owner từ bảng rooms.created_by nếu chưa có owner nào
UPDATE room_members rm
JOIN rooms r ON rm.room_id = r.id AND rm.user_id = r.created_by
SET rm.room_role = 'owner'
WHERE r.is_direct = FALSE
  AND NOT EXISTS (
    SELECT 1 FROM (SELECT * FROM room_members) rm2
    WHERE rm2.room_id = r.id AND rm2.room_role = 'owner' AND rm2.left_at IS NULL
  );

-- 2. TẠO BẢNG CÀI ĐẶT NHÓM (room_settings)
CREATE TABLE IF NOT EXISTS room_settings (
  room_id                       BIGINT UNSIGNED NOT NULL,
  allow_member_edit_info        BOOLEAN NOT NULL DEFAULT TRUE,       -- Đổi tên & ảnh
  allow_member_pin              BOOLEAN NOT NULL DEFAULT TRUE,       -- Ghim tin nhắn, ghi chú, bình chọn (cờ lưu trữ)
  allow_member_notes_reminders  BOOLEAN NOT NULL DEFAULT TRUE,       -- Tạo mới ghi chú, nhắc hẹn (cờ lưu trữ)
  allow_member_polls            BOOLEAN NOT NULL DEFAULT TRUE,       -- Tạo mới bình chọn (cờ lưu trữ)
  allow_member_send             BOOLEAN NOT NULL DEFAULT TRUE,       -- Gửi tin nhắn
  require_join_approval         BOOLEAN NOT NULL DEFAULT FALSE,      -- Chế độ phê duyệt thành viên mới
  highlight_admin_messages      BOOLEAN NOT NULL DEFAULT TRUE,       -- Đánh dấu tin nhắn từ trưởng/phó nhóm
  new_member_read_recent        BOOLEAN NOT NULL DEFAULT TRUE,       -- Cho phép thành viên mới đọc tin gần nhất
  join_link_enabled             BOOLEAN NOT NULL DEFAULT FALSE,      -- Cho phép dùng link tham gia nhóm
  join_token                    VARCHAR(64) NULL,                    -- Token ngẫu nhiên cho link tham gia
  updated_at                    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (room_id),
  CONSTRAINT fk_rs_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. TẠO BẢNG PHÊ DUYỆT THÀNH VIÊN (join_requests)
CREATE TABLE IF NOT EXISTS join_requests (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  room_id       BIGINT UNSIGNED NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  invited_by    BIGINT UNSIGNED NULL,                                -- NULL nếu vào qua link
  via           ENUM('invite','link') NOT NULL DEFAULT 'invite',
  status        ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_by    BIGINT UNSIGNED NULL,
  decided_at    DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_jr_room_status (room_id, status),
  KEY idx_jr_user (user_id),
  CONSTRAINT fk_jr_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_jr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_jr_inviter FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_jr_decider FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. TẠO BẢNG CHẶN KHỎI NHÓM (room_blocks)
CREATE TABLE IF NOT EXISTS room_blocks (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  room_id       BIGINT UNSIGNED NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  blocked_by    BIGINT UNSIGNED NOT NULL,
  reason        VARCHAR(255) NULL,
  blocked_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rb_room_user (room_id, user_id),
  KEY idx_rb_user (user_id),
  CONSTRAINT fk_rb_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_rb_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_rb_blocker FOREIGN KEY (blocked_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
