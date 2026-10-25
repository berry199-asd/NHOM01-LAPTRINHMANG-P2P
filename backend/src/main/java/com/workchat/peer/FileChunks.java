package com.workchat.peer;

import java.util.ArrayList;
import java.util.List;

/**
 * Tiện ích thuần cho luồng truyền tệp theo khối: đếm số khối, liệt kê khối còn thiếu,
 * đánh dấu khối đã có. Tách riêng để kiểm thử được mà không cần mạng.
 */
public final class FileChunks {

    private FileChunks() {
    }

    /** Số khối cần cho {@code size} byte với kích thước khối {@code chunkSize} (tối thiểu 1). */
    public static int count(long size, int chunkSize) {
        if (chunkSize <= 0) {
            return 0;
        }
        return Math.max(1, (int) ((size + (long) chunkSize - 1) / chunkSize));
    }

    /** Danh sách chỉ số khối còn thiếu (0-based) theo mảng {@code have} đã có. */
    public static List<Integer> missing(int total, boolean[] have) {
        List<Integer> out = new ArrayList<>();
        for (int i = 0; i < total; i++) {
            if (have == null || i >= have.length || !have[i]) {
                out.add(i);
            }
        }
        return out;
    }

    /** Đánh dấu các chỉ số trong {@code seqs} là đã có; trả true nếu có thay đổi. */
    public static boolean markAll(boolean[] have, List<? extends Number> seqs) {
        if (have == null || seqs == null) {
            return false;
        }
        boolean changed = false;
        for (Number n : seqs) {
            if (n == null) {
                continue;
            }
            int s = n.intValue();
            if (s >= 0 && s < have.length && !have[s]) {
                have[s] = true;
                changed = true;
            }
        }
        return changed;
    }
}
