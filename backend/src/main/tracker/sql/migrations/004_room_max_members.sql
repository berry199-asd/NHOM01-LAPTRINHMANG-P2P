-- ============================================================
-- WorkChat — Migration 004: giới hạn thành viên mỗi phòng
-- DB thực tế: MariaDB (XAMPP). KHÔNG DROP bảng/dữ liệu, KHÔNG xoá thành viên.
--
-- Mục đích: mặc định max_members = 20 (gồm cả người tạo).
--   * Code đã tự ghi giá trị này khi TẠO phòng mới (phòng nhóm = cấu hình
--     admin max_room_members, phòng 1-1 = 2), nên migration KHÔNG bắt buộc
--     để tính năng chạy. Chạy migration để đồng bộ MẶC ĐỊNH cột và áp trần
--     cho các phòng ĐÃ TỒN TẠI từ trước.
--   * Phòng đang có nhiều hơn 20 thành viên: KHÔNG ai bị đẩy ra; chỉ là
--     không thể thêm thành viên mới cho tới khi xuống dưới ngưỡng.
--
-- BACKUP trước khi chạy:
--   mysqldump -u root workchat > workchat-backup-<yyyyMMdd-HHmmss>.sql
-- ============================================================

USE workchat;

-- 1) Đổi mặc định cột (chỉ ảnh hưởng INSERT không set tường minh max_members).
ALTER TABLE rooms
  MODIFY COLUMN max_members INT NOT NULL DEFAULT 20;

-- 2) Áp trần 20 cho phòng NHÓM đang có; phòng 1-1 đặt lại 2.
UPDATE rooms SET max_members = 20 WHERE is_direct = 0 AND max_members > 20;
UPDATE rooms SET max_members = 2  WHERE is_direct = 1 AND max_members <> 2;
