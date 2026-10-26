package com.workchat.tracker.db;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

/**
 * Hộp thư ngoại tuyến: mỗi dòng message_cache là một PHONG BÌ ĐÃ MÃ HÓA cho đúng
 * một người nhận. Server không đọc được nội dung. Vòng đời:
 *   store (ghi) → pull (người nhận kéo) → ack (người nhận xác nhận, XÓA khỏi server).
 * Tin chưa ack sẽ được giữ tới khi hết expires_at (lưới an toàn TTL).
 */
public final class OfflineDao {
    private final DataSource ds;

    public OfflineDao(DataSource ds) {
        this.ds = ds;
    }

    /** Một phong bì client gửi lên để lưu cho một người nhận. */
    public record StoreEnvelope(long recipientId, String algo, byte[] iv, byte[] wrappedKey,
                                byte[] signature, byte[] ciphertext) {
    }

    /** Một phong bì đọc ra từ hộp thư để trả cho client. */
    public record EnvelopeRow(long id, String clientMsgId, long roomId, long senderId, long recipientId,
                              String contentType, String algo, byte[] iv, byte[] wrappedKey,
                              byte[] signature, byte[] ciphertext, long sentAtMs,
                              boolean isEdited, Long editedAtMs) {
        public EnvelopeRow(long id, String clientMsgId, long roomId, long senderId, long recipientId,
                           String contentType, String algo, byte[] iv, byte[] wrappedKey,
                           byte[] signature, byte[] ciphertext, long sentAtMs) {
            this(id, clientMsgId, roomId, senderId, recipientId, contentType, algo, iv, wrappedKey,
                    signature, ciphertext, sentAtMs, false, null);
        }
    }

