-- Migration 006: Them cac khoa cau hinh gioi han truyen tep vao bang system_config
-- DANH CHO NGUOI DUNG DUYET - KHONG TU DONG CHAY

INSERT INTO system_config (config_key, config_value) VALUES
  ('max_image_mb', '10'),
  ('max_file_mb_direct', '25'),
  ('max_file_mb_blob', '10'),
  ('max_files_per_message', '5'),
  ('user_blob_quota_mb', '200'),
  ('blob_ttl_days', '7')
ON DUPLICATE KEY UPDATE config_value = config_value;
