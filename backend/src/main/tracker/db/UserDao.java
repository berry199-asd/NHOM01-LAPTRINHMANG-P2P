package com.workchat.tracker.db;

import com.workchat.tracker.model.AdminUser;
import com.workchat.tracker.model.Profile;
import com.workchat.tracker.model.User;

import at.favre.lib.crypto.bcrypt.BCrypt;

import javax.sql.DataSource;
import java.security.SecureRandom;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

public final class UserDao {
    private static final String COLUMNS =
            "id, username, email, pass_hash, display_name, role, (email_verified_at IS NOT NULL) AS verified";

    private static final SecureRandom RNG = new SecureRandom();
    private static final char[] HEX = "0123456789abcdef".toCharArray();

    private final DataSource ds;

    public UserDao(DataSource ds) {
        this.ds = ds;
    }

    public boolean dbOk() {
        try (Connection c = ds.getConnection();
             Statement s = c.createStatement();
             ResultSet rs = s.executeQuery("SELECT 1")) {
            return rs.next();
        } catch (SQLException e) {
            return false;
        }
    }

    public boolean usernameExists(String username) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement("SELECT 1 FROM users WHERE username = ? LIMIT 1")) {
            p.setString(1, username);
            try (ResultSet rs = p.executeQuery()) {
                return rs.next();
            }
        }
    }

    public boolean emailExists(String email) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement("SELECT 1 FROM users WHERE email = ? LIMIT 1")) {
            p.setString(1, email);
            try (ResultSet rs = p.executeQuery()) {
                return rs.next();
            }
        }
    }

    public Optional<User> findByEmail(String email) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT " + COLUMNS + " FROM users WHERE email = ? LIMIT 1")) {
            p.setString(1, email);
            try (ResultSet rs = p.executeQuery()) {
                if (!rs.next()) {
                    return Optional.empty();
                }
                return Optional.of(rowUser(rs));
            }
        }
    }

    public Optional<User> findById(long id) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT " + COLUMNS + " FROM users WHERE id = ? LIMIT 1")) {
            p.setLong(1, id);
            try (ResultSet rs = p.executeQuery()) {
                return rs.next() ? Optional.of(rowUser(rs)) : Optional.empty();
            }
        }
    }

    public User insertUser(String username, String email, String passHash, String displayName,
                           String dateOfBirth) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "INSERT INTO users (username, email, pass_hash, display_name, date_of_birth) " +
                             "VALUES (?, ?, ?, ?, ?)",
                     Statement.RETURN_GENERATED_KEYS)) {
            p.setString(1, username);
            p.setString(2, email);
            p.setString(3, passHash);
            p.setString(4, displayName);
            p.setString(5, dateOfBirth);
            p.executeUpdate();
            try (ResultSet k = p.getGeneratedKeys()) {
                k.next();
                return new User(k.getLong(1), username, email, passHash, displayName, "user", false);
            }
        }
    }

    public void updateUnverified(User existing, String username, String passHash,
                                 String displayName, String dateOfBirth) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "UPDATE users SET username = ?, pass_hash = ?, display_name = ?, date_of_birth = ? " +
                             "WHERE id = ? AND email_verified_at IS NULL")) {
            p.setString(1, username);
            p.setString(2, passHash);
            p.setString(3, displayName);
            p.setString(4, dateOfBirth);
            p.setLong(5, existing.id());
            p.executeUpdate();
        }
    }

    public void markEmailVerified(long userId) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "UPDATE users SET email_verified_at = NOW() WHERE id = ?")) {
            p.setLong(1, userId);
            p.executeUpdate();
        }
    }

    public void updatePassword(long userId, String passHash) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "UPDATE users SET pass_hash = ? WHERE id = ?")) {
            p.setString(1, passHash);
            p.setLong(2, userId);
            p.executeUpdate();
        }
    }

    public void updateEmail(long userId, String newEmail) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "UPDATE users SET email = ?, email_verified_at = NOW() WHERE id = ?")) {
            p.setString(1, newEmail);
            p.setLong(2, userId);
            p.executeUpdate();
        }
    }

    public void updateProfile(long userId, String displayName, String bio, String phone,
                              String dateOfBirth, Boolean phonePublic,
                              String avatar, String cover) throws SQLException {
        try (Connection c = ds.getConnection()) {
            try (PreparedStatement p = c.prepareStatement(
                    "UPDATE users SET display_name = COALESCE(?, display_name), " +
                            "bio = COALESCE(NULLIF(?, ''), bio), phone = COALESCE(NULLIF(?, ''), phone), " +
                            "date_of_birth = COALESCE(NULLIF(?, ''), date_of_birth) WHERE id = ?")) {
                p.setString(1, displayName);
                p.setString(2, bio);
                p.setString(3, phone);
                p.setString(4, dateOfBirth);
                p.setLong(5, userId);
                p.executeUpdate();
            }
            if (phonePublic != null) {
                try (PreparedStatement p = c.prepareStatement(
                        "UPDATE users SET show_phone = ? WHERE id = ?")) {
                    p.setBoolean(1, phonePublic);
                    p.setLong(2, userId);
                    p.executeUpdate();
                }
            }
            if (avatar != null) {
                try (PreparedStatement p = c.prepareStatement(
                        "UPDATE users SET avatar_url = NULLIF(?, '') WHERE id = ?")) {
                    p.setString(1, avatar);
                    p.setLong(2, userId);
                    p.executeUpdate();
                }
            }
            if (cover != null) {
                try (PreparedStatement p = c.prepareStatement(
                        "UPDATE users SET cover_url = NULLIF(?, '') WHERE id = ?")) {
                    p.setString(1, cover);
                    p.setLong(2, userId);
                    p.executeUpdate();
                }
            }
        }
    }

    public void revokeSessionsExcept(long userId, String keepToken) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "UPDATE sessions SET revoked_at = NOW() " +
                             "WHERE user_id = ? AND token <> ? AND revoked_at IS NULL")) {
            p.setLong(1, userId);
            p.setString(2, keepToken);
            p.executeUpdate();
        }
    }

    public Optional<Profile> findProfileByToken(String token) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT u.id, u.username, u.email, u.display_name, u.role, " +
                             "(u.email_verified_at IS NOT NULL) AS verified, u.bio, u.phone, " +
                             "u.date_of_birth, u.created_at, u.show_phone, u.avatar_url, u.cover_url " +
                             "FROM sessions s JOIN users u ON u.id = s.user_id " +
                             "WHERE s.token = ? AND s.revoked_at IS NULL AND s.expires_at > NOW() LIMIT 1")) {
            p.setString(1, token);
            try (ResultSet rs = p.executeQuery()) {
                if (!rs.next()) {
                    return Optional.empty();
                }
                return Optional.of(new Profile(
                        rs.getLong("id"),
                        rs.getString("username"),
                        rs.getString("email"),
                        rs.getString("display_name"),
                        rs.getString("role"),
                        rs.getBoolean("verified"),
                        rs.getString("bio"),
                        rs.getString("phone"),
                        rs.getDate("date_of_birth") == null
                                ? null
                                : rs.getDate("date_of_birth").toLocalDate().toString(),
                        rs.getTimestamp("created_at") == null
                                ? null
                                : rs.getTimestamp("created_at").toLocalDateTime().toString(),
                        rs.getBoolean("show_phone"),
                        rs.getString("avatar_url"),
                        rs.getString("cover_url")
                ));
            }
        }
    }

    /** Tạo tài khoản admin (đã verify email) nếu chưa tồn tại — dùng cho dev bootstrap. */
    public void seedAdminIfMissing(String email, String password, String displayName) throws SQLException {
        String lower = email.toLowerCase(Locale.ROOT);
        if (findByEmail(lower).isPresent()) {
            return;
        }
        String hash = BCrypt.withDefaults().hashToString(12, password.toCharArray());
        String username = deriveUsername(lower);
        String base = username;
        for (int i = 1; daoUsernameTaken(username); i++) {
            username = base + (i < 10 ? ".0" + i : "." + i);
            if (i > 50) {
                throw new SQLException("Không thể tạo username admin, hết phương án.");
            }
        }
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "INSERT INTO users (username, email, pass_hash, display_name, email_verified_at, role) " +
                             "VALUES (?, ?, ?, ?, NOW(), 'admin')")) {
            p.setString(1, username);
            p.setString(2, lower);
            p.setString(3, hash);
            p.setString(4, displayName);
            p.executeUpdate();
        }
    }

    private boolean daoUsernameTaken(String username) throws SQLException {
        return usernameExists(username);
    }

    private static String deriveUsername(String email) {
        String local = email.substring(0, email.indexOf('@'));
        String cleaned = local.replaceAll("[^a-z0-9_.\\-]", "");
        if (cleaned.length() < 3) {
            cleaned = "user" + cleaned;
        }
        if (cleaned.length() > 32) {
            cleaned = cleaned.substring(0, 32);
        }
        return cleaned;
    }

    public void revokeSessions(long userId) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "UPDATE sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL")) {
            p.setLong(1, userId);
            p.executeUpdate();
        }
    }

    public Optional<User> findByLogin(String usernameOrEmail) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT " + COLUMNS + " FROM users WHERE username = ? OR email = ? LIMIT 1")) {
            p.setString(1, usernameOrEmail);
            p.setString(2, usernameOrEmail);
            try (ResultSet rs = p.executeQuery()) {
                if (!rs.next()) {
                    return Optional.empty();
                }
                return Optional.of(rowUser(rs));
            }
        }
    }

    public Optional<User> findUserByToken(String token) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT u.id, u.username, u.email, u.pass_hash, u.display_name, u.role, " +
                             "(u.email_verified_at IS NOT NULL) AS verified " +
                             "FROM sessions s JOIN users u ON u.id = s.user_id " +
                             "WHERE s.token = ? AND s.revoked_at IS NULL AND s.expires_at > NOW() LIMIT 1")) {
            p.setString(1, token);
            try (ResultSet rs = p.executeQuery()) {
                if (!rs.next()) {
                    return Optional.empty();
                }
                return Optional.of(rowUser(rs));
            }
        }
    }

    public String createSession(long userId, int ttlDays, String deviceInfo) throws SQLException {
        String token = randomToken(32);
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "INSERT INTO sessions (user_id, token, device_info, expires_at) " +
                             "VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))")) {
            p.setLong(1, userId);
            p.setString(2, token);
            p.setString(3, deviceInfo == null || deviceInfo.isBlank() ? "unknown" : deviceInfo);
            p.setInt(4, ttlDays);
            p.executeUpdate();
            return token;
        }
    }

    public List<User> searchByQuery(String q, int limit) throws SQLException {
        List<User> out = new ArrayList<>();
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT " + COLUMNS + " FROM users " +
                             "WHERE username LIKE ? OR display_name LIKE ? ORDER BY username LIMIT ?")) {
            String like = "%" + q + "%";
            p.setString(1, like);
            p.setString(2, like);
            p.setInt(3, limit);
            try (ResultSet rs = p.executeQuery()) {
                while (rs.next()) {
                    out.add(rowUser(rs));
                }
            }
        }
        return out;
    }

    /** Ghi thời điểm Peer Core còn sống lần cuối (epoch ms) cho một người dùng. */
    public void setLastSeen(long userId, long epochMs) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "UPDATE users SET last_seen_at = ? WHERE id = ?")) {
            p.setLong(1, epochMs);
            p.setLong(2, userId);
            p.executeUpdate();
        }
    }

    /** Ghi last_seen_at cho nhiều người dùng cùng lúc (chu kỳ thưa). */
    public void touchLastSeen(List<Long> userIds, long epochMs) throws SQLException {
        if (userIds == null || userIds.isEmpty()) {
            return;
        }
        StringBuilder sb = new StringBuilder("UPDATE users SET last_seen_at = ? WHERE id IN (");
        for (int i = 0; i < userIds.size(); i++) {
            sb.append(i == 0 ? "?" : ",?");
        }
        sb.append(")");
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(sb.toString())) {
            p.setLong(1, epochMs);
            for (int i = 0; i < userIds.size(); i++) {
                p.setLong(i + 2, userIds.get(i));
            }
            p.executeUpdate();
        }
    }

    public List<AdminUser> listForAdmin(String q, int limit, int offset) throws SQLException {
        if (limit < 1) {
            limit = 1;
        }
        if (limit > 200) {
            limit = 200;
        }
        if (offset < 0) {
            offset = 0;
        }
        String like = "%" + (q == null ? "" : q.trim()) + "%";
        boolean filtered = q != null && !q.isBlank();
        String sql =
                "SELECT id, username, email, display_name, role, is_locked, " +
                        "(email_verified_at IS NOT NULL) AS verified, last_seen_at " +
                        "FROM users " +
                        (filtered ? "WHERE username LIKE ? OR email LIKE ? OR display_name LIKE ? " : "") +
                        "ORDER BY id DESC LIMIT ? OFFSET ?";
        List<AdminUser> out = new ArrayList<>();
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(sql)) {
            int i = 1;
            if (filtered) {
                p.setString(i++, like);
                p.setString(i++, like);
                p.setString(i++, like);
            }
            p.setInt(i++, limit);
            p.setInt(i, offset);
            try (ResultSet rs = p.executeQuery()) {
                while (rs.next()) {
                    out.add(new AdminUser(
                            rs.getLong("id"),
                            rs.getString("username"),
                            rs.getString("email"),
                            rs.getString("display_name"),
                            rs.getString("role"),
                            rs.getBoolean("is_locked"),
                            rs.getBoolean("verified"),
                            rs.getLong("last_seen_at")
                    ));
                }
            }
        }
        return out;
    }

    /** Đặt trạng thái khoá; trả về true nếu có hàng được cập nhật. */
    public boolean setLocked(long userId, boolean locked) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "UPDATE users SET is_locked = ? WHERE id = ?")) {
            p.setBoolean(1, locked);
            p.setLong(2, userId);
            return p.executeUpdate() > 0;
        }
    }

    public boolean isLocked(long userId) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT is_locked FROM users WHERE id = ? LIMIT 1")) {
            p.setLong(1, userId);
            try (ResultSet rs = p.executeQuery()) {
                return rs.next() && rs.getBoolean("is_locked");
            }
        }
    }

    /** Đổi vai trò (user/moderator/admin). Trả về true nếu cập nhật được. */
    public boolean setRole(long userId, String role) throws SQLException {
        if (!"user".equals(role) && !"moderator".equals(role) && !"admin".equals(role)) {
            return false;
        }
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "UPDATE users SET role = ? WHERE id = ?")) {
            p.setString(1, role);
            p.setLong(2, userId);
            return p.executeUpdate() > 0;
        }
    }

    /** Tổng số tài khoản (cho thống kê admin). */
    public long countUsers() throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement("SELECT COUNT(*) FROM users");
             ResultSet rs = p.executeQuery()) {
            return rs.next() ? rs.getLong(1) : 0L;
        }
    }

    private static User rowUser(ResultSet rs) throws SQLException {
        return new User(
                rs.getLong("id"),
                rs.getString("username"),
                rs.getString("email"),
                rs.getString("pass_hash"),
                rs.getString("display_name"),
                rs.getString("role"),
                rs.getBoolean("verified")
        );
    }

    private static String randomToken(int bytes) {
        byte[] b = new byte[bytes];
        RNG.nextBytes(b);
        StringBuilder sb = new StringBuilder(bytes * 2);
        for (byte x : b) {
            int v = x & 0xFF;
            sb.append(HEX[v >>> 4]).append(HEX[v & 0x0F]);
        }
        return sb.toString();
    }
}