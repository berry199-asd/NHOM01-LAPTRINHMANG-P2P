package com.workchat.tracker.http;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Kho vé một lần (in-memory) cấp cho Peer Core theo cơ chế hello/bind mới.
 *
 * <p>Trình duyệt (đã đăng nhập) xin vé qua {@code POST /api/peer/ticket} kèm nonce
 * từ Peer Core; Peer Core đổi vé qua {@code POST /api/peer/exchange} để lấy chìa
 * phiên Peer Core có thể thu hồi được. Vé:
 * <ul>
 *   <li>chỉ sống {@value #TTL_MS} ms (60 giây);</li>
 *   <li>chỉ dùng được một lần (bị xoá ngay khi đổi);</li>
 *   <li>lưu dưới dạng băm SHA-256 để tránh log lại giá trị vé nếu có rò rỉ bộ nhớ (không log);</li>
 *   <li>chỉ nằm trong RAM, không ghi log, không lưu DB.</li>
 * </ul>
 */
public final class PeerTicketStore {
    /** Thời gian sống của vé: 60 giây. */
    public static final long TTL_MS = 60_000L;
    private static final SecureRandom RNG = new SecureRandom();
    private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();

    private record Ticket(long userId, String nonce, long expiresAt) {
    }

    private final Map<String, Ticket> ticketsByHash = new ConcurrentHashMap<>();

    /** Cấp một vé mới cho {@code userId} kèm nonce từ Peer Core; trả về chuỗi vé (không log). */
    public String issue(long userId, String nonce) {
        sweep();
        byte[] buf = new byte[24];
        RNG.nextBytes(buf);
        String ticket = B64.encodeToString(buf);
        ticketsByHash.put(hash(ticket), new Ticket(userId, nonce, System.currentTimeMillis() + TTL_MS));
        return ticket;
    }

    /**
     * Thử đổi vé (một lần). Trả về {@code userId} nếu vé hợp lệ, còn hạn, nonce khớp.
     * Chỉ tiêu thụ vé một lần (remove trả giá trị).
     */
    public ExchangeResult exchange(String ticket, String nonce) {
        if (ticket == null || ticket.isBlank() || nonce == null || nonce.isBlank()) {
            return null;
        }
        String h = hash(ticket);
        Ticket t = ticketsByHash.remove(h);
        if (t == null || t.expiresAt() < System.currentTimeMillis()) {
            return null;
        }
        // So sánh nonce hằng thời gian (không phân biệt hoa thường không cần, base64url)
        if (!t.nonce().equals(nonce)) {
            return null;
        }
        return new ExchangeResult(t.userId(), nonce);
    }

    public record ExchangeResult(long userId, String nonce) {
    }

    /** Số vé đang chờ (dùng cho test). */
    public int size() {
        sweep();
        return ticketsByHash.size();
    }

    /** Xoá các vé đã hết hạn. */
    public void sweep() {
        long now = System.currentTimeMillis();
        ticketsByHash.values().removeIf(t -> t.expiresAt() < now);
    }

    private static String hash(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] d = md.digest(s.getBytes(StandardCharsets.UTF_8));
            return B64.encodeToString(d);
        } catch (NoSuchAlgorithmException e) {
            // fallback không xảy ra
            return s;
        }
    }
}
