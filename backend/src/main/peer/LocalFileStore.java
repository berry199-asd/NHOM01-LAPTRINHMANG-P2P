package com.workchat.peer;

import com.workchat.tracker.common.Json;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

/**
 * Kho tệp cục bộ của Peer Core: ghi tệp nhận/gửi xuống đĩa (KHÔNG giữ cả tệp trong RAM) và
 * lưu metadata + bản đồ khối đã nhận để tiếp tục sau khi đứt/khởi động lại.
 *
 * <p>Thư mục: {@code peer-data/<userId>/files/}. Tệp dữ liệu: {@code <fileId>.bin};
 * metadata: {@code <fileId>.meta.json}; bản đồ khối: {@code <fileId>.have.json};
 * phần đang tải lên: {@code tmp/<fileId>.part}.
 *
 * <p>Thuần đĩa — không chứa bí mật, không log nội dung. Không commit ({@code peer-data/} đã gitignore).
 */
public final class LocalFileStore {
    private final Path dir;
    private final Path tmp;

    public LocalFileStore(Path dir) {
        this.dir = dir;
        this.tmp = dir.resolve("tmp");
    }

    public Path dir() {
        return dir;
    }

    private void ensure() throws IOException {
        Files.createDirectories(dir);
        Files.createDirectories(tmp);
    }

    public Path data(String fileId) {
        return dir.resolve(safe(fileId) + ".bin");
    }

    public Path temp(String fileId) {
        return tmp.resolve(safe(fileId) + ".part");
    }

    private Path metaPath(String fileId) {
        return dir.resolve(safe(fileId) + ".meta.json");
    }

    private Path havePath(String fileId) {
        return dir.resolve(safe(fileId) + ".have.json");
    }

    /** Metadata một tệp/transfer trên đĩa. {@code direction}: "in" | "out". */
    public record Meta(String fileId, long roomId, long peerUserId, String name, String mime,
                       long size, String sha256, int chunkSize, int chunks, String state,
                       String direction, long updatedAt) {
    }

    public void writeMeta(Meta m) {
        try {
            ensure();
            Files.writeString(metaPath(m.fileId()), Json.write(metaToMap(m)), StandardCharsets.UTF_8);
        } catch (IOException e) {
            // Ghi metadata lỗi không làm hỏng truyền tệp — chỉ mất khả năng resume.
        }
    }

    /** Toàn bộ metadata hiện có (dùng để khôi phục hàng đợi gửi sau khi Core khởi động lại). */
    public List<Meta> list() {
        List<Meta> out = new ArrayList<>();
        try {
            if (!Files.isDirectory(dir)) {
                return out;
            }
            try (Stream<Path> s = Files.list(dir)) {
                s.filter(p -> p.getFileName().toString().endsWith(".meta.json")).forEach(p -> {
                    String fn = p.getFileName().toString();
                    Meta m = readMeta(fn.substring(0, fn.length() - ".meta.json".length()));
                    if (m != null && m.fileId() != null) {
                        out.add(m);
                    }
                });
            }
        } catch (IOException ignored) {
            // danh sách hỏng: coi như trống
        }
        return out;
    }

    public Meta readMeta(String fileId) {        try {
            Path p = metaPath(fileId);
            if (!Files.exists(p)) {
                return null;
            }
            Map<String, Object> m = Json.readMap(Files.readString(p, StandardCharsets.UTF_8));
            return new Meta(
                    str(m, "fileId"), lng(m, "roomId"), lng(m, "peerUserId"), str(m, "name"),
                    str(m, "mime"), lng(m, "size"), str(m, "sha256"), (int) lng(m, "chunkSize"),
                    (int) lng(m, "chunks"), str(m, "state"), str(m, "direction"), lng(m, "updatedAt"));
        } catch (Exception e) {
            return null;
        }
    }

