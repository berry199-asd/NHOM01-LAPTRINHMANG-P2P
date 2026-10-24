package com.workchat.peer;

/**
 * Chọn đường truyền tệp: trực tiếp (PeerLink ready) hay dự phòng qua Tracker (blob).
 * Hàm thuần, tách riêng để kiểm thử mà không cần mạng.
 *
 * <p>Quy tắc:
 * <ul>
 *   <li>Phòng nhóm luôn dùng {@code BLOB} (kèm fan-out) và áp dụng hạn mức blob.</li>
 *   <li>1-1: Có liên kết trực tiếp ready → {@code DIRECT} (nếu size &le; maxDirect).</li>
 *   <li>1-1: Chưa có liên kết: chờ tối đa {@link FileTransferConfig#DIRECT_LINK_WAIT_MS} để liên kết
 *       kịp dựng, trong lúc đó là {@code WAIT}.</li>
 *   <li>1-1: Hết thời gian chờ (hoặc người nhận offline) → {@code BLOB} nếu size &le; maxBlob.</li>
 *   <li>Kích thước vượt hạn mức của cả hai đường → {@code REJECT}.</li>
 * </ul>
 */
public final class FileRoute {

    public enum Route {
        /** Dùng PeerLink trực tiếp. */
        DIRECT,
        /** Chưa có liên kết, còn trong cửa sổ chờ. */
        WAIT,
        /** Dùng blob mã hóa qua Tracker. */
        BLOB,
        /** Vượt hạn mức cả hai đường — từ chối rõ ràng. */
        REJECT
    }

    private FileRoute() {
    }

    /** Bản tương thích gọi với giới hạn mặc định và 1-1. */
    public static Route choose(boolean linkReady, long elapsedMs, boolean peerOnline, long size) {
        return choose(linkReady, elapsedMs, peerOnline, size,
                FileTransferConfig.MAX_DIRECT_BYTES, FileTransferConfig.MAX_BLOB_BYTES, false);
    }

    /**
     * Chọn đường truyền tệp với cấu hình giới hạn kích thước động và cờ phòng nhóm.
     */
    public static Route choose(boolean linkReady, long elapsedMs, boolean peerOnline, long size,
                               long maxDirect, long maxBlob, boolean isGroup) {
        if (size <= 0) {
            return Route.REJECT;
        }
        if (isGroup) {
            return size <= maxBlob ? Route.BLOB : Route.REJECT;
        }
        if (linkReady) {
            return size <= maxDirect ? Route.DIRECT : Route.REJECT;
        }
        if (peerOnline && elapsedMs < FileTransferConfig.DIRECT_LINK_WAIT_MS) {
            return Route.WAIT;
        }
        if (size <= maxBlob) {
            return Route.BLOB;
        }
        return Route.REJECT;
    }
}
