package com.workchat.tracker.db;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Thông báo hệ thống (bảng broadcasts): admin gửi tới người dùng đang online. */
public final class BroadcastDao {
    private final DataSource ds;

    public BroadcastDao(DataSource ds) {
        this.ds = ds;
    }

    /** Lưu một thông báo; trả về id vừa tạo (0 nếu lỗi). */
    public long insert(String title, String content, Long sentBy) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "INSERT INTO broadcasts (title, content, sent_by) VALUES (?, ?, ?)",
                     Statement.RETURN_GENERATED_KEYS)) {
            p.setString(1, title);
            p.setString(2, content);
            if (sentBy == null) {
                p.setNull(3, java.sql.Types.BIGINT);
            } else {
                p.setLong(3, sentBy);
            }
            p.executeUpdate();
            try (ResultSet rs = p.getGeneratedKeys()) {
                return rs.next() ? rs.getLong(1) : 0L;
            }
        }
    }

    public List<Map<String, Object>> list(int limit) throws SQLException {
        if (limit < 1) {
            limit = 1;
        }
        if (limit > 200) {
            limit = 200;
        }
        List<Map<String, Object>> out = new ArrayList<>();
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT b.id, b.title, b.content, b.sent_by, u.username AS sender, b.sent_at " +
                             "FROM broadcasts b LEFT JOIN users u ON u.id = b.sent_by " +
                             "ORDER BY b.id DESC LIMIT ?")) {
            p.setInt(1, limit);
            try (ResultSet rs = p.executeQuery()) {
                while (rs.next()) {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", rs.getLong("id"));
                    m.put("title", rs.getString("title"));
                    m.put("content", rs.getString("content"));
                    long sb = rs.getLong("sent_by");
                    m.put("sent_by", rs.wasNull() ? null : sb);
                    m.put("sender", rs.getString("sender"));
                    java.sql.Timestamp ts = rs.getTimestamp("sent_at");
                    m.put("sent_at", ts == null ? null : ts.getTime());
                    out.add(m);
                }
            }
        }
        return out;
    }
}