    public void writeHave(String fileId, boolean[] have) {
        try {
            ensure();
            List<Integer> seqs = new ArrayList<>();
            for (int i = 0; i < have.length; i++) {
                if (have[i]) {
                    seqs.add(i);
                }
            }
            Files.writeString(havePath(fileId), Json.write(Map.of("seqs", seqs)), StandardCharsets.UTF_8);
        } catch (IOException e) {
            // mất khả năng resume — chấp nhận được
        }
    }

    public boolean[] readHave(String fileId, int chunks) {
        boolean[] have = new boolean[Math.max(0, chunks)];
        try {
            Path p = havePath(fileId);
            if (!Files.exists(p)) {
                return have;
            }
            Map<String, Object> m = Json.readMap(Files.readString(p, StandardCharsets.UTF_8));
            Object seqs = m.get("seqs");
            if (seqs instanceof List<?> list) {
                for (Object o : list) {
                    if (o instanceof Number n) {
                        int s = n.intValue();
                        if (s >= 0 && s < have.length) {
                            have[s] = true;
                        }
                    }
                }
            }
        } catch (Exception e) {
            // bản đồ hỏng → coi như chưa có khối nào
        }
        return have;
    }

    public void delete(String fileId) {
        try {
            Files.deleteIfExists(data(fileId));
            Files.deleteIfExists(metaPath(fileId));
            Files.deleteIfExists(havePath(fileId));
            Files.deleteIfExists(temp(fileId));
        } catch (IOException e) {
            // bỏ qua
        }
    }

    /** Xoá các phần dở cũ hơn {@code ttlMs} (mặc định 24 giờ). */
    public void sweep(long now, long ttlMs) {
        try {
            if (!Files.isDirectory(dir)) {
                return;
            }
            try (Stream<Path> s = Files.list(dir)) {
                s.filter(p -> p.getFileName().toString().endsWith(".meta.json")).forEach(p -> {
                    try {
                        Map<String, Object> m = Json.readMap(Files.readString(p, StandardCharsets.UTF_8));
                        String state = str(m, "state");
                        long updated = lng(m, "updatedAt");
                        if (("receiving".equals(state) || "sending".equals(state) || "paused".equals(state))
                                && now - updated > ttlMs) {
                            delete(str(m, "fileId"));
                        }
                    } catch (Exception ignored) {
                    }
                });
            }
            if (Files.isDirectory(tmp)) {
                try (Stream<Path> s = Files.list(tmp)) {
                    s.filter(p -> now - p.toFile().lastModified() > ttlMs).forEach(p -> {
                        try {
                            Files.deleteIfExists(p);
                        } catch (IOException ignored) {
                        }
                    });
                }
            }
        } catch (IOException e) {
            // dọn dẹp thất bại không ảnh hưởng luồng chính
        }
    }

    private static Map<String, Object> metaToMap(Meta m) {
        java.util.LinkedHashMap<String, Object> out = new java.util.LinkedHashMap<>();
        out.put("fileId", m.fileId());
        out.put("roomId", m.roomId());
        out.put("peerUserId", m.peerUserId());
        out.put("name", m.name() == null ? "" : m.name());
        out.put("mime", m.mime() == null ? "" : m.mime());
        out.put("size", m.size());
        out.put("sha256", m.sha256() == null ? "" : m.sha256());
        out.put("chunkSize", m.chunkSize());
        out.put("chunks", m.chunks());
        out.put("state", m.state());
        out.put("direction", m.direction());
        out.put("updatedAt", m.updatedAt());
        return out;
    }

    /** fileId phải an toàn làm tên tệp (chặn path traversal). */
    static String safe(String fileId) {
        if (fileId == null) {
            return "unknown";
        }
        return fileId.replaceAll("[^0-9A-Za-z_-]", "_");
    }

    private static String str(Map<String, Object> m, String k) {
        Object v = m.get(k);
        return v == null ? null : v.toString();
    }

    private static long lng(Map<String, Object> m, String k) {
        Object v = m.get(k);
        return v instanceof Number n ? n.longValue() : 0L;
    }
}
