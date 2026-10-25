-- ==============================================================================
-- MIGRATION: 008_e2e_reset_otp_purpose.sql
-- MỤC ĐÍCH: Bổ sung giá trị 'e2e_reset' vào ENUM purpose của bảng otp_codes
--           để hỗ trợ tính năng gửi mã OTP khi đổi/khôi phục mã mở khóa E2E.
-- NGUYÊN TẮC AN TOÀN: CHỈ ALTER/MODIFY CỘT. KHÔNG DROP, KHÔNG MẤT DỮ LIỆU CŨ.
-- ==============================================================================

ALTER TABLE otp_codes
  MODIFY COLUMN purpose ENUM('register','forgot_password','change_email_old','change_email_new','e2e_reset') NOT NULL;
