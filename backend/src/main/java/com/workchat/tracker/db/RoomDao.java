package com.workchat.tracker.db;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.SQLIntegrityConstraintViolationException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

public final class RoomDao {
    private final DataSource ds;

    public RoomDao(DataSource ds) {
        this.ds = ds;
        try (Connection c = ds.getConnection();
             Statement st = c.createStatement()) {
            st.executeUpdate("ALTER TABLE rooms MODIFY background_url MEDIUMTEXT");
        } catch (Exception ignored) {}
        initGroupTables();
    }

    private void initGroupTables() {
        try (Connection c = ds.getConnection();
             Statement st = c.createStatement()) {
            try {
                st.executeUpdate("ALTER TABLE room_members MODIFY COLUMN room_role ENUM('member','admin','owner','leader') NOT NULL DEFAULT 'member'");
            } catch (Exception ignored) {}
            try {
                st.executeUpdate("CREATE TABLE IF NOT EXISTS room_settings (" +
                        "room_id BIGINT UNSIGNED NOT NULL, " +
                        "allow_member_edit_info BOOLEAN NOT NULL DEFAULT TRUE, " +
                        "allow_member_pin BOOLEAN NOT NULL DEFAULT TRUE, " +
                        "allow_member_notes_reminders BOOLEAN NOT NULL DEFAULT TRUE, " +
                        "allow_member_polls BOOLEAN NOT NULL DEFAULT TRUE, " +
                        "allow_member_send BOOLEAN NOT NULL DEFAULT TRUE, " +
                        "require_join_approval BOOLEAN NOT NULL DEFAULT FALSE, " +
                        "highlight_admin_messages BOOLEAN NOT NULL DEFAULT TRUE, " +
                        "new_member_read_recent BOOLEAN NOT NULL DEFAULT TRUE, " +
                        "join_link_enabled BOOLEAN NOT NULL DEFAULT FALSE, " +
                        "join_token VARCHAR(64) NULL, " +
                        "updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, " +
                        "PRIMARY KEY (room_id)" +
                        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
            } catch (Exception ignored) {}
            try {
                st.executeUpdate("CREATE TABLE IF NOT EXISTS join_requests (" +
                        "id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, " +
                        "room_id BIGINT UNSIGNED NOT NULL, " +
                        "user_id BIGINT UNSIGNED NOT NULL, " +
                        "invited_by BIGINT UNSIGNED NULL, " +
                        "via ENUM('invite','link') NOT NULL DEFAULT 'invite', " +
                        "status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending', " +
                        "created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, " +
                        "decided_by BIGINT UNSIGNED NULL, " +
                        "decided_at DATETIME NULL, " +
                        "PRIMARY KEY (id), " +
                        "KEY idx_jr_room_status (room_id, status)" +
                        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
            } catch (Exception ignored) {}
            try {
                st.executeUpdate("CREATE TABLE IF NOT EXISTS room_blocks (" +
                        "id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, " +
                        "room_id BIGINT UNSIGNED NOT NULL, " +
                        "user_id BIGINT UNSIGNED NOT NULL, " +
                        "blocked_by BIGINT UNSIGNED NOT NULL, " +
                        "reason VARCHAR(255) NULL, " +
                        "blocked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, " +
                        "PRIMARY KEY (id), " +
                        "UNIQUE KEY uq_rb_room_user (room_id, user_id)" +
                        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
            } catch (Exception ignored) {}
        } catch (Exception ignored) {}
    }

    public record RoomSettings(
            long roomId,
            boolean allowMemberEditInfo,
            boolean allowMemberPin,
            boolean allowMemberNotesReminders,
            boolean allowMemberPolls,
            boolean allowMemberSend,
            boolean requireJoinApproval,
            boolean highlightAdminMessages,
            boolean newMemberReadRecent,
            boolean joinLinkEnabled,
            String joinToken
    ) {
        public static RoomSettings defaults(long roomId) {
            return new RoomSettings(
                    roomId,
                    true,  // allowMemberEditInfo
                    true,  // allowMemberPin
                    true,  // allowMemberNotesReminders
                    true,  // allowMemberPolls
                    true,  // allowMemberSend
                    false, // requireJoinApproval
                    true,  // highlightAdminMessages
                    true,  // newMemberReadRecent
                    false, // joinLinkEnabled
                    null
            );
        }

        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("room_id", roomId);
            m.put("allow_member_edit_info", allowMemberEditInfo);
            m.put("allow_member_pin", allowMemberPin);
            m.put("allow_member_notes_reminders", allowMemberNotesReminders);
            m.put("allow_member_polls", allowMemberPolls);
            m.put("allow_member_send", allowMemberSend);
            m.put("require_join_approval", requireJoinApproval);
            m.put("highlight_admin_messages", highlightAdminMessages);
            m.put("new_member_read_recent", newMemberReadRecent);
            m.put("join_link_enabled", joinLinkEnabled);
            m.put("join_token", joinToken == null ? "" : joinToken);
            return m;
        }
    }

    public record JoinRequestRow(
            long id,
            long roomId,
            long userId,
            String username,
            String displayName,
            String avatarUrl,
            Long invitedBy,
            String inviterName,
            String via,
            String status,
            long createdAtMs,
            Long decidedBy,
            Long decidedAtMs
    ) {
        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", id);
            m.put("room_id", roomId);
            m.put("user_id", userId);
            m.put("username", username);
            m.put("display_name", displayName != null && !displayName.isBlank() ? displayName : username);
            m.put("avatar", avatarUrl == null ? "" : avatarUrl);
            m.put("invited_by", invitedBy);
            m.put("inviter_name", inviterName == null ? "" : inviterName);
            m.put("via", via);
            m.put("status", status);
            m.put("created_at", createdAtMs);
            m.put("decided_by", decidedBy);
            m.put("decided_at", decidedAtMs);
            return m;
        }
    }

    public record BlockRow(
            long id,
            long roomId,
            long userId,
            String username,
            String displayName,
            String avatarUrl,
            long blockedBy,
            String blockerName,
            String reason,
            long blockedAtMs
    ) {
        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", id);
            m.put("room_id", roomId);
            m.put("user_id", userId);
            m.put("username", username);
            m.put("display_name", displayName != null && !displayName.isBlank() ? displayName : username);
            m.put("avatar", avatarUrl == null ? "" : avatarUrl);
            m.put("blocked_by", blockedBy);
            m.put("blocker_name", blockerName == null ? "" : blockerName);
            m.put("reason", reason == null ? "" : reason);
            m.put("blocked_at", blockedAtMs);
            return m;
        }
    }

    public record RoomRow(
            long id,
            boolean isDirect,
            String name,
            String avatarUrl,
            String backgroundUrl,
            String themeColor,
            String defaultReactionEmoji,
            Long memberAId,
            Long memberBId,
            Long createdBy,
            long createdAtMs
    ) {
    }

    public record MemberRow(
            long userId,
            String publicId,
            String username,
            String displayName,
            String avatarUrl,
            String role,
            String lastReadMessageId,
            String joinedAtMs,
            long lastSeenAtMs
    ) {
    }

