package com.workchat.tracker.db;

import com.workchat.tracker.common.Base62;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.SQLIntegrityConstraintViolationException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Káº¿t báº¡n + má»i vĂ o phĂ²ng báº±ng mĂ£ (báº£ng room_invites cĂ³ sáºµn: cĂ³ háº¡n dĂ¹ng, thu há»“i Ä‘Æ°á»£c).
 * Má»i ghi dá»¯ liá»‡u nháº¡y cáº£m Ä‘á»u náº±m trong transaction; cáº·p friendship chuáº©n hoĂ¡ user_a < user_b.
 */
public final class SocialDao {
    private final DataSource ds;

    public SocialDao(DataSource ds) {
        this.ds = ds;
    }

    public record PublicUser(long id, String publicId, String username, String displayName, String avatar,
                             long createdAtMs, long lastSeenAtMs, String cover, String bio) {
    }

    public record FriendRequestRow(long id, long fromUserId, String publicId, String fromUsername,
                                   String fromDisplayName, String fromAvatar, long createdAtMs) {
    }

    public record SentRequestRow(long id, long toUserId, String publicId, String toUsername,
                                 String toDisplayName, String toAvatar, long createdAtMs) {
    }

    public record SuggestionRow(long id, String publicId, String username, String displayName,
                                String avatar, int mutualCount, int sharedRooms) {
    }

    public enum Relation { NONE, PENDING_SENT, PENDING_RECEIVED, FRIEND, SELF }

    public enum RequestOutcome { SENT, ACCEPTED_AUTOMATICALLY, ERR_SELF, ERR_ALREADY_FRIEND, ERR_PENDING }

    public enum RespondOutcome { ACCEPTED, REJECTED, ALREADY_RESPONDED, NOT_FOUND }

    /** Káº¿t quáº£ cháº¥p nháº­n káº¿t báº¡n: kĂ¨m peer id + phĂ²ng 1-1 (Ä‘Ă£ báº£o Ä‘áº£m trong cĂ¹ng transaction). */
    public record AcceptResult(RespondOutcome outcome, long peerId, long roomId) {
        static AcceptResult of(RespondOutcome o) {
            return new AcceptResult(o, 0L, 0L);
        }
    }

    public enum JoinOutcome { JOINED, ALREADY_MEMBER, ROOM_FULL, ROOM_NOT_FOUND, NOT_FRIEND, INVITE_NOT_FOUND, INVITE_EXPIRED }

    public record JoinResult(JoinOutcome outcome, long roomId) {
    }

    private static JoinResult just(JoinOutcome o) {
        return new JoinResult(o, 0L);
    }

    // ---------- users / public_id ----------

