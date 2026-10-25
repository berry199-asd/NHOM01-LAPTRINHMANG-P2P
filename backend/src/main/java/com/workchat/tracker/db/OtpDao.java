package com.workchat.tracker.db;

import javax.sql.DataSource;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Optional;

public final class OtpDao {
    private final DataSource ds;

    public OtpDao(DataSource ds) {
        this.ds = ds;
    }

    public static String sha256Hex(String value) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] d = md.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(64);
            for (byte b : d) {
                sb.append(Character.forDigit((b >> 4) & 0xF, 16));
                sb.append(Character.forDigit(b & 0xF, 16));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Vô hiệu hoá các mã cũ chưa dùng của cùng (target, purpose) — resend sẽ thay mã mới. */
    public void revokeActive(String target, String purpose) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "UPDATE otp_codes SET consumed_at = NOW() " +
                             "WHERE target = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > NOW()")) {
            p.setString(1, target);
            p.setString(2, purpose);
            p.executeUpdate();
        }
    }

    public void insert(String target, String purpose, String codeHash, int ttlMinutes) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "INSERT INTO otp_codes (target, purpose, code_hash, expires_at) " +
                             "VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))")) {
            p.setString(1, target);
            p.setString(2, purpose);
            p.setString(3, codeHash);
            p.setInt(4, ttlMinutes);
            p.executeUpdate();
        }
    }

    public Optional<OtpRow> findActive(String target, String purpose) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT id, code_hash, attempt_count FROM otp_codes " +
                             "WHERE target = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > NOW() " +
                             "ORDER BY id DESC LIMIT 1")) {
            p.setString(1, target);
            p.setString(2, purpose);
            try (ResultSet rs = p.executeQuery()) {
                if (!rs.next()) {
                    return Optional.empty();
                }
                return Optional.of(new OtpRow(
                        rs.getLong("id"),
                        rs.getString("code_hash"),
                        rs.getInt("attempt_count")
                ));
            }
        }
    }

    public void markConsumed(long id) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "UPDATE otp_codes SET consumed_at = NOW() WHERE id = ?")) {
            p.setLong(1, id);
            p.executeUpdate();
        }
    }

    public void incrementAttempt(long id) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "UPDATE otp_codes SET attempt_count = attempt_count + 1 WHERE id = ?")) {
            p.setLong(1, id);
            p.executeUpdate();
        }
    }

    public record OtpRow(long id, String codeHash, int attemptCount) {
    }
}