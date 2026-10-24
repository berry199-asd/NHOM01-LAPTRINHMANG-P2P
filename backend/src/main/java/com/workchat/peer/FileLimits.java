package com.workchat.peer;

import java.util.Map;

/**
 * Cấu hình giới hạn truyền tệp động đồng bộ từ Tracker (hoặc dùng mặc định nếu chưa có mạng).
 */
public record FileLimits(
        int maxImageMb,
        int maxFileMbDirect,
        int maxFileMbBlob,
        int maxFilesPerMessage,
        int userBlobQuotaMb,
        int blobTtlDays
) {
    public static final FileLimits DEFAULT = new FileLimits(10, 25, 10, 5, 200, 7);

    public long maxDirectBytes() {
        return (long) maxFileMbDirect * 1024 * 1024;
    }

    public long maxBlobBytes() {
        return (long) maxFileMbBlob * 1024 * 1024;
    }

    public long maxImageBytes() {
        return (long) maxImageMb * 1024 * 1024;
    }

    public long userQuotaBytes() {
        return (long) userBlobQuotaMb * 1024 * 1024;
    }

    public static FileLimits fromMap(Map<String, Object> map) {
        if (map == null) {
            return DEFAULT;
        }
        int img = getInt(map, "max_image_mb", 10);
        int dir = getInt(map, "max_file_mb_direct", 25);
        int blb = getInt(map, "max_file_mb_blob", 10);
        int cnt = getInt(map, "max_files_per_message", 5);
        int qta = getInt(map, "user_blob_quota_mb", 200);
        int ttl = getInt(map, "blob_ttl_days", 7);
        return new FileLimits(
                Math.max(1, Math.min(50, img)),
                Math.max(1, Math.min(100, dir)),
                Math.max(1, Math.min(50, blb)),
                Math.max(1, Math.min(20, cnt)),
                Math.max(10, Math.min(2048, qta)),
                Math.max(1, Math.min(30, ttl))
        );
    }

    private static int getInt(Map<String, Object> map, String key, int def) {
        Object val = map.get(key);
        if (val instanceof Number n) {
            return n.intValue();
        }
        if (val instanceof String s) {
            try {
                return Integer.parseInt(s.trim());
            } catch (Exception ignored) {
            }
        }
        return def;
    }
}
