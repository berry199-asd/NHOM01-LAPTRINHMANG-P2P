package com.workchat.tracker.model;

/** Hàng tài khoản dành cho bảng quản trị (kèm trạng thái khoá + thời điểm tạo/kết nối cuối). */
public record AdminUser(
        long id,
        String username,
        String email,
        String displayName,
        String role,
        boolean locked,
        boolean emailVerified,
        long lastSeenAt
) {
}
