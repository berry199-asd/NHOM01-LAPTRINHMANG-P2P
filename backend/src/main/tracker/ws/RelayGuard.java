package com.workchat.tracker.ws;

import java.util.HashMap;
import java.util.Map;

/**
 * Giới hạn Relay (control-plane) trên Tracker: kích thước phong bì và tốc độ gửi
 * theo người gửi. Nội dung vẫn là bản mã E2E nên Tracker chỉ kiểm soát siêu dữ liệu
 * (ai gửi, khi nào, kích thước) — không đọc được nội dung.
 *
 * <p>Mặc định: tối đa {@value #MAX_FRAME_BYTES} byte mỗi frame (phong bì base64 của
 * một khối tin/ảnh nhỏ) và {@value #MAX_FRAMES_PER_WINDOW} frame mỗi
 * {@value #WINDOW_MS} ms cho mỗi người gửi.
 */
public final class RelayGuard {
    public static final int MAX_FRAME_BYTES = 16 * 1024;
    public static final int MAX_FRAMES_PER_WINDOW = 30;
    public static final long WINDOW_MS = 10_000L;

    private static final class State {
        long windowStart = -1;
        int count;
    }

    private final Map<Long, State> byUser = new HashMap<>();
    private final int maxFrameBytes;
    private final int maxFrames;
    private final long windowMs;

    public RelayGuard() {
        this(MAX_FRAME_BYTES, MAX_FRAMES_PER_WINDOW, WINDOW_MS);
    }

    public RelayGuard(int maxFrameBytes, int maxFrames, long windowMs) {
        this.maxFrameBytes = maxFrameBytes;
        this.maxFrames = maxFrames;
        this.windowMs = windowMs;
    }

    /** Kết quả kiểm tra một frame Relay. */
    public enum Decision {
        ALLOW,
        TOO_LARGE,
        RATE_LIMITED
    }

    /**
     * Kiểm tra kích thước (số byte phong bì) rồi tốc độ cho người gửi. Chỉ tính vào
     * hạn mức khi frame hợp lệ về kích thước để tránh kẻ gửi frame rác đốt quota người khác
     * (quota tính theo chính người gửi nên tác động chỉ ở phía kẻ tấn công).
     */
    public synchronized Decision check(long senderId, int frameBytes, long nowMs) {
        if (frameBytes > maxFrameBytes) {
            return Decision.TOO_LARGE;
        }
        State s = byUser.computeIfAbsent(senderId, k -> new State());
        if (s.windowStart < 0 || nowMs - s.windowStart >= windowMs) {
            s.windowStart = nowMs;
            s.count = 0;
        }
        if (s.count >= maxFrames) {
            return Decision.RATE_LIMITED;
        }
        s.count++;
        return Decision.ALLOW;
    }

    /** Dọn trạng thái của người gửi đã ngắt kết nối để tránh giữ bộ nhớ vô hạn. */
    public synchronized void forget(long senderId) {
        byUser.remove(senderId);
    }
}