    /** Äiá»n public_id cho má»i user cĂ²n NULL (SecureRandom + base62 12-16, retry khi trĂ¹ng). */
    public int backfillPublicIds() throws SQLException {
        List<Long> ids = new ArrayList<>();
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement("SELECT id FROM users WHERE public_id IS NULL")) {
            try (ResultSet rs = p.executeQuery()) {
                while (rs.next()) {
                    ids.add(rs.getLong(1));
                }
            }
        }
        int done = 0;
        for (long id : ids) {
            for (int attempt = 0; attempt < 20; attempt++) {
                String candidate = Base62.publicId();
                if (!publicIdExists(candidate)) {
                    setPublicId(id, candidate);
                    done++;
                    break;
                }
            }
        }
        return done;
    }

    public String ensurePublicId(long userId) throws SQLException {
        Optional<String> existing = publicIdOf(userId);
        if (existing.isPresent()) {
            return existing.get();
        }
        for (int attempt = 0; attempt < 20; attempt++) {
            String candidate = Base62.publicId();
            if (!publicIdExists(candidate)) {
                setPublicId(userId, candidate);
                return candidate;
            }
        }
        throw new SQLException("KhĂ´ng táº¡o Ä‘Æ°á»£c public_id: háº¿t phÆ°Æ¡ng Ă¡n");
    }

    public Optional<String> publicIdOf(long userId) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT public_id FROM users WHERE id = ? LIMIT 1")) {
            p.setLong(1, userId);
            try (ResultSet rs = p.executeQuery()) {
                if (!rs.next()) {
                    return Optional.empty();
                }
                String v = rs.getString(1);
                return v == null ? Optional.empty() : Optional.of(v);
            }
        }
    }

    public Optional<PublicUser> findUserByPublicId(String publicId) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT id, COALESCE(public_id, username) AS public_id, username, display_name, avatar_url, cover_url, bio, (UNIX_TIMESTAMP(created_at) * 1000) AS created_ms, COALESCE(last_seen_at, 0) AS last_seen_ms FROM users WHERE public_id = ? OR username = ? LIMIT 1")) {
            p.setString(1, publicId);
            p.setString(2, publicId);
            try (ResultSet rs = p.executeQuery()) {
                if (!rs.next()) {
                    return Optional.empty();
                }
                return Optional.of(rowPublicUser(rs));
            }
        }
    }

    public List<PublicUser> searchUsers(String query, int limit) throws SQLException {
        List<PublicUser> out = new ArrayList<>();
        String raw = query == null ? "" : query.trim();
        if (raw.startsWith("/u/")) raw = raw.substring(3);
        else if (raw.startsWith("u/")) raw = raw.substring(2);
        else if (raw.startsWith("@")) raw = raw.substring(1);
        if (raw.isEmpty()) return out;

        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT id, COALESCE(public_id, username) AS public_id, username, display_name, avatar_url, cover_url, bio, " +
                             "(UNIX_TIMESTAMP(created_at) * 1000) AS created_ms, COALESCE(last_seen_at, 0) AS last_seen_ms " +
                             "FROM users " +
                             "WHERE public_id = ? OR username = ? OR email = ? OR username LIKE ? OR display_name LIKE ? " +
                             "ORDER BY (username = ? OR public_id = ? OR display_name = ?) DESC, username LIMIT ?")) {
            String like = "%" + raw + "%";
            p.setString(1, raw);
            p.setString(2, raw);
            p.setString(3, raw);
            p.setString(4, like);
            p.setString(5, like);
            p.setString(6, raw);
            p.setString(7, raw);
            p.setString(8, raw);
            p.setInt(9, Math.min(Math.max(limit, 1), 50));
            try (ResultSet rs = p.executeQuery()) {
                while (rs.next()) {
                    out.add(rowPublicUser(rs));
                }
            }
        }
        return out;
    }

    public Optional<PublicUser> findUserById(long userId) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT id, COALESCE(public_id, username) AS public_id, username, display_name, avatar_url, cover_url, bio, (UNIX_TIMESTAMP(created_at) * 1000) AS created_ms, COALESCE(last_seen_at, 0) AS last_seen_ms FROM users WHERE id = ? LIMIT 1")) {
            p.setLong(1, userId);
            try (ResultSet rs = p.executeQuery()) {
                return rs.next() ? Optional.of(rowPublicUser(rs)) : Optional.empty();
            }
        }
    }

    private boolean publicIdExists(String publicId) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT 1 FROM users WHERE public_id = ? LIMIT 1")) {
            p.setString(1, publicId);
            try (ResultSet rs = p.executeQuery()) {
                return rs.next();
            }
        }
    }

    private void setPublicId(long userId, String publicId) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "UPDATE users SET public_id = ? WHERE id = ?")) {
            p.setString(1, publicId);
            p.setLong(2, userId);
            p.executeUpdate();
        }
    }

    // ---------- quan há»‡ / báº¡n bĂ¨ ----------

    public boolean areFriends(long a, long b) throws SQLException {
        long lo = Math.min(a, b);
        long hi = Math.max(a, b);
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT 1 FROM friendships WHERE user_a_id = ? AND user_b_id = ? LIMIT 1")) {
            p.setLong(1, lo);
            p.setLong(2, hi);
            try (ResultSet rs = p.executeQuery()) {
                return rs.next();
            }
        }
    }

    private static void insertFriendshipTx(Connection c, long a, long b) throws SQLException {
        long lo = Math.min(a, b);
        long hi = Math.max(a, b);
        try (PreparedStatement p = c.prepareStatement(
                "INSERT INTO friendships (user_a_id, user_b_id) VALUES (?, ?) " +
                        "ON DUPLICATE KEY UPDATE id = id")) {
            p.setLong(1, lo);
            p.setLong(2, hi);
            p.executeUpdate();
        }
    }

    public Relation relation(long me, long other) throws SQLException {
        if (me == other) {
            return Relation.SELF;
        }
        if (areFriends(me, other)) {
            return Relation.FRIEND;
        }
        try (Connection c = ds.getConnection()) {
            try (PreparedStatement p = c.prepareStatement(
                    "SELECT status FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? LIMIT 1")) {
                p.setLong(1, me);
                p.setLong(2, other);
                try (ResultSet rs = p.executeQuery()) {
                    if (rs.next()) {
                        String st = rs.getString(1);
                        if ("pending".equals(st)) {
                            return Relation.PENDING_SENT;
                        }
                        if ("accepted".equals(st)) {
                            return Relation.FRIEND;
                        }
                    }
                }
            }
            try (PreparedStatement p = c.prepareStatement(
                    "SELECT status FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? LIMIT 1")) {
                p.setLong(1, other);
                p.setLong(2, me);
                try (ResultSet rs = p.executeQuery()) {
                    if (rs.next() && "pending".equals(rs.getString(1))) {
                        return Relation.PENDING_RECEIVED;
                    }
                }
            }
        }
        return Relation.NONE;
    }

    /**
     * Gá»­i lá»i má»i káº¿t báº¡n. Náº¿u Ä‘Ă­ch Ä‘Ă£ gá»­i cho mĂ¬nh (pending ngÆ°á»£c chiá»u) thĂ¬ Tá»° Äá»˜NG CHáº¤P NHáº¬N
     * cáº£ hai chiá»u trong 1 transaction vĂ  ghi cáº·p friendships.
     */
    public RequestOutcome requestFriend(long from, long to) throws SQLException {
        if (from == to) {
            return RequestOutcome.ERR_SELF;
        }
        try (Connection c = ds.getConnection()) {
            c.setAutoCommit(false);
            try {
                String pairStatus = frStatus(c, from, to);
                String reverseStatus = frStatus(c, to, from);

                if ("pending".equals(reverseStatus)) {
                    // B Ä‘Ă£ chá»§ Ä‘á»™ng há»i trÆ°á»›c â†’ coi nhÆ° cáº£ hai Ä‘á»“ng Ă½
                    markFrStatus(c, to, from, "accepted");
                    markFrStatusIfPending(c, from, to, "accepted");
                    insertFriendshipTx(c, from, to);
                    c.commit();
                    return RequestOutcome.ACCEPTED_AUTOMATICALLY;
                }
                if ("accepted".equals(pairStatus) || "accepted".equals(reverseStatus)) {
                    c.rollback();
                    return RequestOutcome.ERR_ALREADY_FRIEND;
                }
                if (areFriends(from, to)) {
                    c.rollback();
                    return RequestOutcome.ERR_ALREADY_FRIEND;
                }
                if ("pending".equals(pairStatus)) {
                    c.rollback();
                    return RequestOutcome.ERR_PENDING;
                }
                if ("declined".equals(pairStatus)) {
                    // gá»­i láº¡i sau khi bá»‹ tá»« chá»‘i â†’ má»Ÿ láº¡i
                    try (PreparedStatement p = c.prepareStatement(
                            "UPDATE friend_requests SET status = 'pending', responded_at = NULL " +
                                    "WHERE from_user_id = ? AND to_user_id = ?")) {
                        p.setLong(1, from);
                        p.setLong(2, to);
                        p.executeUpdate();
                    }
                } else {
                    try (PreparedStatement p = c.prepareStatement(
                            "INSERT INTO friend_requests (from_user_id, to_user_id, status) VALUES (?, ?, 'pending')")) {
                        p.setLong(1, from);
                        p.setLong(2, to);
                        p.executeUpdate();
                    }
                }
                c.commit();
                return RequestOutcome.SENT;
            } catch (SQLIntegrityConstraintViolationException dup) {
                c.rollback();
                return RequestOutcome.ERR_PENDING;
            } catch (SQLException e) {
                c.rollback();
                throw e;
            } finally {
                c.setAutoCommit(true);
            }
        }
    }

    /**
     * Cháº¥p nháº­n lá»i má»i káº¿t báº¡n. Trong CĂ™NG má»™t transaction: Ä‘á»•i lá»i má»i sang accepted
     * (idempotent theo Ä‘iá»u kiá»‡n status='pending'), ghi cáº·p friendship, vĂ  báº£o Ä‘áº£m tá»“n táº¡i
     * phĂ²ng 1-1 (dĂ¹ng láº¡i náº¿u Ä‘Ă£ cĂ³). Tráº£ vá» peer id + room id Ä‘á»ƒ handler phĂ¡t sá»± kiá»‡n.
     */
    public AcceptResult acceptRequest(long requestId, long me) throws SQLException {
        try (Connection c = ds.getConnection()) {
            c.setAutoCommit(false);
            try {
                long fromUserId;
                try (PreparedStatement p = c.prepareStatement(
                        "SELECT from_user_id FROM friend_requests WHERE id = ? LIMIT 1")) {
                    p.setLong(1, requestId);
                    try (ResultSet rs = p.executeQuery()) {
                        if (!rs.next()) {
                            c.rollback();
                            return AcceptResult.of(RespondOutcome.NOT_FOUND);
                        }
                        fromUserId = rs.getLong(1);
                    }
                }
                int updated;
                try (PreparedStatement p = c.prepareStatement(
                        "UPDATE friend_requests SET status = 'accepted', responded_at = NOW() " +
                                "WHERE id = ? AND to_user_id = ? AND status = 'pending'")) {
                    p.setLong(1, requestId);
                    p.setLong(2, me);
                    updated = p.executeUpdate();
                }
                if (updated == 0) {
                    c.rollback();
                    return AcceptResult.of(RespondOutcome.ALREADY_RESPONDED);
                }
                // chiá»u ngÆ°á»£c (náº¿u tá»“n táº¡i) cÅ©ng Ä‘Ă¡nh dáº¥u accepted cho nháº¥t quĂ¡n
                markFrStatusIfPending(c, me, fromUserId, "accepted");
                insertFriendshipTx(c, me, fromUserId);
                long roomId = RoomDao.ensureDirectRoomTx(c, me, fromUserId);
                c.commit();
                return new AcceptResult(RespondOutcome.ACCEPTED, fromUserId, roomId);
            } catch (SQLException e) {
                c.rollback();
                throw e;
            } finally {
                c.setAutoCommit(true);
            }
        }
    }

    public RespondOutcome rejectRequest(long requestId, long me) throws SQLException {
        try (Connection c = ds.getConnection()) {
            c.setAutoCommit(false);
            try {
                int updated;
                try (PreparedStatement p = c.prepareStatement(
                        "UPDATE friend_requests SET status = 'declined', responded_at = NOW() " +
                                "WHERE id = ? AND to_user_id = ? AND status = 'pending'")) {
                    p.setLong(1, requestId);
                    p.setLong(2, me);
                    updated = p.executeUpdate();
                }
                c.commit();
                if (updated == 0) {
                    try (PreparedStatement p = c.prepareStatement(
                            "SELECT 1 FROM friend_requests WHERE id = ? AND to_user_id = ? LIMIT 1")) {
                        p.setLong(1, requestId);
                        p.setLong(2, me);
                        try (ResultSet rs = p.executeQuery()) {
                            return rs.next() ? RespondOutcome.ALREADY_RESPONDED : RespondOutcome.NOT_FOUND;
                        }
                    }
                }
                return RespondOutcome.REJECTED;
            } catch (SQLException e) {
                c.rollback();
                throw e;
            } finally {
                c.setAutoCommit(true);
            }
        }
    }

    public Optional<Long> pendingRequestId(long a, long b) throws SQLException {
        Optional<Long> r = pendingFrIdTx(a, b);
        return r.isPresent() ? r : pendingFrIdTx(b, a);
    }

    /** Tráº£ vá» user id cá»§a Ä‘á»‘i phÆ°Æ¡ng trong má»™t friend_request (Ä‘á»ƒ táº¡o phĂ²ng 1-1 khi cháº¥p nháº­n). */
    public Optional<Long> requestPeerId(long requestId, long me) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT from_user_id, to_user_id FROM friend_requests WHERE id = ? LIMIT 1")) {
            p.setLong(1, requestId);
            try (ResultSet rs = p.executeQuery()) {
                if (!rs.next()) {
                    return Optional.empty();
                }
                long from = rs.getLong(1);
                long to = rs.getLong(2);
                if (from == me) {
                    return Optional.of(to);
                }
                if (to == me) {
                    return Optional.of(from);
                }
                return Optional.empty();
            }
        }
    }

    private Optional<Long> pendingFrIdTx(long from, long to) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT id FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending' LIMIT 1")) {
            p.setLong(1, from);
            p.setLong(2, to);
            try (ResultSet rs = p.executeQuery()) {
                return rs.next() ? Optional.of(rs.getLong(1)) : Optional.empty();
            }
        }
    }

    public RespondOutcome cancelRequest(long requestId, long me) throws SQLException {
        try (Connection c = ds.getConnection()) {
            try (PreparedStatement p = c.prepareStatement(
                    "UPDATE friend_requests SET status = 'declined', responded_at = NOW() " +
                            "WHERE id = ? AND from_user_id = ? AND status = 'pending'")) {
                p.setLong(1, requestId);
                p.setLong(2, me);
                if (p.executeUpdate() > 0) {
                    return RespondOutcome.REJECTED;
                }
            }
        }
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT 1 FROM friend_requests WHERE id = ? AND (from_user_id = ? OR to_user_id = ?) LIMIT 1")) {
            p.setLong(1, requestId);
            p.setLong(2, me);
            p.setLong(3, me);
            try (ResultSet rs = p.executeQuery()) {
                return rs.next() ? RespondOutcome.ALREADY_RESPONDED : RespondOutcome.NOT_FOUND;
            }
        }
    }

    public List<PublicUser> listFriends(long me) throws SQLException {
        List<PublicUser> out = new ArrayList<>();
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT u.id, COALESCE(u.public_id, u.username) AS public_id, u.username, u.display_name, u.avatar_url, u.cover_url, u.bio, (UNIX_TIMESTAMP(u.created_at) * 1000) AS created_ms, COALESCE(u.last_seen_at, 0) AS last_seen_ms " +
                             "FROM friendships f JOIN users u ON u.id = IF(f.user_a_id = ?, f.user_b_id, f.user_a_id) " +
                             "WHERE f.user_a_id = ? OR f.user_b_id = ? ORDER BY u.display_name, u.username")) {
            p.setLong(1, me);
            p.setLong(2, me);
            p.setLong(3, me);
            try (ResultSet rs = p.executeQuery()) {
                while (rs.next()) {
                    out.add(rowPublicUser(rs));
                }
            }
        }
        return out;
    }

    public List<SentRequestRow> listSentRequests(long me) throws SQLException {
        List<SentRequestRow> out = new ArrayList<>();
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT fr.id AS fr_id, u.id AS user_id, COALESCE(u.public_id, u.username) AS public_id, u.username, u.display_name, u.avatar_url, " +
                             "(UNIX_TIMESTAMP(fr.created_at) * 1000) AS created_ms " +
                             "FROM friend_requests fr JOIN users u ON u.id = fr.to_user_id " +
                             "WHERE fr.from_user_id = ? AND fr.status = 'pending' ORDER BY fr.created_at DESC")) {
            p.setLong(1, me);
            try (ResultSet rs = p.executeQuery()) {
                while (rs.next()) {
                    out.add(new SentRequestRow(
                            rs.getLong("fr_id"),
                            rs.getLong("user_id"),
                            rs.getString("public_id"),
                            rs.getString("username"),
                            rs.getString("display_name"),
                            rs.getString("avatar_url"),
                            rs.getLong("created_ms")));
                }
            }
        }
        return out;
    }

    public boolean unfriend(long me, long otherId) throws SQLException {
        long a = Math.min(me, otherId);
        long b = Math.max(me, otherId);
        try (Connection c = ds.getConnection()) {
            c.setAutoCommit(false);
            try {
                boolean deleted;
                try (PreparedStatement p = c.prepareStatement(
                        "DELETE FROM friendships WHERE user_a_id = ? AND user_b_id = ?")) {
                    p.setLong(1, a);
                    p.setLong(2, b);
                    deleted = p.executeUpdate() > 0;
                }
                try (PreparedStatement p = c.prepareStatement(
                        "UPDATE friend_requests SET status = 'declined', responded_at = NOW() " +
                        "WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)")) {
                    p.setLong(1, me);
                    p.setLong(2, otherId);
                    p.setLong(3, otherId);
                    p.setLong(4, me);
                    p.executeUpdate();
                }
                c.commit();
                return deleted;
            } catch (SQLException e) {
                c.rollback();
                throw e;
            } finally {
                c.setAutoCommit(true);
            }
        }
    }

    public List<SuggestionRow> listSuggestions(long me) throws SQLException {
        Set<Long> myFriends = new HashSet<>();
        for (PublicUser u : listFriends(me)) {
            myFriends.add(u.id());
        }

        Set<Long> pendingUsers = new HashSet<>();
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT to_user_id FROM friend_requests WHERE from_user_id = ? AND status = 'pending' " +
                     "UNION SELECT from_user_id FROM friend_requests WHERE to_user_id = ? AND status = 'pending'")) {
            p.setLong(1, me);
            p.setLong(2, me);
            try (ResultSet rs = p.executeQuery()) {
                while (rs.next()) {
                    pendingUsers.add(rs.getLong(1));
                }
            }
        }

        Map<Long, Integer> candidateSharedRooms = new HashMap<>();
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT rm2.user_id, COUNT(DISTINCT rm2.room_id) AS shared_cnt " +
                     "FROM room_members rm1 " +
                     "JOIN room_members rm2 ON rm1.room_id = rm2.room_id " +
                     "WHERE rm1.user_id = ? AND rm2.user_id != ? " +
                     "GROUP BY rm2.user_id")) {
            p.setLong(1, me);
            p.setLong(2, me);
            try (ResultSet rs = p.executeQuery()) {
                while (rs.next()) {
                    long uid = rs.getLong(1);
                    if (uid != me && !myFriends.contains(uid) && !pendingUsers.contains(uid)) {
                        candidateSharedRooms.put(uid, rs.getInt(2));
                    }
                }
            }
        }

        Map<Long, Integer> candidateMutualFriends = new HashMap<>();
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT IF(f.user_a_id = my_friend.fid, f.user_b_id, f.user_a_id) AS fof_id, COUNT(*) AS cnt " +
                     "FROM friendships f " +
                     "JOIN (SELECT IF(user_a_id = ?, user_b_id, user_a_id) AS fid FROM friendships WHERE user_a_id = ? OR user_b_id = ?) my_friend " +
                     "  ON (f.user_a_id = my_friend.fid OR f.user_b_id = my_friend.fid) " +
                     "WHERE f.user_a_id != ? AND f.user_b_id != ? " +
                     "GROUP BY fof_id")) {
            p.setLong(1, me);
            p.setLong(2, me);
            p.setLong(3, me);
            p.setLong(4, me);
            p.setLong(5, me);
            try (ResultSet rs = p.executeQuery()) {
                while (rs.next()) {
                    long uid = rs.getLong("fof_id");
                    if (uid != me && !myFriends.contains(uid) && !pendingUsers.contains(uid)) {
                        candidateMutualFriends.put(uid, rs.getInt("cnt"));
                    }
                }
            }
        }

        Set<Long> allCandidates = new HashSet<>();
        allCandidates.addAll(candidateSharedRooms.keySet());
        allCandidates.addAll(candidateMutualFriends.keySet());

        if (allCandidates.isEmpty()) {
            return Collections.emptyList();
        }

        List<Long> sortedCandidateIds = new ArrayList<>(allCandidates);
        sortedCandidateIds.sort((a, b) -> {
            int mComp = Integer.compare(candidateMutualFriends.getOrDefault(b, 0), candidateMutualFriends.getOrDefault(a, 0));
            if (mComp != 0) return mComp;
            int rComp = Integer.compare(candidateSharedRooms.getOrDefault(b, 0), candidateSharedRooms.getOrDefault(a, 0));
            if (rComp != 0) return rComp;
            return Long.compare(a, b);
        });

        if (sortedCandidateIds.size() > 50) {
            sortedCandidateIds = sortedCandidateIds.subList(0, 50);
        }

        List<SuggestionRow> out = new ArrayList<>();
        for (Long uid : sortedCandidateIds) {
            Optional<PublicUser> pu = findUserById(uid);
            if (pu.isPresent()) {
                PublicUser u = pu.get();
                out.add(new SuggestionRow(
                        u.id(),
                        u.publicId(),
                        u.username(),
                        u.displayName() == null ? u.username() : u.displayName(),
                        u.avatar() == null ? "" : u.avatar(),
                        candidateMutualFriends.getOrDefault(uid, 0),
                        candidateSharedRooms.getOrDefault(uid, 0)
                ));
            }
        }
        return out;
    }

    public List<FriendRequestRow> listRequests(long me) throws SQLException {
        List<FriendRequestRow> out = new ArrayList<>();
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT fr.id AS fr_id, u.id AS user_id, COALESCE(u.public_id, u.username) AS public_id, u.username, u.display_name, u.avatar_url, " +
                             "(UNIX_TIMESTAMP(fr.created_at) * 1000) AS created_ms " +
                             "FROM friend_requests fr JOIN users u ON u.id = fr.from_user_id " +
                             "WHERE fr.to_user_id = ? AND fr.status = 'pending' ORDER BY fr.created_at DESC")) {
            p.setLong(1, me);
            try (ResultSet rs = p.executeQuery()) {
                while (rs.next()) {
                    out.add(new FriendRequestRow(
                            rs.getLong("fr_id"),
                            rs.getLong("user_id"),
                            rs.getString("public_id"),
                            rs.getString("username"),
                            rs.getString("display_name"),
                            rs.getString("avatar_url"),
                            rs.getLong("created_ms")));
                }
            }
        }
        return out;
    }

    private static String frStatus(Connection c, long from, long to) throws SQLException {
        try (PreparedStatement p = c.prepareStatement(
                "SELECT status FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? LIMIT 1")) {
            p.setLong(1, from);
            p.setLong(2, to);
            try (ResultSet rs = p.executeQuery()) {
                if (!rs.next()) {
                    return null;
                }
                return rs.getString(1);
            }
        }
    }

    private static void markFrStatus(Connection c, long from, long to, String status) throws SQLException {
        try (PreparedStatement p = c.prepareStatement(
                "UPDATE friend_requests SET status = ? WHERE from_user_id = ? AND to_user_id = ?")) {
            p.setString(1, status);
            p.setLong(2, from);
            p.setLong(3, to);
            p.executeUpdate();
        }
    }

    private static void markFrStatusIfPending(Connection c, long from, long to, String status) throws SQLException {
        try (PreparedStatement p = c.prepareStatement(
                "UPDATE friend_requests SET status = ? WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'")) {
            p.setString(1, status);
            p.setLong(2, from);
            p.setLong(3, to);
            p.executeUpdate();
        }
    }

    // ---------- má»i phĂ²ng (room_invites) + tham gia phĂ²ng ----------

    /** Láº¥y mĂ£ má»i Ä‘ang hiá»‡u lá»±c cá»§a chá»§ phĂ²ng, khĂ´ng cĂ³ thĂ¬ táº¡o má»›i. */
    public String createInviteCode(long roomId, long createdBy, int ttlDays) throws SQLException {
        try (Connection c = ds.getConnection()) {
            try (PreparedStatement p = c.prepareStatement(
                    "SELECT invite_code FROM room_invites " +
                            "WHERE room_id = ? AND created_by = ? AND (expires_at IS NULL OR expires_at > NOW()) " +
                            "ORDER BY created_at DESC LIMIT 1")) {
                p.setLong(1, roomId);
                p.setLong(2, createdBy);
                try (ResultSet rs = p.executeQuery()) {
                    if (rs.next()) {
                        return rs.getString(1);
                    }
                }
            }
            for (int attempt = 0; attempt < 20; attempt++) {
                String code = Base62.random(12);
                if (!inviteCodeExists(code)) {
                    try (PreparedStatement p = c.prepareStatement(
                            "INSERT INTO room_invites (room_id, invite_code, created_by, expires_at) " +
                                    "VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))")) {
                        p.setLong(1, roomId);
                        p.setString(2, code);
                        p.setLong(3, createdBy);
                        p.setInt(4, ttlDays);
                        p.executeUpdate();
                    }
                    return code;
                }
            }
            throw new SQLException("KhĂ´ng táº¡o Ä‘Æ°á»£c mĂ£ má»i: háº¿t phÆ°Æ¡ng Ă¡n");
        }
    }

    private boolean inviteCodeExists(String code) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT 1 FROM room_invites WHERE invite_code = ? LIMIT 1")) {
            p.setString(1, code);
            try (ResultSet rs = p.executeQuery()) {
                return rs.next();
            }
        }
    }

    /** Tham gia phĂ²ng báº±ng mĂ£ má»i: khoĂ¡ dĂ²ng room (SELECT ... FOR UPDATE) khi kiá»ƒm tra max_members. */
    public JoinResult joinRoomByInvite(String code, long userId) throws SQLException {
        try (Connection c = ds.getConnection()) {
            c.setAutoCommit(false);
            try {
                long roomId;
                boolean expired = false;
                try (PreparedStatement p = c.prepareStatement(
                        "SELECT room_id, (expires_at IS NOT NULL AND expires_at <= NOW()) AS expired " +
                                "FROM room_invites WHERE invite_code = ? LIMIT 1")) {
                    p.setString(1, code);
                    try (ResultSet rs = p.executeQuery()) {
                        if (!rs.next()) {
                            c.rollback();
                            return just(JoinOutcome.INVITE_NOT_FOUND);
                        }
                        roomId = rs.getLong("room_id");
                        expired = rs.getBoolean("expired");
                    }
                }
                if (expired) {
                    c.rollback();
                    return just(JoinOutcome.INVITE_EXPIRED);
                }
                JoinOutcome added;
                try {
                    added = addMemberChecked(c, roomId, userId);
                } catch (SQLIntegrityConstraintViolationException e) {
                    // Race: má»™t request khĂ¡c cá»§a cĂ¹ng user Ä‘Ă£ insert member trÆ°á»›c.
                    // Coi nhÆ° Ä‘Ă£ lĂ  thĂ nh viĂªn thay vĂ¬ tráº£ 500.
                    c.rollback();
                    return new JoinResult(JoinOutcome.ALREADY_MEMBER, roomId);
                }
                c.commit();
                return new JoinResult(added, roomId);
            } catch (SQLException e) {
                c.rollback();
                throw e;
            } finally {
                c.setAutoCommit(true);
            }
        }
    }

    /** Má»i báº¡n (id) vĂ o phĂ²ng: pháº£i lĂ  báº¡n bĂ¨, khoĂ¡ room khi kiá»ƒm tra sá»©c chá»©a. */
    public JoinResult inviteFriendToRoom(long me, long roomId, long friendId) throws SQLException {
        if (!areFriends(me, friendId)) {
            return just(JoinOutcome.NOT_FRIEND);
        }
        try (Connection c = ds.getConnection()) {
            c.setAutoCommit(false);
            try {
                JoinOutcome added;
                try {
                    added = addMemberChecked(c, roomId, friendId);
                } catch (SQLIntegrityConstraintViolationException e) {
                    c.rollback();
                    return new JoinResult(JoinOutcome.ALREADY_MEMBER, roomId);
                }
                c.commit();
                return new JoinResult(added, roomId);
            } catch (SQLException e) {
                c.rollback();
                throw e;
            } finally {
                c.setAutoCommit(true);
            }
        }
    }

    /** Kiá»ƒm tra + thĂªm member trong transaction cá»§a caller (con gá»i addMemberChecked pháº£i tá»± commit). */
    private static JoinOutcome addMemberChecked(Connection c, long roomId, long userId) throws SQLException {
        long maxMembers;
        try (PreparedStatement p = c.prepareStatement(
                "SELECT max_members FROM rooms WHERE id = ? FOR UPDATE")) {
            p.setLong(1, roomId);
            try (ResultSet rs = p.executeQuery()) {
                if (!rs.next()) {
                    return JoinOutcome.ROOM_NOT_FOUND;
                }
                maxMembers = rs.getLong(1);
            }
        }
        try (PreparedStatement p = c.prepareStatement(
                "SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ? AND left_at IS NULL LIMIT 1")) {
            p.setLong(1, roomId);
            p.setLong(2, userId);
            try (ResultSet rs = p.executeQuery()) {
                if (rs.next()) {
                    return JoinOutcome.ALREADY_MEMBER;
                }
            }
        }
        long count;
        try (PreparedStatement p = c.prepareStatement(
                "SELECT COUNT(*) FROM room_members WHERE room_id = ? AND left_at IS NULL AND banned_at IS NULL")) {
            p.setLong(1, roomId);
            try (ResultSet rs = p.executeQuery()) {
                rs.next();
                count = rs.getLong(1);
            }
        }
        if (count >= maxMembers) {
            return JoinOutcome.ROOM_FULL;
        }
        try (PreparedStatement p = c.prepareStatement(
                "INSERT INTO room_members (room_id, user_id, room_role) VALUES (?, ?, 'member') " +
                "ON DUPLICATE KEY UPDATE left_at = NULL, banned_at = NULL, joined_at = CURRENT_TIMESTAMP")) {
            p.setLong(1, roomId);
            p.setLong(2, userId);
            p.executeUpdate();
        }
        return JoinOutcome.JOINED;
    }

    // ---------- helpers ----------

    private static PublicUser rowPublicUser(ResultSet rs) throws SQLException {
        String cover = null;
        String bio = null;
        try {
            cover = rs.getString("cover_url");
        } catch (Exception ignored) {}
        try {
            bio = rs.getString("bio");
        } catch (Exception ignored) {}
        return new PublicUser(
                rs.getLong("id"),
                rs.getString("public_id"),
                rs.getString("username"),
                rs.getString("display_name"),
                rs.getString("avatar_url"),
                rs.getLong("created_ms"),
                rs.getLong("last_seen_ms"),
                cover,
                bio);
    }
}