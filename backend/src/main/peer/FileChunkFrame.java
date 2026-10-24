package com.workchat.peer;

/**
 * Khung nhị phân một khối tệp, phiên bản 2:
 * {@code [TAG_V2(1)][streamId(4)][seq(4)][bytes...]} (big-endian).
 *
 * <p>Tag riêng ({@code 0x02}) để bên nhận phân biệt được với khung cũ
 * {@code [FILE_TAG][seq(4)][bytes...]} mà không cần trạng thái phiên — nhờ vậy nhiều tệp
 * cùng lúc không lẫn khối và vẫn tương thích ngược với bản cũ.
 */
public final class FileChunkFrame {

    /** Tag khung khối v2 (khác {@code PeerCore.FILE_TAG = 0x01} của định dạng cũ). */
    public static final byte TAG = 0x02;
    /** Độ dài header: tag + streamId + seq. */
    public static final int HEADER = 1 + 4 + 4;

    private FileChunkFrame() {
    }

    /** Kết quả giải mã một khung v2. */
    public record Decoded(int streamId, int seq, byte[] data) {
    }

    /** Đóng gói một khối; trả mảng đúng độ dài (header + {@code len}). */
    public static byte[] encode(int streamId, int seq, byte[] src, int off, int len) {
        byte[] out = new byte[HEADER + len];
        out[0] = TAG;
        putInt(out, 1, streamId);
        putInt(out, 5, seq);
        if (len > 0) {
            System.arraycopy(src, off, out, HEADER, len);
        }
        return out;
    }

    /** Giải mã; trả null nếu không phải khung v2 hoặc header không hợp lệ. */
    public static Decoded decode(byte[] payload, int len) {
        if (payload == null || len < HEADER || payload[0] != TAG) {
            return null;
        }
        int streamId = getInt(payload, 1);
        int seq = getInt(payload, 5);
        if (streamId <= 0 || seq < 0) {
            return null;
        }
        byte[] data = new byte[len - HEADER];
        System.arraycopy(payload, HEADER, data, 0, data.length);
        return new Decoded(streamId, seq, data);
    }

    private static void putInt(byte[] b, int off, int v) {
        b[off] = (byte) (v >>> 24);
        b[off + 1] = (byte) (v >>> 16);
        b[off + 2] = (byte) (v >>> 8);
        b[off + 3] = (byte) v;
    }

    private static int getInt(byte[] b, int off) {
        return ((b[off] & 0xff) << 24) | ((b[off + 1] & 0xff) << 16)
                | ((b[off + 2] & 0xff) << 8) | (b[off + 3] & 0xff);
    }
}
