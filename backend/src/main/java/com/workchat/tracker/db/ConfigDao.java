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

/** Đọc/ghi cấu hình hệ thống (bảng system_config) dạng key/value. */
public final class ConfigDao {
    private final DataSource ds;

    public ConfigDao(DataSource ds) {
        this.ds = ds;
    }

    /** Trả giá trị thô hoặc null nếu thiếu. */
    public String get(String key) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT config_value FROM system_config WHERE config_key = ? LIMIT 1")) {
            p.setString(1, key);
            try (ResultSet rs = p.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        }
    }

    /** Đọc số nguyên, trả về mặc định khi thiếu hoặc không hợp lệ. */
    public int getInt(String key, int dflt) {
        try {
            String v = get(key);
            return v == null ? dflt : Integer.parseInt(v.trim());
        } catch (Exception e) {
            return dflt;
        }
    }

    /** Toàn bộ cặp key/value theo thứ tự tên khoá. */
    public List<Map<String, String>> listAll() throws SQLException {
        List<Map<String, String>> out = new ArrayList<>();
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT config_key, config_value FROM system_config ORDER BY config_key")) {
            try (ResultSet rs = p.executeQuery()) {
                while (rs.next()) {
                    Map<String, String> m = new LinkedHashMap<>();
                    m.put("key", rs.getString("config_key"));
                    m.put("value", rs.getString("config_value"));
                    out.add(m);
                }
            }
        }
        return out;
    }

    /** Ghi (upsert) một khoá cấu hình; trả về true nếu có thay đổi. */
    public boolean set(String key, String value, Long updatedBy) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "INSERT INTO system_config (config_key, config_value, updated_by) VALUES (?, ?, ?) " +
                             "ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_by = VALUES(updated_by)")) {
            p.setString(1, key);
            p.setString(2, value);
            if (updatedBy == null) {
                p.setNull(3, java.sql.Types.BIGINT);
            } else {
                p.setLong(3, updatedBy);
            }
            return p.executeUpdate() > 0;
        }
    }
}

