package com.workchat.peer.offline;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.sql.Connection;
import java.nio.file.Files;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * CSDL cục bộ (SQLite) của PeerCore: lịch sử tin nhắn đã giải mã và hộp thư đi
 * (outbox) chứa các phong bì E2E chưa được người nhận xác nhận.
 *
 * <p>Theo "Hướng A": lịch sử hội thoại nằm HOÀN TOÀN cục bộ; server chỉ giữ hộp
 * thư tin chưa giao. Outbox cục bộ là nguồn sự thật để thử lại khi mất mạng.
 *
 * <p>Bảo mật khi lưu (mục "mã hoá SQLite"): cột {@code plaintext} của {@code local_msg}
 * được mã hóa AES-256-GCM bằng {@code dbKey} lấy từ {@link E2eKeystore} (mở khóa bằng
 * passphrase E2E). Bản ghi cũ dạng thô (không có tiền tố {@code "e1:"}) vẫn đọc được —
 * tương thích ngược. Khi kho bị khóa, không giải mã được và trả về {@code null}.
 */
public final class OfflineStore implements AutoCloseable {
    private static final String ENC_PREFIX = "e1:";
    private static final int GCM_TAG_BITS = 128;
    private static final SecureRandom RNG = new SecureRandom();

    /** Một tin nhắn đã giải mã, lưu cục bộ. direction: "out" | "in". */
    public record LocalMsg(String clientMsgId, long roomId, long senderId, String contentType,
                           String plaintext, long sentAt, String direction, String status,
                           String replyToClientId) {
        public LocalMsg(String clientMsgId, long roomId, long senderId, String contentType,
                        String plaintext, long sentAt, String direction, String status) {
            this(clientMsgId, roomId, senderId, contentType, plaintext, sentAt, direction, status, null);
        }
    }

    /** Một phong bì trong outbox. state: pending | stored | acked | failed. */
    public record OutboxEnvelope(long id, String clientMsgId, long roomId, long recipientId,
                                 String algo, String ivB64, String wrappedKeyB64, String signatureB64,
                                 String ciphertextB64, long sentAt, String state, int attempts) {
    }

