package com.workchat.peer;

import com.workchat.tracker.common.Json;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Metadata tệp đi trong phong bì E2E (hộp thư) hoặc lịch sử cục bộ. Tracker chỉ thấy
 * {@code content_type=media_ref} và một chuỗi JSON ĐÃ MÃ HÓA — không thấy tên/khóa.
 *
 * <p>{@code blobId}/{@code keyB64} rỗng với bản ghi lịch sử của người GỬI (tệp đã có trên đĩa).
 * Hàm thuần, không I/O — kiểm thử được offline.
 */
public record MediaRef(int v, String fileId, String name, String mime, long size, String sha256,
                       String blobId, String keyB64, int blocks) {
    public static final String CONTENT_TYPE = "media_ref";
    public static final int VERSION = 1;

    public static MediaRef local(String fileId, String name, String mime, long size, String sha256) {
        return new MediaRef(VERSION, fileId, name, mime, size, sha256, "", "", 0);
    }

    public String toJson() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("v", v);
        m.put("fileId", fileId);
        m.put("name", name);
        m.put("mime", mime);
        m.put("size", size);
        m.put("sha256", sha256);
        m.put("blobId", blobId);
        m.put("keyB64", keyB64);
        m.put("blocks", blocks);
        return Json.write(m);
    }

    /** Đọc metadata; trả null nếu JSON hỏng/thiếu fileId hoặc sai phiên bản. */
    public static MediaRef parse(String json) {
        try {
            Map<String, Object> m = Json.readMap(json);
            String fileId = str(m.get("fileId"));
            if (fileId == null || fileId.isBlank()) {
                return null;
            }
            int v = m.get("v") instanceof Number n ? n.intValue() : 0;
            if (v != VERSION) {
                return null;
            }
            return new MediaRef(v, fileId, str(m.get("name")), str(m.get("mime")),
                    m.get("size") instanceof Number s ? s.longValue() : 0L,
                    str(m.get("sha256")), str(m.get("blobId")), str(m.get("keyB64")),
                    m.get("blocks") instanceof Number b ? b.intValue() : 0);
        } catch (Exception e) {
            return null;
        }
    }

    private static String str(Object v) {
        return v == null ? "" : v.toString();
    }
}
