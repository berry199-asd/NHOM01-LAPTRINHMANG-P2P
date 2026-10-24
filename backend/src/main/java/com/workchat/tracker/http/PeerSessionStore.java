package com.workchat.tracker.http;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import com.workchat.tracker.db.UserDao;

/**
 * Kho chìa phiên Peer Core (in-memory). Chìa này được cấp sau khi exchange thành công,
 * tồn tại song song với session HTTP của người dùng trong DB; có thể bị thu hồi khi logout.
 */
public final class PeerSessionStore {
    private static final SecureRandom RNG = new SecureRandom();
    private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();

    private record Entry(long userId, long expiresAt) {
    }

    private final Map<String, Entry> byKeyHash = new ConcurrentHashMap<>();
    private final UserDao dao;
    private final int sessionTtlDays;

    public PeerSessionStore(UserDao dao, int sessionTtlDays) {
        this.dao = dao;
        this.sessionTtlDays = sessionTtlDays;
    }

    public record PeerSession(String key, long userId, long expiresAtEpochSeconds) {
    }

    /** Sinh chìa phiên mới (256-bit) cho userId với hạn = hạn phiên đăng nhập. */
    public PeerSession issue(long userId) {
        sweep();
        byte[] buf = new byte[32];
        RNG.nextBytes(buf);
        String key = B64.encodeToString(buf);
        // hạn ~ sessionTtlDays * 86400s
        long ttlDays = sessionTtlDays <= 0 ? 1 : sessionTtlDays;
        long expiresAtMillis = System.currentTimeMillis() + ttlDays * 24L * 3600L * 1000L;
        byKeyHash.put(hash(key), new Entry(userId, expiresAtMillis));
        return new PeerSession(key, userId, expiresAtMillis / 1000L);
    }

    /** Kiểm tra chìa phiên; trả userId nếu hợp lệ còn hạn. */
    public Long validate(String key) {
        if (key == null || key.isBlank()) {
            return null;
        }
        String h = hash(key);
        Entry e = byKeyHash.get(h);
        if (e == null) {
            return null;
        }
        if (e.expiresAt() < System.currentTimeMillis()) {
            byKeyHash.remove(h, e);
            return null;
        }
        return e.userId();
    }

    /** Thu hồi toàn bộ chìa phiên của userId. */
    public void revokeUser(long userId) {
        byKeyHash.values().removeIf(e -> e.userId() == userId);
    }

    /** Thu hồi một chìa cụ thể. */
    public void revokeKey(String key) {
        if (key == null || key.isBlank()) {
            return;
        }
        byKeyHash.remove(hash(key));
    }

    private void sweep() {
        long now = System.currentTimeMillis();
        byKeyHash.values().removeIf(e -> e.expiresAt() < now);
    }

    private static String hash(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] d = md.digest(s.getBytes(StandardCharsets.UTF_8));
            return B64.encodeToString(d);
        } catch (Exception e) {
            return s;
        }
    }
}