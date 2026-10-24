package com.workchat.peer;

import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

/**
 * SHA-256 rút gọn (16 byte) cho từng khối của tệp gửi. Bên nhận so khớp để phát hiện đúng khối
 * hỏng và gửi `file_nack` cho khối đó, thay vì hủy cả tệp (A2/A6). Không chứa nội dung.
 */
public final class ChunkSums {
    public static final int LEN = 16;

    private ChunkSums() {
    }

    public static byte[] of(byte[] data) {
        try {
            byte[] full = MessageDigest.getInstance("SHA-256").digest(data);
            byte[] out = new byte[LEN];
            System.arraycopy(full, 0, out, 0, LEN);
            return out;
        } catch (Exception e) {
            throw new IllegalStateException("sha256", e);
        }
    }

    public static boolean matches(byte[] expected, byte[] data) {
        return expected == null || MessageDigest.isEqual(expected, of(data));
    }

    public static List<String> encode(byte[][] sums) {
        if (sums == null) {
            return null;
        }
        List<String> out = new ArrayList<>(sums.length);
        for (byte[] s : sums) {
            out.add(s == null ? "" : Base64.getEncoder().encodeToString(s));
        }
        return out;
    }

    /** Đọc trường `sums` tuỳ chọn từ `file_offer`; null/rỗng nếu bên gửi là Core cũ. */
    public static byte[][] parse(Object jsonList, int chunks) {
        if (!(jsonList instanceof List<?> list) || list.isEmpty() || chunks <= 0) {
            return null;
        }
        byte[][] out = new byte[chunks][];
        int i = 0;
        for (Object item : list) {
            if (i >= chunks) {
                break;
            }
            try {
                byte[] b = Base64.getDecoder().decode(String.valueOf(item));
                out[i++] = b.length > 0 ? b : null;
            } catch (Exception e) {
                return null;
            }
        }
        return out;
    }
}
