package com.workchat.tracker.db;

import com.workchat.tracker.common.Json;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Nhật ký hệ thống (system_logs): LOGIN/LOGOUT/LOOKUP/TIMEOUT. Ghi best-effort — lỗi ghi log
 * KHÔNG được làm hỏng luồng nghiệp vụ. Không bao giờ ghi nội dung tin nhắn/chìa/mật khẩu.
 */
public final class SystemLogDao {
    private static final java.util.Set<String> TYPES =
            java.util.Set.of("LOGIN", "LOGOUT", "LOOKUP", "TIMEOUT");

    private final DataSource ds;

    public SystemLogDao(DataSource ds) {
        this.ds = ds;
    }

    /** Ghi một sự kiện; nuốt lỗi (chỉ báo ra stderr) để không ảnh hưởng người dùng. */
    public void log(String type, Long userId, String ip, String detail) {
        if (type == null || !TYPES.contains(type)) {
            return;
        }
        String safeDetail = detail == null ? null : detail.substring(0, Math.min(detail.length(), 500));
        String safeIp = ip == null ? null : ip.substring(0, Math.min(ip.length(), 45));
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "INSERT INTO system_logs (event_type, user_id, ip_address, detail) VALUES (?, ?, ?, ?)")) {
            p.setString(1, type);
            if (userId == null) {
                p.setNull(2, java.sql.Types.BIGINT);
            } else {
                p.setLong(2, userId);
            }
            p.setString(3, safeIp);
            p.setString(4, safeDetail);
            p.executeUpdate();
        } catch (SQLException e) {
            System.err.println("[system_logs] ghi lỗi: " + e.getMessage());
        }
    }

    /** Danh sách sự kiện gần nhất, lọc theo loại (null/"all" = mọi loại). */
    public List<Map<String, Object>> list(String type, int limit) throws SQLException {
        if (limit < 1) {
            limit = 1;
        }
        if (limit > 500) {
            limit = 500;
        }
        boolean all = type == null || type.isBlank() || "all".equalsIgnoreCase(type);
        if (!all && !TYPES.contains(type)) {
            all = true;
        }
        String sql =
                "SELECT l.id, l.event_type, l.user_id, l.ip_address, l.detail, l.created_at, " +
                        "COALESCE(u.username, '') AS username " +
                        "FROM system_logs l LEFT JOIN users u ON u.id = l.user_id " +
                        (all ? "" : "WHERE l.event_type = ? ") +
                        "ORDER BY l.id DESC LIMIT ?";
        List<Map<String, Object>> out = new ArrayList<>();
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(sql)) {
            int idx = 1;
            if (!all) {
                p.setString(idx++, type);
            }
            p.setInt(idx, limit);
            try (ResultSet rs = p.executeQuery()) {
                while (rs.next()) {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", rs.getLong("id"));
                    m.put("type", rs.getString("event_type"));
                    long uid = rs.getLong("user_id");
                    m.put("user_id", rs.wasNull() ? null : uid);
                    m.put("account", rs.getString("username"));
                    m.put("ip", rs.getString("ip_address"));
                    m.put("detail", rs.getString("detail"));
                    java.sql.Timestamp ts = rs.getTimestamp("created_at");
                    m.put("at", ts == null ? null : ts.getTime());
                    out.add(m);
                }
            }
        }
        return out;
    }

    /** Serialize danh sách log sang JSON (tiện cho handler). */
    public static String toJson(List<Map<String, Object>> logs) {
        return Json.write(Map.of("logs", logs));
    }
}