    /** Số phong bì chưa giao đang chờ cho một người nhận. */
    public int countPending(long recipientId) throws SQLException {
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(
                     "SELECT COUNT(*) FROM message_cache WHERE recipient_id = ? AND delivered_at IS NULL")) {
            p.setLong(1, recipientId);
            try (ResultSet rs = p.executeQuery()) {
                rs.next();
                return rs.getInt(1);
            }
        }
    }

    /**
     * Ghi tất cả phong bì cho một tin. Idempotent theo (client_msg_id, recipient_id):
     * gọi lại sẽ cập nhật lại ciphertext thay vì tạo dòng trùng. Trả về số dòng ghi mới.
     */
    public int store(long roomId, long senderId, String clientMsgId, String contentType,
                     Long sentAtMs, int ttlDays, List<StoreEnvelope> envs) throws SQLException {
        if (envs.isEmpty()) {
            return 0;
        }
        String sql = "INSERT INTO message_cache "
                + "(client_msg_id, room_id, sender_id, recipient_id, content_type, algo, iv, wrapped_key, signature, ciphertext, sent_at, expires_at) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "
                + (sentAtMs == null ? "CURRENT_TIMESTAMP" : "FROM_UNIXTIME(? / 1000)")
                + ", DATE_ADD(NOW(), INTERVAL ? DAY)) "
                + "ON DUPLICATE KEY UPDATE content_type = VALUES(content_type), algo = VALUES(algo), "
                + "iv = VALUES(iv), wrapped_key = VALUES(wrapped_key), signature = VALUES(signature), "
                + "ciphertext = VALUES(ciphertext), sent_at = VALUES(sent_at)";
        try (Connection c = ds.getConnection()) {
            c.setAutoCommit(false);
            try {
                int inserted = 0;
                try (PreparedStatement p = c.prepareStatement(sql)) {
                    for (StoreEnvelope e : envs) {
                        int i = 1;
                        p.setString(i++, clientMsgId);
                        p.setLong(i++, roomId);
                        p.setLong(i++, senderId);
                        p.setLong(i++, e.recipientId());
                        p.setString(i++, contentType);
                        p.setString(i++, e.algo());
                        p.setBytes(i++, e.iv());
                        p.setBytes(i++, e.wrappedKey());
                        p.setBytes(i++, e.signature());
                        p.setBytes(i++, e.ciphertext());
                        if (sentAtMs != null) {
                            p.setLong(i++, sentAtMs);
                        }
                        p.setInt(i++, ttlDays);
                        inserted += p.executeUpdate() == 1 ? 1 : 0;
                    }
                }
                c.commit();
                return inserted;
            } catch (SQLException e) {
                c.rollback();
                throw e;
            } finally {
                c.setAutoCommit(true);
            }
        }
    }

    /** Kéo các phong bì chưa giao có id &gt; afterId (tăng dần). */
    public List<EnvelopeRow> pull(long recipientId, long afterId, int limit) throws SQLException {
        String sql = "SELECT mc.id, mc.client_msg_id, mc.room_id, mc.sender_id, mc.recipient_id, mc.content_type, mc.algo, "
                + "mc.iv, mc.wrapped_key, mc.signature, mc.ciphertext, (UNIX_TIMESTAMP(mc.sent_at) * 1000) AS sent_ms, "
                + "mm.is_edited, (UNIX_TIMESTAMP(mm.edited_at) * 1000) AS edited_ms "
                + "FROM message_cache mc "
                + "LEFT JOIN message_meta mm ON mc.client_msg_id = mm.client_msg_id "
                + "WHERE mc.recipient_id = ? AND mc.delivered_at IS NULL AND mc.id > ? "
                + "ORDER BY mc.id ASC LIMIT ?";
        List<EnvelopeRow> out = new ArrayList<>();
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(sql)) {
            p.setLong(1, recipientId);
            p.setLong(2, afterId);
            p.setInt(3, limit);
            try (ResultSet rs = p.executeQuery()) {
                while (rs.next()) {
                    boolean isEdited = rs.getBoolean("is_edited");
                    long edMs = rs.getLong("edited_ms");
                    Long editedAtMs = rs.wasNull() ? null : edMs;
                    out.add(new EnvelopeRow(
                            rs.getLong("id"),
                            rs.getString("client_msg_id"),
                            rs.getLong("room_id"),
                            rs.getLong("sender_id"),
                            rs.getLong("recipient_id"),
                            rs.getString("content_type"),
                            rs.getString("algo"),
                            rs.getBytes("iv"),
                            rs.getBytes("wrapped_key"),
                            rs.getBytes("signature"),
                            rs.getBytes("ciphertext"),
                            rs.getLong("sent_ms"),
                            isEdited,
                            editedAtMs
                    ));
                }
            }
        }
        return out;
    }

    /** Xác nhận đã nhận: XÓA các phong bì thuộc về người nhận này. Trả về số dòng đã xóa. */
    public int ack(long recipientId, List<Long> ids) throws SQLException {
        if (ids.isEmpty()) {
            return 0;
        }
        StringBuilder sb = new StringBuilder(
                "DELETE FROM message_cache WHERE recipient_id = ? AND id IN (");
        for (int i = 0; i < ids.size(); i++) {
            if (i > 0) {
                sb.append(",");
            }
            sb.append("?");
        }
        sb.append(")");
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement(sb.toString())) {
            p.setLong(1, recipientId);
            for (int i = 0; i < ids.size(); i++) {
                p.setLong(i + 2, ids.get(i));
            }
            return p.executeUpdate();
        }
    }

    /** Xác nhận thu hồi: XÓA các phong bì trong hàng đợi để người nhận sau này không kéo về. */
    public int deleteByClientMsgId(String clientMsgId) throws SQLException {
        if (clientMsgId == null || clientMsgId.isBlank()) {
            return 0;
        }
        try (Connection c = ds.getConnection();
             PreparedStatement p = c.prepareStatement("DELETE FROM message_cache WHERE client_msg_id = ?")) {
            p.setString(1, clientMsgId);
            return p.executeUpdate();
        }
    }
}
