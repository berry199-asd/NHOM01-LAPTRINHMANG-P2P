package com.workchat.peer;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.function.Consumer;

/**
 * Hàng đợi gửi hai mức cho một {@link PeerLink}: khung điều khiển (chat, ack, tín hiệu cuộc
 * gọi, `file_*`) LUÔN được gửi trước khối file; khối file bị giới hạn số lượng để bộ đệm
 * không phình khi mạng chậm. Thuần bộ nhớ, không I/O — kiểm thử được offline.
 */
public final class FrameQueues {
    /** Tối đa số khối file chờ trong bộ đệm của một liên kết. */
    public static final int MAX_CHUNKS = 64;

    private final Deque<Object> control = new ArrayDeque<>();
    private final Deque<Object> chunks = new ArrayDeque<>();

    public synchronized void addControl(Object item) {
        control.add(item);
    }

    /** @return false khi hàng đợi khối đã đầy (bên gọi phải chờ kênh rảnh). */
    public synchronized boolean addChunk(Object item) {
        if (chunks.size() >= MAX_CHUNKS) {
            return false;
        }
        chunks.add(item);
        return true;
    }

    public synchronized int size() {
        return control.size() + chunks.size();
    }

    public synchronized int chunkCount() {
        return chunks.size();
    }

    /**
     * Xả hàng đợi: luôn xả hết điều khiển; khối chỉ xả khi {@code writable} và còn chỗ trong
     * hàng đợi của kênh.
     */
    public synchronized void drain(boolean writable, Consumer<Object> sink) {
        Object item;
        while ((item = control.poll()) != null) {
            sink.accept(item);
        }
        while (writable && (item = chunks.poll()) != null) {
            sink.accept(item);
        }
    }

    public synchronized void clear() {
        control.clear();
        chunks.clear();
    }
}
