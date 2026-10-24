package com.workchat.peer;

/**
 * Hằng số tập trung cho luồng truyền tệp — đặt tên rõ để dễ rà soát và chỉnh về sau.
 *
 * <p>Không chứa bí mật. Mọi giá trị đều là giới hạn/ngưỡng vận hành.
 */
public final class FileTransferConfig {

    private FileTransferConfig() {
    }

    // ---- Khối và cửa sổ ----
    /** Kích thước khối khi chia tệp (32 KB). */
    public static final int CHUNK_SIZE = 32 * 1024;
    /** Số khối tối đa gửi trước khi chờ ACK (cửa sổ trượt). */
    public static final int WINDOW_CHUNKS = 16;
    /** Số lần gửi lại tối đa cho một khối hỏng (sai SHA) trước khi báo lỗi. */
    public static final int MAX_RESEND_PER_CHUNK = 3;

    // ---- Phiên bản giao thức ----
    /** Phiên bản giao thức chunk có {@code streamId} (mới). */
    public static final int PROTO_V2 = 2;

    // ---- Chọn đường ----
    /** Chờ liên kết trực tiếp tối đa 3 giây trước khi chuyển sang blob. */
    public static final long DIRECT_LINK_WAIT_MS = 3_000L;
    /** Kích thước tối đa đi đường trực tiếp (tạm — phần sau làm đầy đủ). */
    public static final long MAX_DIRECT_BYTES = 25L * 1024 * 1024;
    /** Kích thước tối đa đi đường blob (tạm — phần sau làm đầy đủ). */
    public static final long MAX_BLOB_BYTES = 10L * 1024 * 1024;
    /**
     * Kích thước tối đa UI được phép nạp lên Core cục bộ (loopback, ghi thẳng đĩa).
     * Giữ ngang giới hạn UI (video 100MB); đường truyền đi sẽ do FileRoute quyết định.
     */
    public static final long MAX_LOCAL_UPLOAD_BYTES = 100L * 1024 * 1024;

    // ---- Chống kẹt / công bằng ----
    /** Không có ACK trong 20 giây thì tạm dừng transfer và nhả chỗ cho file khác. */
    public static final long T_STALL_MS = 20_000L;
    /** Số file tối đa đang chạy cho MỘT người nhận. */
    public static final int MAX_FILES_PER_RECIPIENT = 3;
    /** Số file tối đa đang chạy toàn Core. */
    public static final int MAX_FILES_TOTAL = 6;
    /** Backoff thử lại: 0,5 giây tăng dần tới 30 giây. */
    public static final long RETRY_MIN_MS = 500L;
    public static final long RETRY_MAX_MS = 30_000L;

    // ---- Backpressure kênh ----
    public static final int WRITE_LOW_WATERMARK = 128 * 1024;
    public static final int WRITE_HIGH_WATERMARK = 512 * 1024;

    // ---- Blob (Tracker) ----
    /** Kích thước khối mã hóa khi tải blob lên (256 KB). */
    public static final int BLOB_BLOCK_SIZE = 256 * 1024;
    /** Hạn dọn blob trên Tracker (7 ngày). */
    public static final long BLOB_TTL_MS = 7L * 24 * 60 * 60 * 1000;
    /** Số upload/download blob đồng thời tối đa cho mỗi người. */
    public static final int BLOB_MAX_CONCURRENT_PER_USER = 2;

    // ---- Dọn phần dở ----
    /** Dọn transfer dở trên đĩa sau 24 giờ. */
    public static final long RESUME_TTL_MS = 24L * 60 * 60 * 1000;
    /** Hạn vé upload/download (60 giây). */
    public static final long TICKET_TTL_MS = 60_000L;

    // ---- Gỡ lỗi ----
    /** Bật log chẩn đoán bằng PEER_FILE_DEBUG=1. */
    public static boolean debugEnabled() {
        String v = System.getenv("PEER_FILE_DEBUG");
        return v != null && (v.equals("1") || v.equalsIgnoreCase("true") || v.equalsIgnoreCase("on"));
    }
}
