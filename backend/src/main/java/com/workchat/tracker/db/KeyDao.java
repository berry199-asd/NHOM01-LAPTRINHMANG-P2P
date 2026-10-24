package com.workchat.tracker.db;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Optional;

/**
 * Thư mục khóa công khai RSA của người dùng (phục vụ nhắn tin ngoại tuyến E2E).
 * Server chỉ giữ public key + fingerprint; KHÔNG giữ private key.
 */
public final class KeyDao {

    /** Public key đã đăng ký của một user. */
    public record UserKey(long userId, byte[] der, String fingerprint) {
    }

    private final DataSource ds;

    public KeyDao(DataSource ds) {
        this.ds = ds;
    }

    /** Lấy public key hiện có của user; rỗng nếu user chưa đăng ký khóa. */
    public Optional<UserKey> findPublicKey(long userId) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT public_key, key_fingerprint FROM users WHERE id = ? LIMIT 1")) {
            p.setLong(1, userId);
            try (ResultSet rs = p.executeQuery()) {
                if (!rs.next()) {
                    return Optional.empty();
                }
                byte[] der = rs.getBytes(1);
                if (der == null) {
                    return Optional.empty();
                }
                return Optional.of(new UserKey(userId, der, rs.getString(2)));
            }
        }
    }

    /**
     * Ghi/ghi đè public key cho user.
     * Trả về true nếu đây là khóa mới hoặc fingerprint ĐÃ THAY ĐỔI so với trước
     * (dùng để phát hiện đổi khóa), false nếu giữ nguyên hoặc user không tồn tại.
     */
    public boolean upsertPublicKey(long userId, byte[] der, String fingerprint) throws SQLException {
        try (Connection c = ds.getConnection()) {
            String current = null;
            boolean exists = false;
            try (PreparedStatement q = c.prepareStatement(
                    "SELECT key_fingerprint FROM users WHERE id = ?")) {
                q.setLong(1, userId);
                try (ResultSet rs = q.executeQuery()) {
                    if (rs.next()) {
                        exists = true;
                        current = rs.getString(1);
                    }
                }
            }
            if (!exists) {
                return false;
            }
            try (PreparedStatement u = c.prepareStatement(
                    "UPDATE users SET public_key = ?, key_fingerprint = ? WHERE id = ?")) {
                u.setBytes(1, der);
                u.setString(2, fingerprint);
                u.setLong(3, userId);
                u.executeUpdate();
            }
            return current == null || !current.equalsIgnoreCase(fingerprint);
        }
    }
}
