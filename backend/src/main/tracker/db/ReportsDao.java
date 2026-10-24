package com.workchat.tracker.db;

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
 * Báo cáo vi phạm (bảng reports). LƯU Ý E2E: nội dung tin nhắn bị báo cáo KHÔNG có ở server
 * (chỉ người nhận giải mã được). Admin chỉ thấy metadata + ghi chú bằng chứng do người báo cáo
 * tự cung cấp (evidence_note).
 */
public final class ReportsDao {
    private static final java.util.Set<String> STATUSES =
            java.util.Set.of("pending", "resolved", "dismissed");

    private final DataSource ds;

    public ReportsDao(DataSource ds) {
        this.ds = ds;
    }

    /** Danh sách báo cáo (lọc theo status; null/"all" = mọi trạng thái). */
    public List<Map<String, Object>> list(String status, int limit) throws SQLException {
        if (limit < 1) {
            limit = 1;
        }
        if (limit > 500) {
            limit = 500;
        }
        boolean all = status == null || status.isBlank() || "all".equalsIgnoreCase(status);
        if (!all && !STATUSES.contains(status)) {
            all = true;
        }
        String sql =
                "SELECT r.id, r.reporter_id, ru.username AS reporter, r.target_type, r.target_id, " +
                        "r.reason, r.evidence_note, r.status, r.handled_by, r.handled_at, r.created_at " +
                        "FROM reports r LEFT JOIN users ru ON ru.id = r.reporter_id " +
                        (all ? "" : "WHERE r.status = ? ") +
                        "ORDER BY r.id DESC LIMIT ?";
        List<Map<String, Object>> out = new ArrayList<>();
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(sql)) {
            int i = 1;
            if (!all) {
                p.setString(i++, status);
            }
            p.setInt(i, limit);
            try (ResultSet rs = p.executeQuery()) {
                while (rs.next()) {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", rs.getLong("id"));
                    m.put("reporter_id", rs.getLong("reporter_id"));
                    m.put("reporter", rs.getString("reporter"));
                    m.put("target_type", rs.getString("target_type"));
                    m.put("target_id", rs.getString("target_id"));
                    m.put("reason", rs.getString("reason"));
                    m.put("evidence_note", rs.getString("evidence_note"));
                    m.put("status", rs.getString("status"));
                    long hb = rs.getLong("handled_by");
                    m.put("handled_by", rs.wasNull() ? null : hb);
                    java.sql.Timestamp ha = rs.getTimestamp("handled_at");
                    m.put("handled_at", ha == null ? null : ha.getTime());
                    java.sql.Timestamp cr = rs.getTimestamp("created_at");
                    m.put("created_at", cr == null ? null : cr.getTime());
                    out.add(m);
                }
            }
        }
        return out;
    }

    /** Cập nhật trạng thái xử lý; trả về true nếu có hàng được cập nhật. */
    public boolean setStatus(long reportId, String status, long handledBy) throws SQLException {
        if (!STATUSES.contains(status)) {
            return false;
        }
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "UPDATE reports SET status = ?, handled_by = ?, handled_at = NOW() WHERE id = ?")) {
            p.setString(1, status);
            p.setLong(2, handledBy);
            p.setLong(3, reportId);
            return p.executeUpdate() > 0;
        }
    }

    public long countByStatus(String status) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT COUNT(*) FROM reports WHERE status = ?")) {
            p.setString(1, status);
            try (ResultSet rs = p.executeQuery()) {
                return rs.next() ? rs.getLong(1) : 0L;
            }
        }
    }
}
