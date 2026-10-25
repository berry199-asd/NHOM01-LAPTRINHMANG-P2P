package com.workchat.peer;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Log chẩn đoán luồng cuộc gọi (LỖI A/B) — MẶC ĐỊNH TẮT.
 *
 * <p>Bật bằng biến môi trường {@code PEER_CALL_DEBUG=1} (hoặc {@code -Dpeer.callDebug=1}).
 * Mặc định tắt nên không ảnh hưởng hiệu năng/ổn định khi chạy thật.
 *
 * <p>KHÔNG bao giờ ghi SDP/ICE/nội dung/token: {@link #summary(Map)} chỉ giữ trường
 * định danh (signal, callId, roomId, t, kind) và cờ "có SDP/candidate hay không".
 */
public final class CallDebug {

    private static volatile boolean enabled = truthy(System.getenv("PEER_CALL_DEBUG"))
            || truthy(System.getProperty("peer.callDebug"));

    private CallDebug() {
    }

    public static boolean enabled() {
        return enabled;
    }

    /** Chỉ dùng cho test: bật/tắt log khi chạy. */
    public static void setEnabled(boolean value) {
        enabled = value;
    }

    /** Ghi một dòng log có tiền tố; không bao giờ ném lỗi ra luồng gọi. */
    public static void log(String stage, Map<String, Object> fields) {
        if (!enabled) {
            return;
        }
        try {
            StringBuilder sb = new StringBuilder("[peer-call] ").append(stage);
            if (fields != null) {
                for (Map.Entry<String, Object> e : fields.entrySet()) {
                    sb.append(' ').append(e.getKey()).append('=').append(e.getValue());
                }
            }
            System.out.println(sb);
        } catch (Exception ignored) {
            // Log chẩn đoán không được làm hỏng luồng cuộc gọi.
        }
    }

    /** Rút gọn frame cuộc gọi về trường định danh an toàn (BỎ sdp/candidate). */
    public static Map<String, Object> summary(Map<String, Object> frame) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (frame == null) {
            return out;
        }
        copy(frame, out, "signal");
        copy(frame, out, "callId");
        copy(frame, out, "roomId");
        copy(frame, out, "t");
        copy(frame, out, "kind");
        copy(frame, out, "reason");
        copy(frame, out, "fromUserId");
        Object sdp = frame.get("sdp");
        out.put("hasSdp", sdp instanceof String s && !s.isBlank());
        Object cand = frame.get("candidate");
        out.put("hasCandidate", cand instanceof Map<?, ?> m && !m.isEmpty());
        return out;
    }

    private static void copy(Map<String, Object> from, Map<String, Object> to, String key) {
        Object v = from.get(key);
        if (v != null) {
            to.put(key, v);
        }
    }

    private static boolean truthy(String v) {
        return v != null && (v.equals("1") || v.equalsIgnoreCase("true") || v.equalsIgnoreCase("on"));
    }
}
