package com.workchat.peer;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Vé dùng-một-lần cho kênh gửi/nhận tệp giữa giao diện và Peer Core (loopback).
 *
 * <p>Vé upload mang sẵn metadata do UI khai (tên, mime, kích thước, fileId) và gắn với
 * {@code userId} + {@code Origin} của phiên UI. Vé có hạn {@link FileTransferConfig#TICKET_TTL_MS}
 * và bị xoá ngay khi tiêu thụ (kể cả khi kiểm tra thất bại) để chống dùng lại.
 *
 * <p>Vé download tương tự nhưng chỉ mang {@code fileId}; giao diện xin một vé mới cho MỖI lần mở.
 *
 * <p>Lớp này thuần (không I/O, nhận {@code now} làm tham số) nên kiểm thử được offline.
 */
public final class FileTokens {
    private static final SecureRandom RNG = new SecureRandom();

    /** Vé upload đã cấp. */
    public record Upload(String token, long userId, String origin, String fileId,
                         String name, String mime, long size, long expiresAt) {
    }

    /** Vé download đã cấp. */
    public record Download(String token, long userId, String origin, String fileId, long expiresAt) {
    }

    private final Map<String, Upload> uploads = new ConcurrentHashMap<>();
    private final Map<String, Download> downloads = new ConcurrentHashMap<>();
    private final long ttlMs;
    private final AtomicInteger issuedUploads = new AtomicInteger();
    private final AtomicInteger issuedDownloads = new AtomicInteger();

    public FileTokens() {
        this(FileTransferConfig.TICKET_TTL_MS);
    }

    public FileTokens(long ttlMs) {
        this.ttlMs = ttlMs;
    }

    public Upload issueUpload(long userId, String origin, String fileId, String name, String mime,
                              long size, long now) {
        String token = newToken();
        Upload u = new Upload(token, userId, norm(origin), fileId, name, mime, size, now + ttlMs);
        uploads.put(token, u);
        issuedUploads.incrementAndGet();
        return u;
    }

    public Download issueDownload(long userId, String origin, String fileId, long now) {
        String token = newToken();
        Download d = new Download(token, userId, norm(origin), fileId, now + ttlMs);
        downloads.put(token, d);
        issuedDownloads.incrementAndGet();
        return d;
    }

    /**
     * Tiêu thụ vé upload: trả về vé nếu hợp lệ (đúng user, đúng Origin, còn hạn); ngược lại null.
     * Vé luôn bị xoá sau lần gọi đầu tiên dù hợp lệ hay không.
     */
    public Upload takeUpload(String token, long userId, String origin, long now) {
        if (token == null) {
            return null;
        }
        Upload u = uploads.remove(token);
        if (u == null || u.userId() != userId || now > u.expiresAt()
                || !sameOrigin(u.origin(), origin)) {
            return null;
        }
        return u;
    }

    /** Tiêu thụ vé download: xem {@link #takeUpload}. */
    public Download takeDownload(String token, long userId, String origin, long now) {
        if (token == null) {
            return null;
        }
        Download d = downloads.remove(token);
        if (d == null || d.userId() != userId || now > d.expiresAt()
                || !sameOrigin(d.origin(), origin)) {
            return null;
        }
        return d;
    }

    public int pendingUploads() {
        return uploads.size();
    }

    public int pendingDownloads() {
        return downloads.size();
    }

    public int issuedUploads() {
        return issuedUploads.get();
    }

    public int issuedDownloads() {
        return issuedDownloads.get();
    }

    /** Dọn vé hết hạn (gọi định kỳ). */
    public void sweep(long now) {
        uploads.entrySet().removeIf(e -> now > e.getValue().expiresAt());
        downloads.entrySet().removeIf(e -> now > e.getValue().expiresAt());
    }

    private static boolean sameOrigin(String a, String b) {
        return norm(a).equals(norm(b));
    }

    private static String norm(String s) {
        return s == null ? "" : s.trim();
    }

    private static String newToken() {
        byte[] raw = new byte[24];
        RNG.nextBytes(raw);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
    }
}
