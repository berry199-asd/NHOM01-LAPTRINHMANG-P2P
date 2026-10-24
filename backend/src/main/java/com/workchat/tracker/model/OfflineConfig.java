package com.workchat.tracker.model;

/** Cấu hình tính năng nhắn tin ngoại tuyến (đọc từ bảng system_config, có mặc định an toàn). */
public record OfflineConfig(int ttlDays, int mailboxLimit, int pullLimit, int maxTextBytes) {

    public static OfflineConfig defaults() {
        return new OfflineConfig(30, 500, 100, 4096);
    }
}
