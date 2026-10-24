-- ==============================================================================
-- WORKCHAT: MIGRATION CHO TÍNH NĂNG ĐỔI MÃ E2E BẰNG EMAIL + OTP
-- File: backend/sql/e2e_otp_schema.sql
-- HƯỚNG DẪN: File này CHỈ dùng để duyệt (code review), KHÔNG tự động thực thi.
-- Người quản trị hệ thống chạy thủ công bằng mysql client khi nâng cấp.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- PHẦN 1: UP SCRIPT (ÁP DỤNG MIGRATION)
-- ------------------------------------------------------------------------------

-- 1. Bảng lưu mã OTP đổi khóa E2E (phục vụ mục đích e2e_reset)
-- Hệ thống mặc định có thể tái sử dụng bảng otp_codes hiện có với purpose = 'e2e_reset'.
-- Bảng chuyên biệt này được đề xuất nếu muốn phân tách hoàn toàn với OTP đăng ký/quên mật khẩu.

CREATE TABLE IF NOT EXISTS e2e_reset_otps (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    email VARCHAR(255) NOT NULL,
    code_hash VARCHAR(64) NOT NULL COMMENT 'SHA-256 hash của mã OTP 6 chữ số',
    attempt_count INT NOT NULL DEFAULT 0 COMMENT 'Số lần nhập sai (tối đa 3 lần)',
    expires_at DATETIME NOT NULL COMMENT 'Thời hạn hiệu lực (5 phút)',
    consumed_at DATETIME DEFAULT NULL COMMENT 'Thời điểm vé đã được tiêu thụ (dùng 1 lần)',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_e2e_otps_user_expires (user_id, expires_at),
    INDEX idx_e2e_otps_email_lookup (email, consumed_at, expires_at),
    CONSTRAINT fk_e2e_otps_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Đảm bảo bảng otp_codes hiện có có index tối ưu nếu tiếp tục dùng chung
-- ALTER TABLE otp_codes ADD INDEX IF NOT EXISTS idx_otp_target_purpose (target, purpose, expires_at);

-- ------------------------------------------------------------------------------
-- PHẦN 2: DOWN SCRIPT (ROLLBACK MIGRATION)
-- ------------------------------------------------------------------------------

-- DROP TABLE IF EXISTS e2e_reset_otps;