    private final Connection conn;
    /** Khóa AES-256 để mã hóa cột plaintext; null khi kho E2E chưa mở khóa. */
    private volatile byte[] dbKey;
    /** Cache lịch sử đã giải mã (mục "cache 5c") — giảm đọc/giải mã lặp lại. */
    private final Map<String, List<LocalMsg>> histCache = new LinkedHashMap<>(16, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, List<LocalMsg>> eldest) {
            return size() > 8;
        }
    };

    public OfflineStore(Path file) {
        try {
            Files.createDirectories(file.toAbsolutePath().getParent());
            this.conn = DriverManager.getConnection("jdbc:sqlite:" + file.toAbsolutePath());
            init();
        } catch (Exception e) {
            throw new IllegalStateException("mở SQLite thất bại: " + e.getMessage(), e);
        }
    }

    private void init() throws SQLException {
        try (Statement st = conn.createStatement()) {
            st.execute("PRAGMA journal_mode=WAL");
            st.execute("PRAGMA busy_timeout=5000");
            st.execute("CREATE TABLE IF NOT EXISTS local_msg (" +
                    "client_msg_id TEXT PRIMARY KEY," +
                    "room_id INTEGER NOT NULL," +
                    "sender_id INTEGER NOT NULL," +
                    "content_type TEXT NOT NULL DEFAULT 'text'," +
                    "plaintext TEXT," +
                    "sent_at INTEGER NOT NULL," +
                    "direction TEXT NOT NULL DEFAULT 'out'," +
                    "status TEXT NOT NULL DEFAULT 'sent'," +
                    "reply_to_client_id TEXT)");
            try {
                st.execute("ALTER TABLE local_msg ADD COLUMN reply_to_client_id TEXT");
            } catch (SQLException ignored) {
            }
            st.execute("CREATE INDEX IF NOT EXISTS idx_local_room ON local_msg(room_id, sent_at)");
            st.execute("CREATE TABLE IF NOT EXISTS outbox (" +
                    "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                    "client_msg_id TEXT NOT NULL," +
                    "room_id INTEGER NOT NULL," +
                    "recipient_id INTEGER NOT NULL," +
                    "algo TEXT NOT NULL," +
                    "iv TEXT NOT NULL," +
                    "wrapped_key TEXT NOT NULL," +
                    "signature TEXT NOT NULL," +
                    "ciphertext TEXT NOT NULL," +
                    "sent_at INTEGER NOT NULL," +
                    "state TEXT NOT NULL DEFAULT 'pending'," +
                    "attempts INTEGER NOT NULL DEFAULT 0," +
                    "created_at INTEGER NOT NULL," +
                    "UNIQUE(client_msg_id, recipient_id))");
            st.execute("CREATE INDEX IF NOT EXISTS idx_outbox_state ON outbox(state, id)");
        }
    }

    /**
     * Đặt khóa mã hóa cột plaintext (gọi khi mở khóa kho E2E). Truyền {@code null} để xóa
     * (khi kho bị khóa / đăng xuất).
     */
    public synchronized void setDbKey(byte[] key) {
        this.dbKey = (key == null || key.length != 32) ? null : key.clone();
        histCache.clear();
    }

    private String enc(String plaintext) {
        byte[] key = this.dbKey;
        if (key == null || plaintext == null) {
            return plaintext;
        }
        try {
            byte[] iv = new byte[12];
            RNG.nextBytes(iv);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(GCM_TAG_BITS, iv));
            byte[] ct = c.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            ByteBuffer bb = ByteBuffer.allocate(iv.length + ct.length).put(iv).put(ct);
            return ENC_PREFIX + Base64.getEncoder().encodeToString(bb.array());
        } catch (Exception e) {
            throw new IllegalStateException("sqlite encrypt", e);
        }
    }

    private String dec(String stored) {
        if (stored == null || !stored.startsWith(ENC_PREFIX)) {
            return stored;
        }
        byte[] key = this.dbKey;
        if (key == null) {
            return null;
        }
        try {
            byte[] all = Base64.getDecoder().decode(stored.substring(ENC_PREFIX.length()));
            ByteBuffer bb = ByteBuffer.wrap(all);
            byte[] iv = new byte[12];
            bb.get(iv);
            byte[] ct = new byte[bb.remaining()];
            bb.get(ct);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(GCM_TAG_BITS, iv));
            return new String(c.doFinal(ct), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }

    public synchronized void saveLocal(LocalMsg m) {
        // COALESCE: không ghi đè ciphertext đang có bằng plaintext null (khoá E2E đang khoá
        // hoặc bản ghi mới thiếu nội dung) để tránh làm mất vĩnh viễn tin đã giải mã.
        String sql = "INSERT INTO local_msg(client_msg_id,room_id,sender_id,content_type,plaintext,sent_at,direction,status,reply_to_client_id) " +
                "VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(client_msg_id) DO UPDATE SET " +
                "plaintext=COALESCE(excluded.plaintext, local_msg.plaintext), status=excluded.status, " +
                "reply_to_client_id=COALESCE(excluded.reply_to_client_id, local_msg.reply_to_client_id)";
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, m.clientMsgId());
            ps.setLong(2, m.roomId());
            ps.setLong(3, m.senderId());
            ps.setString(4, m.contentType());
            ps.setString(5, enc(m.plaintext()));
            ps.setLong(6, m.sentAt());
            ps.setString(7, m.direction());
            ps.setString(8, m.status());
            ps.setString(9, m.replyToClientId());
            ps.executeUpdate();
            histCache.clear();
        } catch (SQLException e) {
            throw new IllegalStateException("sqlite saveLocal", e);
        }
    }

    /**
     * Cập nhật nội dung đã giải mã của một tin cục bộ (dùng khi SỬA tin): chỉ ghi đè
     * plaintext, giữ nguyên hướng/thời điểm/loại nội dung. Trả số dòng cập nhật.
     */
    public synchronized int updateLocalText(String clientMsgId, String plaintext) {
        try (PreparedStatement ps = conn.prepareStatement(
                "UPDATE local_msg SET plaintext=? WHERE client_msg_id=?")) {
            ps.setString(1, enc(plaintext));
            ps.setString(2, clientMsgId);
            int n = ps.executeUpdate();
            histCache.clear();
            return n;
        } catch (SQLException e) {
            throw new IllegalStateException("sqlite updateLocalText", e);
        }
    }

    /**
     * Cập nhật trạng thái thu hồi của tin cục bộ: đặt status='recalled', xoá plaintext.
     */
    public synchronized int updateLocalRecalled(String clientMsgId) {
        try (PreparedStatement ps = conn.prepareStatement(
                "UPDATE local_msg SET status='recalled', plaintext='' WHERE client_msg_id=?")) {
            ps.setString(1, clientMsgId);
            int n = ps.executeUpdate();
            histCache.clear();
            return n;
        } catch (SQLException e) {
            throw new IllegalStateException("sqlite updateLocalRecalled", e);
        }
    }

    /** Cập nhật trạng thái gửi của một tin đi ("stored" đang chờ | "sent" đã gửi). */
    public synchronized int setLocalStatus(String clientMsgId, String status) {
        try (PreparedStatement ps = conn.prepareStatement(
                "UPDATE local_msg SET status=? WHERE client_msg_id=?")) {
            ps.setString(1, status);
            ps.setString(2, clientMsgId);
            int n = ps.executeUpdate();
            histCache.clear();
            return n;
        } catch (SQLException e) {
            throw new IllegalStateException("sqlite setLocalStatus", e);
        }
    }

    /** Đọc một tin cục bộ theo client_msg_id (null nếu không có). */
    public synchronized LocalMsg localMsg(String clientMsgId) {
        try (PreparedStatement ps = conn.prepareStatement(
                "SELECT client_msg_id,room_id,sender_id,content_type,plaintext,sent_at,direction,status,reply_to_client_id " +
                        "FROM local_msg WHERE client_msg_id=?")) {
            ps.setString(1, clientMsgId);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    return null;
                }
                return new LocalMsg(
                        rs.getString("client_msg_id"), rs.getLong("room_id"), rs.getLong("sender_id"),
                        rs.getString("content_type"), dec(rs.getString("plaintext")), rs.getLong("sent_at"),
                        rs.getString("direction"), rs.getString("status"), rs.getString("reply_to_client_id"));
            }
        } catch (SQLException e) {
            throw new IllegalStateException("sqlite localMsg", e);
        }
    }

    public synchronized void savePending(OutboxEnvelope e) {
        String sql = "INSERT INTO outbox(client_msg_id,room_id,recipient_id,algo,iv,wrapped_key,signature," +
                "ciphertext,sent_at,state,attempts,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) " +
                "ON CONFLICT(client_msg_id,recipient_id) DO NOTHING";
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, e.clientMsgId());
            ps.setLong(2, e.roomId());
            ps.setLong(3, e.recipientId());
            ps.setString(4, e.algo());
            ps.setString(5, e.ivB64());
            ps.setString(6, e.wrappedKeyB64());
            ps.setString(7, e.signatureB64());
            ps.setString(8, e.ciphertextB64());
            ps.setLong(9, e.sentAt());
            ps.setString(10, e.state() == null ? "pending" : e.state());
            ps.setInt(11, e.attempts());
            ps.setLong(12, System.currentTimeMillis());
            ps.executeUpdate();
        } catch (SQLException ex) {
            throw new IllegalStateException("sqlite savePending", ex);
        }
    }

    /** Phong bì còn chờ giao (pending/stored), cũ trước. */
    public synchronized List<OutboxEnvelope> pending(int limit) {
        String sql = "SELECT id,client_msg_id,room_id,recipient_id,algo,iv,wrapped_key,signature," +
                "ciphertext,sent_at,state,attempts FROM outbox WHERE state IN('pending','stored') " +
                "ORDER BY id LIMIT ?";
        List<OutboxEnvelope> out = new ArrayList<>();
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setInt(1, Math.max(1, limit));
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    out.add(new OutboxEnvelope(
                            rs.getLong("id"), rs.getString("client_msg_id"), rs.getLong("room_id"),
                            rs.getLong("recipient_id"), rs.getString("algo"), rs.getString("iv"),
                            rs.getString("wrapped_key"), rs.getString("signature"), rs.getString("ciphertext"),
                            rs.getLong("sent_at"), rs.getString("state"), rs.getInt("attempts")));
                }
            }
        } catch (SQLException e) {
            throw new IllegalStateException("sqlite pending", e);
        }
        return out;
    }

    /** Đổi trạng thái một phong bì (vd stored/acked/failed). */
    public synchronized void setState(String clientMsgId, long recipientId, String state) {
        try (PreparedStatement ps = conn.prepareStatement(
                "UPDATE outbox SET state=? WHERE client_msg_id=? AND recipient_id=?")) {
            ps.setString(1, state);
            ps.setString(2, clientMsgId);
            ps.setLong(3, recipientId);
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException("sqlite setState", e);
        }
    }

    /** Tăng số lần thử và (tuỳ chọn) cập nhật state. */
    public synchronized void bumpAttempt(String clientMsgId, long recipientId, String state) {
        try (PreparedStatement ps = conn.prepareStatement(
                "UPDATE outbox SET attempts=attempts+1, state=? WHERE client_msg_id=? AND recipient_id=?")) {
            ps.setString(1, state);
            ps.setString(2, clientMsgId);
            ps.setLong(3, recipientId);
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException("sqlite bumpAttempt", e);
        }
    }

    public synchronized int count(String state) {
        try (PreparedStatement ps = conn.prepareStatement("SELECT COUNT(*) FROM outbox WHERE state=?")) {
            ps.setString(1, state);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getInt(1) : 0;
            }
        } catch (SQLException e) {
            throw new IllegalStateException("sqlite count", e);
        }
    }

    /** Lịch sử một phòng, mới nhất trước, giới hạn. Kết quả được cache (mục "cache 5c"). */
    public synchronized List<LocalMsg> history(long roomId, int limit) {
        String key = roomId + ":" + limit;
        List<LocalMsg> cached = histCache.get(key);
        if (cached != null) {
            return cached;
        }
        List<LocalMsg> out = new ArrayList<>();
        try (PreparedStatement ps = conn.prepareStatement(
                "SELECT client_msg_id,room_id,sender_id,content_type,plaintext,sent_at,direction,status,reply_to_client_id " +
                        "FROM local_msg WHERE room_id=? ORDER BY sent_at DESC LIMIT ?")) {
            ps.setLong(1, roomId);
            ps.setInt(2, Math.max(1, limit));
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    out.add(new LocalMsg(
                            rs.getString("client_msg_id"), rs.getLong("room_id"), rs.getLong("sender_id"),
                            rs.getString("content_type"), dec(rs.getString("plaintext")), rs.getLong("sent_at"),
                            rs.getString("direction"), rs.getString("status"), rs.getString("reply_to_client_id")));
                }
            }
        } catch (SQLException e) {
            throw new IllegalStateException("sqlite history", e);
        }
        histCache.put(key, out);
        return out;
    }

    /** Trang lịch sử cũ hơn con trỏ (mới nhất trước), dùng cho phân trang kéo lên. */
    public synchronized List<LocalMsg> historyBefore(long roomId, long beforeSentAt, int limit) {
        List<LocalMsg> out = new ArrayList<>();
        try (PreparedStatement ps = conn.prepareStatement(
                "SELECT client_msg_id,room_id,sender_id,content_type,plaintext,sent_at,direction,status,reply_to_client_id " +
                        "FROM local_msg WHERE room_id=? AND sent_at < ? ORDER BY sent_at DESC LIMIT ?")) {
            ps.setLong(1, roomId);
            ps.setLong(2, beforeSentAt);
            ps.setInt(3, Math.max(1, limit));
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    out.add(new LocalMsg(
                            rs.getString("client_msg_id"), rs.getLong("room_id"), rs.getLong("sender_id"),
                            rs.getString("content_type"), dec(rs.getString("plaintext")), rs.getLong("sent_at"),
                            rs.getString("direction"), rs.getString("status"), rs.getString("reply_to_client_id")));
                }
            }
        } catch (SQLException e) {
            throw new IllegalStateException("sqlite historyBefore", e);
        }
        return out;
    }

    /** Còn tin cũ hơn mốc con trỏ không? */
    public synchronized boolean hasMoreBefore(long roomId, long beforeSentAt) {
        try (PreparedStatement ps = conn.prepareStatement(
                "SELECT 1 FROM local_msg WHERE room_id=? AND sent_at < ? LIMIT 1")) {
            ps.setLong(1, roomId);
            ps.setLong(2, beforeSentAt);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next();
            }
        } catch (SQLException e) {
            throw new IllegalStateException("sqlite hasMoreBefore", e);
        }
    }

    @Override
    public synchronized void close() {
        try {
            conn.close();
        } catch (SQLException ignored) {
        }
    }
}