    private static final String ROOM_SELECT =
            "SELECT id, is_direct, name, avatar_url, background_url, theme_color, " +
                    "default_reaction_emoji, member_a_id, member_b_id, created_by, " +
                    "(UNIX_TIMESTAMP(created_at) * 1000) AS created_ms FROM rooms ";

    public Optional<RoomRow> findRoom(long roomId) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(ROOM_SELECT + "WHERE id = ?")) {
            p.setLong(1, roomId);
            try (ResultSet rs = p.executeQuery()) {
                if (!rs.next()) {
                    return Optional.empty();
                }
                return Optional.of(rowRoom(rs));
            }
        }
    }

    public Optional<RoomRow> findDirectRoom(long a, long b) throws SQLException {
        long lo = Math.min(a, b);
        long hi = Math.max(a, b);
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     ROOM_SELECT + "WHERE is_direct = 1 AND member_a_id = ? AND member_b_id = ?")) {
            p.setLong(1, lo);
            p.setLong(2, hi);
            try (ResultSet rs = p.executeQuery()) {
                if (!rs.next()) {
                    return Optional.empty();
                }
                return Optional.of(rowRoom(rs));
            }
        }
    }

    /** Phòng 1-1: thêm member_a/b (khi not-found thì tự thêm). Trả room id đã có hoặc mới tạo. */
    public long createDirectRoom(long creator, long other) throws SQLException {
        long lo = Math.min(creator, other);
        long hi = Math.max(creator, other);
        try (Connection c = ds.getConnection()) {
            c.setAutoCommit(false);
            try {
                long roomId;
                try (PreparedStatement p = c.prepareStatement(
                        "INSERT INTO rooms (is_direct, member_a_id, member_b_id, max_members, created_by) VALUES (1, ?, ?, 2, ?)",
                        Statement.RETURN_GENERATED_KEYS)) {
                    p.setLong(1, lo);
                    p.setLong(2, hi);
                    p.setLong(3, creator);
                    p.executeUpdate();
                    try (ResultSet k = p.getGeneratedKeys()) {
                        k.next();
                        roomId = k.getLong(1);
                    }
                }
                addMemberTx(c, roomId, lo, "member");
                addMemberTx(c, roomId, hi, "member");
                c.commit();
                return roomId;
            } catch (SQLException e) {
                c.rollback();
                throw e;
            } finally {
                c.setAutoCommit(true);
            }
        }
    }

    /**
     * Phòng 1-1 idempotent (chống race): trả phòng đã có nếu tồn tại, ngược lại tạo mới.
     * Nếu hai luồng cùng tạo, một luồng dính lỗi UNIQUE (uq_rooms_direct) → đọc lại phòng vừa có.
     */
    public long createOrGetDirectRoom(long creator, long other) throws SQLException {
        long lo = Math.min(creator, other);
        long hi = Math.max(creator, other);
        Optional<RoomRow> existing = findDirectRoom(lo, hi);
        if (existing.isPresent()) {
            return existing.get().id();
        }
        try {
            return createDirectRoom(creator, other);
        } catch (SQLIntegrityConstraintViolationException dup) {
            return findDirectRoom(lo, hi).map(RoomRow::id).orElseThrow(() -> dup);
        }
    }

    /**
     * Bảo đảm phòng 1-1 tồn tại NGAY TRONG transaction của caller (dùng khi vừa kết bạn).
     * Trả về room id đã có hoặc vừa tạo — atomic với việc ghi friendship.
     */
    public static long ensureDirectRoomTx(Connection c, long creator, long other) throws SQLException {
        long lo = Math.min(creator, other);
        long hi = Math.max(creator, other);
        try (PreparedStatement p = c.prepareStatement(
                "SELECT id FROM rooms WHERE is_direct = 1 AND member_a_id = ? AND member_b_id = ? LIMIT 1")) {
            p.setLong(1, lo);
            p.setLong(2, hi);
            try (ResultSet rs = p.executeQuery()) {
                if (rs.next()) {
                    return rs.getLong(1);
                }
            }
        }
        long roomId;
        try (PreparedStatement p = c.prepareStatement(
                "INSERT INTO rooms (is_direct, member_a_id, member_b_id, max_members, created_by) VALUES (1, ?, ?, 2, ?)",
                Statement.RETURN_GENERATED_KEYS)) {
            p.setLong(1, lo);
            p.setLong(2, hi);
            p.setLong(3, creator);
            p.executeUpdate();
            try (ResultSet k = p.getGeneratedKeys()) {
                k.next();
                roomId = k.getLong(1);
            }
        } catch (SQLIntegrityConstraintViolationException dup) {
            // Race: transaction khác đã tạo phòng 1-1 cho cùng cặp → dùng lại phòng đó.
            try (PreparedStatement p = c.prepareStatement(
                    "SELECT id FROM rooms WHERE is_direct = 1 AND member_a_id = ? AND member_b_id = ? LIMIT 1")) {
                p.setLong(1, lo);
                p.setLong(2, hi);
                try (ResultSet rs = p.executeQuery()) {
                    if (rs.next()) {
                        return rs.getLong(1);
                    }
                }
            }
            throw dup;
        }
        addMemberTx(c, roomId, lo, "member");
        addMemberTx(c, roomId, hi, "member");
        return roomId;
    }

    public long createGroupRoom(String name, String avatarUrl, long createdBy, List<Long> memberIds, int maxMembers)
            throws SQLException {
        try (Connection c = ds.getConnection()) {
            c.setAutoCommit(false);
            try {
                long roomId;
                try (PreparedStatement p = c.prepareStatement(
                        "INSERT INTO rooms (is_direct, name, avatar_url, max_members, created_by) VALUES (0, ?, ?, ?, ?)",
                        Statement.RETURN_GENERATED_KEYS)) {
                    p.setString(1, name);
                    p.setString(2, avatarUrl);
                    p.setInt(3, maxMembers);
                    p.setLong(4, createdBy);
                    p.executeUpdate();
                    try (ResultSet k = p.getGeneratedKeys()) {
                        k.next();
                        roomId = k.getLong(1);
                    }
                }
                addMemberTx(c, roomId, createdBy, "owner");
                for (long u : memberIds) {
                    addMemberTx(c, roomId, u, "member");
                }
                try (PreparedStatement ps = c.prepareStatement(
                        "INSERT INTO room_settings (room_id) VALUES (?) ON DUPLICATE KEY UPDATE room_id = room_id")) {
                    ps.setLong(1, roomId);
                    ps.executeUpdate();
                } catch (Exception ignored) {}
                c.commit();
                return roomId;
            } catch (SQLException e) {
                c.rollback();
                throw e;
            } finally {
                c.setAutoCommit(true);
            }
        }
    }

    public static void addMemberTx(Connection c, long roomId, long userId, String role) throws SQLException {
        try (PreparedStatement p = c.prepareStatement(
                "INSERT INTO room_members (room_id, user_id, room_role) VALUES (?, ?, ?) " +
                        "ON DUPLICATE KEY UPDATE left_at = NULL, banned_at = NULL, room_role = VALUES(room_role)")) {
            p.setLong(1, roomId);
            p.setLong(2, userId);
            p.setString(3, role);
            p.executeUpdate();
        }
    }

    public void addOrRestoreMember(long roomId, long userId, String role) throws SQLException {
        try (Connection c = ds.getConnection()) {
            addMemberTx(c, roomId, userId, role);
        }
    }

    public List<RoomRow> roomsOf(long userId) throws SQLException {
        List<RoomRow> out = new ArrayList<>();
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     ROOM_SELECT + "WHERE id IN (SELECT room_id FROM room_members " +
                             "WHERE user_id = ? AND left_at IS NULL AND banned_at IS NULL) " +
                             "ORDER BY id")) {
            p.setLong(1, userId);
            try (ResultSet rs = p.executeQuery()) {
                while (rs.next()) {
                    out.add(rowRoom(rs));
                }
            }
        }
        return out;
    }

    public List<MemberRow> members(long roomId) throws SQLException {
        List<MemberRow> out = new ArrayList<>();
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT u.id, COALESCE(u.public_id, u.username) AS public_id, u.username, u.display_name, u.avatar_url, rm.room_role, " +
                             "rm.last_read_message_id, (UNIX_TIMESTAMP(rm.joined_at) * 1000) AS joined_ms, " +
                             "COALESCE(u.last_seen_at, 0) AS last_seen_ms " +
                             "FROM room_members rm JOIN users u ON u.id = rm.user_id " +
                             "WHERE rm.room_id = ? AND rm.left_at IS NULL AND rm.banned_at IS NULL " +
                             "ORDER BY rm.joined_at, u.id")) {
            p.setLong(1, roomId);
            try (ResultSet rs = p.executeQuery()) {
                while (rs.next()) {
                    out.add(rowMember(rs));
                }
            }
        }
        return out;
    }

    public void updateRoom(long roomId, String name, String avatarUrl, String themeColor,
                           String defaultEmoji, String backgroundUrl) throws SQLException {
        StringBuilder sql = new StringBuilder("UPDATE rooms SET ");
        List<Object> params = new ArrayList<>();
        if (name != null) {
            sql.append("name = ?, ");
            params.add(name);
        }
        if (avatarUrl != null) {
            if (avatarUrl.isEmpty() || "null".equalsIgnoreCase(avatarUrl)) {
                sql.append("avatar_url = NULL, ");
            } else {
                sql.append("avatar_url = ?, ");
                params.add(avatarUrl);
            }
        }
        if (themeColor != null) {
            sql.append("theme_color = ?, ");
            params.add(themeColor);
        }
        if (defaultEmoji != null) {
            sql.append("default_reaction_emoji = ?, ");
            params.add(defaultEmoji);
        }
        if (backgroundUrl != null) {
            if (backgroundUrl.isEmpty() || "null".equalsIgnoreCase(backgroundUrl)) {
                sql.append("background_url = NULL, ");
            } else {
                sql.append("background_url = ?, ");
                params.add(backgroundUrl);
            }
        }
        if (params.isEmpty()) {
            return;
        }
        sql.setLength(sql.length() - 2);
        sql.append(" WHERE id = ?");
        params.add(roomId);

        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(sql.toString())) {
            for (int i = 0; i < params.size(); i++) {
                p.setObject(i + 1, params.get(i));
            }
            p.executeUpdate();
        }
    }

    public boolean removeMember(long roomId, long userId) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "UPDATE room_members SET left_at = CURRENT_TIMESTAMP WHERE room_id = ? AND user_id = ? AND left_at IS NULL")) {
            p.setLong(1, roomId);
            p.setLong(2, userId);
            return p.executeUpdate() > 0;
        }
    }

    public boolean updateMemberRole(long roomId, long userId, String role) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "UPDATE room_members SET room_role = ? WHERE room_id = ? AND user_id = ? AND left_at IS NULL")) {
            p.setString(1, role);
            p.setLong(2, roomId);
            p.setLong(3, userId);
            return p.executeUpdate() > 0;
        }
    }

        public boolean setSingleLeader(long roomId, long newLeaderUserId) throws SQLException {
        try (Connection c = ds.getConnection()) {
            c.setAutoCommit(false);
            try {
                try (PreparedStatement p1 = c.prepareStatement(
                        "UPDATE room_members SET room_role = 'member' WHERE room_id = ? AND room_role = 'leader'")) {
                    p1.setLong(1, roomId);
                    p1.executeUpdate();
                }
                try (PreparedStatement p2 = c.prepareStatement(
                        "UPDATE room_members SET room_role = 'leader' WHERE room_id = ? AND user_id = ? AND left_at IS NULL")) {
                    p2.setLong(1, roomId);
                    p2.setLong(2, newLeaderUserId);
                    int updated = p2.executeUpdate();
                    if (updated == 0) {
                        c.rollback();
                        return false;
                    }
                }
                try (PreparedStatement p3 = c.prepareStatement(
                        "UPDATE rooms SET created_by = ? WHERE id = ?")) {
                    p3.setLong(1, newLeaderUserId);
                    p3.setLong(2, roomId);
                    p3.executeUpdate();
                }
                c.commit();
                return true;
            } catch (SQLException e) {
                c.rollback();
                throw e;
            } finally {
                c.setAutoCommit(true);
            }
        }
    }

    public boolean updateNickname(long roomId, long userId, String nickname) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "UPDATE room_members SET nickname = ? WHERE room_id = ? AND user_id = ? AND left_at IS NULL")) {
            p.setString(1, nickname);
            p.setLong(2, roomId);
            p.setLong(3, userId);
            return p.executeUpdate() > 0;
        }
    }

    /** Kiểm tra + trả danh sách user thật theo id (chỉ lấy cột hiển thị). */
    public Set<Long> existingUserIds(List<Long> ids) throws SQLException {
        Set<Long> found = new LinkedHashSet<>();
        if (ids.isEmpty()) {
            return found;
        }
        StringBuilder sb = new StringBuilder("SELECT id FROM users WHERE id IN (");
        for (int i = 0; i < ids.size(); i++) {
            if (i > 0) {
                sb.append(",");
            }
            sb.append("?");
        }
        sb.append(")");
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(sb.toString())) {
            for (int i = 0; i < ids.size(); i++) {
                p.setLong(i + 1, ids.get(i));
            }
            try (ResultSet rs = p.executeQuery()) {
                while (rs.next()) {
                    found.add(rs.getLong(1));
                }
            }
        }
        return found;
    }

    public Optional<Long> lastMessageAtMs(long roomId) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT (UNIX_TIMESTAMP(MAX(sent_at)) * 1000) AS last_ms FROM message_meta WHERE room_id = ?")) {
            p.setLong(1, roomId);
            try (ResultSet rs = p.executeQuery()) {
                if (!rs.next()) {
                    return Optional.empty();
                }
                long v = rs.getLong("last_ms");
                return rs.wasNull() ? Optional.empty() : Optional.of(v);
            }
        }
    }

    /** Một tin nhắn đã lưu: metadata + nội dung text, kèm thông tin người gửi để FE render. */
    public record MessageRow(
            long id,
            String clientMsgId,
            long roomId,
            long senderId,
            String senderUsername,
            String senderName,
            String senderAvatar,
            String type,
            String replyToClientId,
            String content,
            boolean isEdited,
            boolean isRecalledAll,
            long sentAtMs,
            long editedAtMs,
            String forwardedFromClientId
    ) {
    }

    private static final String MSG_SELECT =
            "SELECT m.id, m.client_msg_id, m.room_id, m.sender_id, m.type, m.reply_to_client_id, " +
                    "m.content, m.is_edited, m.is_recalled_all, m.forwarded_from_client_id, " +
                    "(UNIX_TIMESTAMP(m.sent_at) * 1000) AS sent_ms, " +
                    "COALESCE((UNIX_TIMESTAMP(m.edited_at) * 1000), 0) AS edited_ms, " +
                    "u.username AS sender_username, u.display_name AS sender_name, u.avatar_url AS sender_avatar " +
                    "FROM message_meta m LEFT JOIN users u ON u.id = m.sender_id ";

    /**
     * Ghi một tin nhắn. Idempotent theo client_msg_id (UNIQUE toàn cục): gọi lại
     * với cùng khoá chỉ cập nhật nội dung, KHÔNG tạo bản ghi trùng.
     * forwardedFromClientId = client_msg_id của tin gốc khi đây là tin "chia sẻ".
     */
    public MessageRow insertMessage(long roomId, long senderId, String clientMsgId, String type,
                                    String replyToClientId, String content, String forwardedFromClientId) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "INSERT INTO message_meta (client_msg_id, room_id, sender_id, type, reply_to_client_id, content, forwarded_from_client_id) " +
                             "VALUES (?, ?, ?, ?, ?, ?, ?) " +
                             "ON DUPLICATE KEY UPDATE content = VALUES(content), reply_to_client_id = VALUES(reply_to_client_id)")) {
            p.setString(1, clientMsgId);
            p.setLong(2, roomId);
            p.setLong(3, senderId);
            p.setString(4, type);
            p.setString(5, replyToClientId);
            p.setString(6, content);
            p.setString(7, forwardedFromClientId);
            p.executeUpdate();
        }
        return messageByClientId(roomId, clientMsgId)
                .orElseThrow(() -> new SQLException("client_msg_id already used in another room"));
    }

    /**
     * Bảo đảm tồn tại dòng metadata cho một tin (content NULL) — dùng cho nhắn tin
     * ngoại tuyến E2E: nội dung thật nằm trong phong bì ở message_cache, server chỉ
     * giữ metadata để reaction/seen/recall/forward hoạt động. Idempotent, KHÔNG ghi đè
     * nội dung đã có (tránh làm mất tin plaintext legacy khi client gửi lại).
     */
    public void ensureMessageMeta(long roomId, long senderId, String clientMsgId, String type,
                                  String replyToClientId, String forwardedFromClientId, Long sentAtMs) throws SQLException {
        String sent = sentAtMs == null ? "CURRENT_TIMESTAMP" : "FROM_UNIXTIME(? / 1000)";
        String sql = "INSERT INTO message_meta "
                + "(client_msg_id, room_id, sender_id, type, reply_to_client_id, forwarded_from_client_id, content, sent_at) "
                + "VALUES (?, ?, ?, ?, ?, ?, NULL, " + sent + ") "
                + "ON DUPLICATE KEY UPDATE client_msg_id = client_msg_id";
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(sql)) {
            int i = 1;
            p.setString(i++, clientMsgId);
            p.setLong(i++, roomId);
            p.setLong(i++, senderId);
            p.setString(i++, type);
            p.setString(i++, replyToClientId);
            p.setString(i++, forwardedFromClientId);
            if (sentAtMs != null) {
                p.setLong(i++, sentAtMs);
            }
            p.executeUpdate();
        }
    }

    public Optional<MessageRow> messageByClientId(long roomId, String clientMsgId) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     MSG_SELECT + "WHERE m.room_id = ? AND m.client_msg_id = ? LIMIT 1")) {
            p.setLong(1, roomId);
            p.setString(2, clientMsgId);
            try (ResultSet rs = p.executeQuery()) {
                return rs.next() ? Optional.of(rowMessage(rs)) : Optional.empty();
            }
        }
    }

    /**
     * client_msg_id là unique TOÀN CỤC — trả về phòng đang sở hữu khoá này (nếu có)
     * để handler từ chối khi client xài lại khoá của phòng khác.
     */
    public Optional<Long> roomOfClientId(String clientMsgId) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT room_id FROM message_meta WHERE client_msg_id = ? LIMIT 1")) {
            p.setString(1, clientMsgId);
            try (ResultSet rs = p.executeQuery()) {
                return rs.next() ? Optional.of(rs.getLong(1)) : Optional.empty();
            }
        }
    }

    /** Tìm tin theo client_msg_id bất kể phòng (dùng cho "chia sẻ tin"). */
    public Optional<MessageRow> findByClientIdGlobal(String clientMsgId) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(MSG_SELECT + "WHERE m.client_msg_id = ? LIMIT 1")) {
            p.setString(1, clientMsgId);
            try (ResultSet rs = p.executeQuery()) {
                return rs.next() ? Optional.of(rowMessage(rs)) : Optional.empty();
            }
        }
    }

    public boolean isMember(long roomId, long userId) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ? AND left_at IS NULL AND banned_at IS NULL")) {
            p.setLong(1, roomId);
            p.setLong(2, userId);
            try (ResultSet rs = p.executeQuery()) {
                return rs.next();
            }
        }
    }

    /** Hai user có ít nhất một phòng chung (đều còn là thành viên) hay không. */
    public boolean shareRoom(long a, long b) throws SQLException {
        if (a == b) {
            return true;
        }
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT 1 FROM room_members x JOIN room_members y ON x.room_id = y.room_id " +
                             "WHERE x.user_id = ? AND y.user_id = ? " +
                             "AND x.left_at IS NULL AND x.banned_at IS NULL " +
                             "AND y.left_at IS NULL AND y.banned_at IS NULL LIMIT 1")) {
            p.setLong(1, a);
            p.setLong(2, b);
            try (ResultSet rs = p.executeQuery()) {
                return rs.next();
            }
        }
    }

    /**
     * Đánh dấu đã đọc: CHỈ tiến tới, không lùi. last_read_message_id = client_msg_id
     * của tin mà user đã đọc đến (kể cả tin của chính mình).
     */
    public void markRead(long roomId, long userId, String clientMsgId) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "UPDATE room_members rm SET rm.last_read_message_id = ? " +
                             "WHERE rm.room_id = ? AND rm.user_id = ? " +
                             "AND (" +
                             "  rm.last_read_message_id IS NULL" +
                             "  OR (SELECT id FROM message_meta a WHERE a.client_msg_id = rm.last_read_message_id AND a.room_id = rm.room_id)" +
                             "  < (SELECT id FROM message_meta b WHERE b.client_msg_id = ? AND b.room_id = rm.room_id)" +
                             ")")) {
            p.setString(1, clientMsgId);
            p.setLong(2, roomId);
            p.setLong(3, userId);
            p.setString(4, clientMsgId);
            p.executeUpdate();
        }
    }

    public record ReaderRow(long userId, String name, String username, String lastReadClientId) {
    }

    /** Những member của phòng có last_read_message_id (đã đọc ít nhất 1 tin). */
    public List<ReaderRow> readersOf(long roomId) throws SQLException {
        List<ReaderRow> out = new ArrayList<>();
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT rm.user_id, u.display_name AS name, u.username, rm.last_read_message_id " +
                             "FROM room_members rm JOIN users u ON u.id = rm.user_id " +
                             "WHERE rm.room_id = ? AND rm.left_at IS NULL AND rm.banned_at IS NULL " +
                             "AND rm.last_read_message_id IS NOT NULL")) {
            p.setLong(1, roomId);
            try (ResultSet rs = p.executeQuery()) {
                while (rs.next()) {
                    out.add(new ReaderRow(
                            rs.getLong("user_id"),
                            rs.getString("name"),
                            rs.getString("username"),
                            rs.getString("last_read_message_id")
                    ));
                }
            }
        }
        return out;
    }

    /** map client_msg_id → row id (để so "đã đọc tới đâu" theo thứ tự id). */
    public Map<String, Long> rowIdsByClientId(long roomId, List<String> clientIds) throws SQLException {
        Map<String, Long> out = new java.util.HashMap<>();
        if (clientIds.isEmpty()) {
            return out;
        }
        StringBuilder sb = new StringBuilder("SELECT id, client_msg_id FROM message_meta WHERE room_id = ? AND client_msg_id IN (");
        for (int i = 0; i < clientIds.size(); i++) {
            if (i > 0) {
                sb.append(",");
            }
            sb.append("?");
        }
        sb.append(")");
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(sb.toString())) {
            p.setLong(1, roomId);
            for (int i = 0; i < clientIds.size(); i++) {
                p.setString(i + 2, clientIds.get(i));
            }
            try (ResultSet rs = p.executeQuery()) {
                while (rs.next()) {
                    out.put(rs.getString("client_msg_id"), rs.getLong("id"));
                }
            }
        }
        return out;
    }

    /**
     * Lịch sử một phòng, phân trang lùi theo id tăng dần của bảng.
     * beforeId = null → lấy trang cuối (mới nhất); kết quả trả về TĂNG DẪN theo thời gian.
     */
    public List<MessageRow> messagesBefore(long roomId, long viewerId, Long beforeId, int limit) throws SQLException {
        String sql = MSG_SELECT
                + "WHERE m.room_id = ?"
                + " AND m.client_msg_id NOT IN (SELECT client_msg_id FROM message_hidden WHERE user_id = ?)"
                + (beforeId == null ? "" : " AND m.id < ?")
                + " ORDER BY m.id DESC LIMIT ?";
        List<MessageRow> out = new ArrayList<>();
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(sql)) {
            int i = 1;
            p.setLong(i++, roomId);
            p.setLong(i++, viewerId);
            if (beforeId != null) {
                p.setLong(i++, beforeId);
            }
            p.setInt(i, limit);
            try (ResultSet rs = p.executeQuery()) {
                while (rs.next()) {
                    out.add(rowMessage(rs));
                }
            }
        }
        java.util.Collections.reverse(out);
        return out;
    }

    /** Sửa nội dung tin nhắn (chỉ chủ sở hữu): đặt lại content + đánh dấu is_edited. */
    public void updateContent(long roomId, String clientMsgId, String content) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "UPDATE message_meta SET content = ?, is_edited = 1, edited_at = NOW() " +
                             "WHERE room_id = ? AND client_msg_id = ?")) {
            p.setString(1, content);
            p.setLong(2, roomId);
            p.setString(3, clientMsgId);
            p.executeUpdate();
        }
    }

    /**
     * Đánh dấu "đã sửa" cho tin E2E mà KHÔNG lưu nội dung (nội dung thật do Peer Core
     * giữ trong lịch sử cục bộ đã giải mã). Server chỉ còn metadata: is_edited + edited_at.
     */
    public void markEdited(long roomId, String clientMsgId) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "UPDATE message_meta SET is_edited = 1, edited_at = NOW() " +
                             "WHERE room_id = ? AND client_msg_id = ?")) {
            p.setLong(1, roomId);
            p.setString(2, clientMsgId);
            p.executeUpdate();
        }
    }

    /** Thu hồi cho mọi người: mất nội dung, chỉ còn metadata + cờ thu hồi. */
    public void recallMessage(long roomId, String clientMsgId) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "UPDATE message_meta SET is_recalled_all = 1, content = NULL " +
                             "WHERE room_id = ? AND client_msg_id = ?")) {
            p.setLong(1, roomId);
            p.setString(2, clientMsgId);
            p.executeUpdate();
        }
    }

    /** "Xoá chỉ ở phía tôi": ẩn tin khỏi lịch sử riêng của user (idempotent). */
    public void hideForUser(long roomId, String clientMsgId, long userId) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "INSERT IGNORE INTO message_hidden (client_msg_id, user_id) VALUES (?, ?)")) {
            p.setString(1, clientMsgId);
            p.setLong(2, userId);
            p.executeUpdate();
        }
    }

    public void upsertReaction(String clientMsgId, long userId, String emoji) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "INSERT INTO reactions (client_msg_id, user_id, emoji) VALUES (?, ?, ?) " +
                             "ON DUPLICATE KEY UPDATE emoji = VALUES(emoji), created_at = NOW()")) {
            p.setString(1, clientMsgId);
            p.setLong(2, userId);
            p.setString(3, emoji);
            p.executeUpdate();
        }
    }

    public void removeReaction(String clientMsgId, long userId) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "DELETE FROM reactions WHERE client_msg_id = ? AND user_id = ?")) {
            p.setString(1, clientMsgId);
            p.setLong(2, userId);
            p.executeUpdate();
        }
    }

    /** Thu hồi xoá luôn mọi reaction của tin (khớp hành vi UI: thu hồi → sạch reaction). */
    public void clearReactions(String clientMsgId) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "DELETE FROM reactions WHERE client_msg_id = ?")) {
            p.setString(1, clientMsgId);
            p.executeUpdate();
        }
    }

    public record ReactionRow(String clientMsgId, long userId, String emoji, String name, String username) {
    }

    /** Danh sách reaction của các tin (đã nạp reactions) — FE render theo nhóm client_msg_id. */
    public List<ReactionRow> reactionsFor(List<String> clientMsgIds) throws SQLException {
        List<ReactionRow> out = new ArrayList<>();
        if (clientMsgIds.isEmpty()) {
            return out;
        }
        StringBuilder sb = new StringBuilder(
                "SELECT r.client_msg_id, r.user_id, r.emoji, u.display_name AS name, u.username " +
                        "FROM reactions r JOIN users u ON u.id = r.user_id WHERE r.client_msg_id IN (");
        for (int i = 0; i < clientMsgIds.size(); i++) {
            if (i > 0) {
                sb.append(",");
            }
            sb.append("?");
        }
        sb.append(")");
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(sb.toString())) {
            for (int i = 0; i < clientMsgIds.size(); i++) {
                p.setString(i + 1, clientMsgIds.get(i));
            }
            try (ResultSet rs = p.executeQuery()) {
                while (rs.next()) {
                    out.add(new ReactionRow(
                            rs.getString("client_msg_id"),
                            rs.getLong("user_id"),
                            rs.getString("emoji"),
                            rs.getString("name"),
                            rs.getString("username")
                    ));
                }
            }
        }
        return out;
    }

    private static MessageRow rowMessage(ResultSet rs) throws SQLException {
        return new MessageRow(
                rs.getLong("id"),
                rs.getString("client_msg_id"),
                rs.getLong("room_id"),
                rs.getLong("sender_id"),
                rs.getString("sender_username"),
                rs.getString("sender_name"),
                rs.getString("sender_avatar"),
                rs.getString("type"),
                rs.getString("reply_to_client_id"),
                rs.getString("content"),
                rs.getBoolean("is_edited"),
                rs.getBoolean("is_recalled_all"),
                rs.getLong("sent_ms"),
                rs.getLong("edited_ms"),
                rs.getString("forwarded_from_client_id")
        );
    }

    private static RoomRow rowRoom(ResultSet rs) throws SQLException {
        return new RoomRow(
                rs.getLong("id"),
                rs.getBoolean("is_direct"),
                rs.getString("name"),
                rs.getString("avatar_url"),
                rs.getString("background_url"),
                rs.getString("theme_color"),
                rs.getString("default_reaction_emoji"),
                rs.getObject("member_a_id") == null ? null : rs.getLong("member_a_id"),
                rs.getObject("member_b_id") == null ? null : rs.getLong("member_b_id"),
                rs.getObject("created_by") == null ? null : rs.getLong("created_by"),
                rs.getLong("created_ms")
        );
    }

    private static MemberRow rowMember(ResultSet rs) throws SQLException {
        String role = rs.getString("room_role");
        if ("leader".equalsIgnoreCase(role)) {
            role = "owner";
        }
        return new MemberRow(
                rs.getLong("id"),
                rs.getString("public_id"),
                rs.getString("username"),
                rs.getString("display_name"),
                rs.getString("avatar_url"),
                role,
                rs.getString("last_read_message_id"),
                rs.getObject("joined_ms") == null ? null : String.valueOf(rs.getLong("joined_ms")),
                rs.getLong("last_seen_ms")
        );
    }

    public RoomSettings getRoomSettings(long roomId) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT room_id, allow_member_edit_info, allow_member_pin, allow_member_notes_reminders, " +
                             "allow_member_polls, allow_member_send, require_join_approval, highlight_admin_messages, " +
                             "new_member_read_recent, join_link_enabled, join_token FROM room_settings WHERE room_id = ?")) {
            p.setLong(1, roomId);
            try (ResultSet rs = p.executeQuery()) {
                if (rs.next()) {
                    return new RoomSettings(
                            rs.getLong("room_id"),
                            rs.getBoolean("allow_member_edit_info"),
                            rs.getBoolean("allow_member_pin"),
                            rs.getBoolean("allow_member_notes_reminders"),
                            rs.getBoolean("allow_member_polls"),
                            rs.getBoolean("allow_member_send"),
                            rs.getBoolean("require_join_approval"),
                            rs.getBoolean("highlight_admin_messages"),
                            rs.getBoolean("new_member_read_recent"),
                            rs.getBoolean("join_link_enabled"),
                            rs.getString("join_token")
                    );
                }
            }
        }
        return RoomSettings.defaults(roomId);
    }

    public void updateRoomSettings(long roomId, Map<String, Object> patch) throws SQLException {
        RoomSettings cur = getRoomSettings(roomId);
        boolean allowMemberEditInfo = patch.containsKey("allow_member_edit_info")
                ? Boolean.parseBoolean(String.valueOf(patch.get("allow_member_edit_info")))
                : cur.allowMemberEditInfo();
        boolean allowMemberPin = patch.containsKey("allow_member_pin")
                ? Boolean.parseBoolean(String.valueOf(patch.get("allow_member_pin")))
                : cur.allowMemberPin();
        boolean allowMemberNotesReminders = patch.containsKey("allow_member_notes_reminders")
                ? Boolean.parseBoolean(String.valueOf(patch.get("allow_member_notes_reminders")))
                : cur.allowMemberNotesReminders();
        boolean allowMemberPolls = patch.containsKey("allow_member_polls")
                ? Boolean.parseBoolean(String.valueOf(patch.get("allow_member_polls")))
                : cur.allowMemberPolls();
        boolean allowMemberSend = patch.containsKey("allow_member_send")
                ? Boolean.parseBoolean(String.valueOf(patch.get("allow_member_send")))
                : cur.allowMemberSend();
        boolean requireJoinApproval = patch.containsKey("require_join_approval")
                ? Boolean.parseBoolean(String.valueOf(patch.get("require_join_approval")))
                : cur.requireJoinApproval();
        boolean highlightAdminMessages = patch.containsKey("highlight_admin_messages")
                ? Boolean.parseBoolean(String.valueOf(patch.get("highlight_admin_messages")))
                : cur.highlightAdminMessages();
        boolean newMemberReadRecent = patch.containsKey("new_member_read_recent")
                ? Boolean.parseBoolean(String.valueOf(patch.get("new_member_read_recent")))
                : cur.newMemberReadRecent();
        boolean joinLinkEnabled = patch.containsKey("join_link_enabled")
                ? Boolean.parseBoolean(String.valueOf(patch.get("join_link_enabled")))
                : cur.joinLinkEnabled();
        String joinToken = patch.containsKey("join_token")
                ? (patch.get("join_token") == null ? null : String.valueOf(patch.get("join_token")))
                : cur.joinToken();
        if (joinLinkEnabled && (joinToken == null || joinToken.isBlank())) {
            joinToken = UUID.randomUUID().toString().replace("-", "");
        }

        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "INSERT INTO room_settings (room_id, allow_member_edit_info, allow_member_pin, " +
                             "allow_member_notes_reminders, allow_member_polls, allow_member_send, require_join_approval, " +
                             "highlight_admin_messages, new_member_read_recent, join_link_enabled, join_token) " +
                             "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
                             "ON DUPLICATE KEY UPDATE " +
                             "allow_member_edit_info = VALUES(allow_member_edit_info), " +
                             "allow_member_pin = VALUES(allow_member_pin), " +
                             "allow_member_notes_reminders = VALUES(allow_member_notes_reminders), " +
                             "allow_member_polls = VALUES(allow_member_polls), " +
                             "allow_member_send = VALUES(allow_member_send), " +
                             "require_join_approval = VALUES(require_join_approval), " +
                             "highlight_admin_messages = VALUES(highlight_admin_messages), " +
                             "new_member_read_recent = VALUES(new_member_read_recent), " +
                             "join_link_enabled = VALUES(join_link_enabled), " +
                             "join_token = VALUES(join_token)")) {
            p.setLong(1, roomId);
            p.setBoolean(2, allowMemberEditInfo);
            p.setBoolean(3, allowMemberPin);
            p.setBoolean(4, allowMemberNotesReminders);
            p.setBoolean(5, allowMemberPolls);
            p.setBoolean(6, allowMemberSend);
            p.setBoolean(7, requireJoinApproval);
            p.setBoolean(8, highlightAdminMessages);
            p.setBoolean(9, newMemberReadRecent);
            p.setBoolean(10, joinLinkEnabled);
            p.setString(11, joinToken);
            p.executeUpdate();
        }
    }

    public String regenerateJoinToken(long roomId) throws SQLException {
        String token = UUID.randomUUID().toString().replace("-", "");
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "INSERT INTO room_settings (room_id, join_token, join_link_enabled) VALUES (?, ?, 1) " +
                             "ON DUPLICATE KEY UPDATE join_token = VALUES(join_token), join_link_enabled = 1")) {
            p.setLong(1, roomId);
            p.setString(2, token);
            p.executeUpdate();
        }
        return token;
    }

    public String getMemberRole(long roomId, long userId) throws SQLException {
        try (Connection c = ds.getConnection()) {
            try (PreparedStatement p = c.prepareStatement(
                    "SELECT room_role FROM room_members WHERE room_id = ? AND user_id = ? AND left_at IS NULL AND banned_at IS NULL LIMIT 1")) {
                p.setLong(1, roomId);
                p.setLong(2, userId);
                try (ResultSet rs = p.executeQuery()) {
                    if (rs.next()) {
                        String r = rs.getString("room_role");
                        if (r != null && !r.isBlank()) {
                            if ("leader".equalsIgnoreCase(r)) return "owner";
                            return r.toLowerCase();
                        }
                    }
                }
            }

            // Fallback: check creator of room
            try (PreparedStatement pRoom = c.prepareStatement(
                    "SELECT created_by FROM rooms WHERE id = ? LIMIT 1")) {
                pRoom.setLong(1, roomId);
                try (ResultSet rsRoom = pRoom.executeQuery()) {
                    if (rsRoom.next()) {
                        long creator = rsRoom.getLong("created_by");
                        if (creator > 0 && creator == userId) {
                            return "owner";
                        }
                    }
                }
            }
        }
        return "member";
    }

    public boolean transferOwner(long roomId, long currentOwnerId, long newOwnerId) throws SQLException {
        try (Connection c = ds.getConnection()) {
            c.setAutoCommit(false);
            try {
                // Verify newOwnerId is active member
                try (PreparedStatement pCheck = c.prepareStatement(
                        "SELECT id FROM room_members WHERE room_id = ? AND user_id = ? AND left_at IS NULL")) {
                    pCheck.setLong(1, roomId);
                    pCheck.setLong(2, newOwnerId);
                    try (ResultSet rs = pCheck.executeQuery()) {
                        if (!rs.next()) {
                            c.rollback();
                            return false;
                        }
                    }
                }
                // Demote old owner to admin
                try (PreparedStatement p = c.prepareStatement(
                        "UPDATE room_members SET room_role = 'admin' WHERE room_id = ? AND user_id = ?")) {
                    p.setLong(1, roomId);
                    p.setLong(2, currentOwnerId);
                    p.executeUpdate();
                }
                // Promote new owner to owner
                try (PreparedStatement p = c.prepareStatement(
                        "UPDATE room_members SET room_role = 'owner' WHERE room_id = ? AND user_id = ?")) {
                    p.setLong(1, roomId);
                    p.setLong(2, newOwnerId);
                    p.executeUpdate();
                }
                // Update rooms.created_by
                try (PreparedStatement p = c.prepareStatement(
                        "UPDATE rooms SET created_by = ? WHERE id = ?")) {
                    p.setLong(1, newOwnerId);
                    p.setLong(2, roomId);
                    p.executeUpdate();
                }
                c.commit();
                return true;
            } catch (SQLException e) {
                c.rollback();
                throw e;
            } finally {
                c.setAutoCommit(true);
            }
        }
    }

    public void dissolveRoom(long roomId) throws SQLException {
        try (Connection c = ds.getConnection()) {
            c.setAutoCommit(false);
            try {
                try (PreparedStatement p = c.prepareStatement(
                        "UPDATE room_members SET left_at = CURRENT_TIMESTAMP WHERE room_id = ? AND left_at IS NULL")) {
                    p.setLong(1, roomId);
                    p.executeUpdate();
                }
                c.commit();
            } catch (SQLException e) {
                c.rollback();
                throw e;
            } finally {
                c.setAutoCommit(true);
            }
        }
    }

    public boolean blockMember(long roomId, long userId, long blockerId, String reason) throws SQLException {
        try (Connection c = ds.getConnection()) {
            c.setAutoCommit(false);
            try {
                try (PreparedStatement p = c.prepareStatement(
                        "INSERT INTO room_blocks (room_id, user_id, blocked_by, reason, blocked_at) " +
                                "VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) " +
                                "ON DUPLICATE KEY UPDATE blocked_by = VALUES(blocked_by), reason = VALUES(reason), blocked_at = CURRENT_TIMESTAMP")) {
                    p.setLong(1, roomId);
                    p.setLong(2, userId);
                    p.setLong(3, blockerId);
                    p.setString(4, reason);
                    p.executeUpdate();
                }
                try (PreparedStatement p = c.prepareStatement(
                        "UPDATE room_members SET left_at = CURRENT_TIMESTAMP, banned_at = CURRENT_TIMESTAMP " +
                                "WHERE room_id = ? AND user_id = ? AND left_at IS NULL")) {
                    p.setLong(1, roomId);
                    p.setLong(2, userId);
                    p.executeUpdate();
                }
                c.commit();
                return true;
            } catch (SQLException e) {
                c.rollback();
                throw e;
            } finally {
                c.setAutoCommit(true);
            }
        }
    }

    public boolean unblockMember(long roomId, long userId) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "DELETE FROM room_blocks WHERE room_id = ? AND user_id = ?")) {
            p.setLong(1, roomId);
            p.setLong(2, userId);
            return p.executeUpdate() > 0;
        }
    }

    public boolean isUserBlocked(long roomId, long userId) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT 1 FROM room_blocks WHERE room_id = ? AND user_id = ? LIMIT 1")) {
            p.setLong(1, roomId);
            p.setLong(2, userId);
            try (ResultSet rs = p.executeQuery()) {
                return rs.next();
            }
        }
    }

    public List<BlockRow> listBlocks(long roomId) throws SQLException {
        List<BlockRow> list = new ArrayList<>();
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT rb.id, rb.room_id, rb.user_id, u.username, u.display_name, u.avatar_url, " +
                             "rb.blocked_by, ub.display_name AS blocker_name, rb.reason, " +
                             "(UNIX_TIMESTAMP(rb.blocked_at) * 1000) AS blocked_ms " +
                             "FROM room_blocks rb " +
                             "JOIN users u ON u.id = rb.user_id " +
                             "JOIN users ub ON ub.id = rb.blocked_by " +
                             "WHERE rb.room_id = ? ORDER BY rb.blocked_at DESC")) {
            p.setLong(1, roomId);
            try (ResultSet rs = p.executeQuery()) {
                while (rs.next()) {
                    list.add(new BlockRow(
                            rs.getLong("id"),
                            rs.getLong("room_id"),
                            rs.getLong("user_id"),
                            rs.getString("username"),
                            rs.getString("display_name"),
                            rs.getString("avatar_url"),
                            rs.getLong("blocked_by"),
                            rs.getString("blocker_name"),
                            rs.getString("reason"),
                            rs.getLong("blocked_ms")
                    ));
                }
            }
        }
        return list;
    }

    public long createJoinRequest(long roomId, long userId, Long invitedBy, String via) throws SQLException {
        try (Connection c = ds.getConnection()) {
            try (PreparedStatement p = c.prepareStatement(
                    "SELECT id FROM join_requests WHERE room_id = ? AND user_id = ? AND status = 'pending' LIMIT 1")) {
                p.setLong(1, roomId);
                p.setLong(2, userId);
                try (ResultSet rs = p.executeQuery()) {
                    if (rs.next()) {
                        return rs.getLong(1);
                    }
                }
            }
            try (PreparedStatement p = c.prepareStatement(
                    "INSERT INTO join_requests (room_id, user_id, invited_by, via, status, created_at) " +
                            "VALUES (?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)",
                    Statement.RETURN_GENERATED_KEYS)) {
                p.setLong(1, roomId);
                p.setLong(2, userId);
                if (invitedBy == null) {
                    p.setNull(3, java.sql.Types.BIGINT);
                } else {
                    p.setLong(3, invitedBy);
                }
                p.setString(4, via == null ? "invite" : via);
                p.executeUpdate();
                try (ResultSet k = p.getGeneratedKeys()) {
                    if (k.next()) {
                        return k.getLong(1);
                    }
                }
            }
        }
        return -1;
    }

    public List<JoinRequestRow> listPendingJoinRequests(long roomId) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement pExp = c.prepareStatement(
                     "UPDATE join_requests SET status = 'rejected', decided_at = CURRENT_TIMESTAMP " +
                             "WHERE room_id = ? AND status = 'pending' AND created_at < DATE_SUB(NOW(), INTERVAL 14 DAY)")) {
            pExp.setLong(1, roomId);
            pExp.executeUpdate();
        } catch (Exception ignored) {}

        List<JoinRequestRow> list = new ArrayList<>();
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT jr.id, jr.room_id, jr.user_id, u.username, u.display_name, u.avatar_url, " +
                             "jr.invited_by, inv.display_name AS inviter_name, jr.via, jr.status, " +
                             "(UNIX_TIMESTAMP(jr.created_at) * 1000) AS created_ms, " +
                             "jr.decided_by, (UNIX_TIMESTAMP(jr.decided_at) * 1000) AS decided_ms " +
                             "FROM join_requests jr " +
                             "JOIN users u ON u.id = jr.user_id " +
                             "LEFT JOIN users inv ON inv.id = jr.invited_by " +
                             "WHERE jr.room_id = ? AND jr.status = 'pending' " +
                             "ORDER BY jr.created_at DESC")) {
            p.setLong(1, roomId);
            try (ResultSet rs = p.executeQuery()) {
                while (rs.next()) {
                    list.add(new JoinRequestRow(
                            rs.getLong("id"),
                            rs.getLong("room_id"),
                            rs.getLong("user_id"),
                            rs.getString("username"),
                            rs.getString("display_name"),
                            rs.getString("avatar_url"),
                            rs.getObject("invited_by") == null ? null : rs.getLong("invited_by"),
                            rs.getString("inviter_name"),
                            rs.getString("via"),
                            rs.getString("status"),
                            rs.getLong("created_ms"),
                            rs.getObject("decided_by") == null ? null : rs.getLong("decided_by"),
                            rs.getObject("decided_ms") == null ? null : rs.getLong("decided_ms")
                    ));
                }
            }
        }
        return list;
    }

    public Optional<JoinRequestRow> findJoinRequest(long reqId) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT jr.id, jr.room_id, jr.user_id, u.username, u.display_name, u.avatar_url, " +
                             "jr.invited_by, inv.display_name AS inviter_name, jr.via, jr.status, " +
                             "(UNIX_TIMESTAMP(jr.created_at) * 1000) AS created_ms, " +
                             "jr.decided_by, (UNIX_TIMESTAMP(jr.decided_at) * 1000) AS decided_ms " +
                             "FROM join_requests jr " +
                             "JOIN users u ON u.id = jr.user_id " +
                             "LEFT JOIN users inv ON inv.id = jr.invited_by " +
                             "WHERE jr.id = ?")) {
            p.setLong(1, reqId);
            try (ResultSet rs = p.executeQuery()) {
                if (rs.next()) {
                    return Optional.of(new JoinRequestRow(
                            rs.getLong("id"),
                            rs.getLong("room_id"),
                            rs.getLong("user_id"),
                            rs.getString("username"),
                            rs.getString("display_name"),
                            rs.getString("avatar_url"),
                            rs.getObject("invited_by") == null ? null : rs.getLong("invited_by"),
                            rs.getString("inviter_name"),
                            rs.getString("via"),
                            rs.getString("status"),
                            rs.getLong("created_ms"),
                            rs.getObject("decided_by") == null ? null : rs.getLong("decided_by"),
                            rs.getObject("decided_ms") == null ? null : rs.getLong("decided_ms")
                    ));
                }
            }
        }
        return Optional.empty();
    }

    public boolean resolveJoinRequest(long reqId, String status, long deciderId) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "UPDATE join_requests SET status = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP " +
                             "WHERE id = ? AND status = 'pending'")) {
            p.setString(1, status);
            p.setLong(2, deciderId);
            p.setLong(3, reqId);
            return p.executeUpdate() > 0;
        }
    }

    public int countPendingJoinRequests(long roomId) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT COUNT(*) FROM join_requests WHERE room_id = ? AND status = 'pending'")) {
            p.setLong(1, roomId);
            try (ResultSet rs = p.executeQuery()) {
                if (rs.next()) {
                    return rs.getInt(1);
                }
            }
        }
        return 0;
    }

    public void insertSystemMessage(long roomId, long operatorId, String text) throws SQLException {
        if (text == null || text.isBlank()) return;
        String clientMsgId = "sys-" + System.currentTimeMillis() + "-" + UUID.randomUUID().toString().substring(0, 8);
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "INSERT INTO message_meta (client_msg_id, room_id, sender_id, type, content, sent_at) " +
                             "VALUES (?, ?, ?, 'system', ?, CURRENT_TIMESTAMP)")) {
            p.setString(1, clientMsgId);
            p.setLong(2, roomId);
            p.setLong(3, operatorId);
            p.setString(4, text);
            p.executeUpdate();
        } catch (Exception ignored) {}
    }
}