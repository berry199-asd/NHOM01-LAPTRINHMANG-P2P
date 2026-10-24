package com.workchat.peer;

/**
 * Quy tắc co/nới cửa sổ và backoff khi mạng yếu (A6.12). Thuần số học, không I/O.
 * Mất tiến triển: cửa sổ giảm một nửa (sàn {@link #MIN_WINDOW}), backoff nhân đôi tới trần
 * {@link FileTransferConfig#RETRY_MAX_MS}; ACK đều: cửa sổ tăng dần về
 * {@link FileTransferConfig#WINDOW_CHUNKS}.
 */
public final class RetryPacing {
    public static final int MIN_WINDOW = 4;

    private RetryPacing() {
    }

    public static int shrink(int window) {
        return Math.max(MIN_WINDOW, window / 2);
    }

    public static int grow(int window) {
        return Math.min(FileTransferConfig.WINDOW_CHUNKS, window + 1);
    }

    public static long nextBackoff(long backoffMs) {
        long base = Math.max(FileTransferConfig.RETRY_MIN_MS, backoffMs);
        return Math.min(FileTransferConfig.RETRY_MAX_MS, base * 2);
    }
}
