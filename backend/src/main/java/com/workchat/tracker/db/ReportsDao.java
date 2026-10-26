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
        ensureTable();
    }

    private void ensureTable() {
        String sql = "CREATE TABLE IF NOT EXISTS reports (" +
                "  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT," +
                "  reporter_id BIGINT UNSIGNED NOT NULL," +
                "  target_type ENUM('user','room','message') NOT NULL," +
                "  target_id VARCHAR(64) NOT NULL," +
                "  reason VARCHAR(255) NOT NULL," +
                "  evidence_note TEXT NULL," +
                "  status ENUM('pending','resolved','dismissed') NOT NULL DEFAULT 'pending'," +
                "  handled_by BIGINT UNSIGNED NULL," +
                "  handled_at DATETIME NULL," +
                "  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP," +
                "  PRIMARY KEY (id)," +
                "  KEY idx_rpt_status (status, created_at)," +
                "  KEY idx_rpt_target (target_type, target_id)" +
                ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;";
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(sql)) {
            p.execute();
        } catch (Exception e) {
            System.err.println("[tracker-reports] Khởi tạo bảng reports: " + e.getMessage());
        }
    }

    /** Tạo báo cáo vi phạm mới từ người dùng. Trả về ID vừa tạo. */
    public long create(long reporterId, String targetType, String targetId, String reason, String evidenceNote) throws SQLException {
        String sql = "INSERT INTO reports (reporter_id, target_type, target_id, reason, evidence_note, status, created_at) " +
                "VALUES (?, ?, ?, ?, ?, 'pending', NOW())";
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(sql, PreparedStatement.RETURN_GENERATED_KEYS)) {
            p.setLong(1, reporterId);
            p.setString(2, targetType);
            p.setString(3, targetId);
            p.setString(4, (reason != null && !reason.isBlank()) ? reason.trim() : "Báo cáo vi phạm");
            p.setString(5, (evidenceNote != null && !evidenceNote.isBlank()) ? evidenceNote.trim() : null);
            p.executeUpdate();
            try (ResultSet rs = p.getGeneratedKeys()) {
                if (rs.next()) {
                    return rs.getLong(1);
                }
            }
        }
        return 0L;
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
