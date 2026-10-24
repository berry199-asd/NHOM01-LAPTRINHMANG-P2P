package com.workchat.peer.net;

/**
 * Lịch đục lỗ: thử ứng viên LAN trước, sau đó tới ứng viên địa chỉ công khai, rồi bỏ cuộc
 * (chuyển sang Relay/mailbox). Tách riêng để kiểm thử thuần thời gian mà không cần mạng.
 *
 * <p>Ưu tiên: LAN {@value #LAN_TIMEOUT_MS} ms → công khai {@value #PUBLIC_TIMEOUT_MS} ms.
 */
public final class PunchSchedule {
    public static final long LAN_TIMEOUT_MS = 1500L;
    public static final long PUBLIC_TIMEOUT_MS = 3000L;
    public static final long WINDOW_MS = LAN_TIMEOUT_MS + PUBLIC_TIMEOUT_MS;

    public enum Phase {
        LAN,
        PUBLIC,
        GIVE_UP
    }

    private PunchSchedule() {
    }

    /** Giai đoạn tại thời điểm {@code elapsedMs} kể từ lúc bắt đầu đục lỗ. */
    public static Phase phase(long elapsedMs) {
        if (elapsedMs < LAN_TIMEOUT_MS) {
            return Phase.LAN;
        }
        if (elapsedMs < WINDOW_MS) {
            return Phase.PUBLIC;
        }
        return Phase.GIVE_UP;
    }
}
