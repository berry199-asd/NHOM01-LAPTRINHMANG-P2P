package com.workchat.tracker.http;

import com.workchat.tracker.common.Json;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.util.Comparator;
import java.util.Map;
import java.util.stream.Stream;

/**
 * Kho blob trên đĩa của Tracker. Tracker chỉ thấy byte ĐÃ MÃ HÓA, kích thước và blobId —
 * không bao giờ thấy tên/loại/nội dung tệp (phần đó đi trong phong bì E2E qua hộp thư).
 *
 * <p>Mỗi blob là một thư mục {@code <blobId>/} chứa các khối {@code <n>.blk} và một tệp
 * {@code <blobId>.json} mô tả {@code ownerId/size/blocks/expiresAt}. Khối được tải lên riêng
 * (PUT) nên máy chủ không cần biết kích thước khối — chỉ cần tổng độ dài khớp lúc finish.
 */
public final class BlobStore {
    public static final long MAX_BYTES = 100L * 1024 * 1024;
    public static final int MAX_BLOCKS = 4096;
    public static final int MAX_BLOCK_BYTES = 2 * 1024 * 1024;
    public static final int MAX_CONCURRENT_PER_USER = 2;
    public static final long TTL_MS = 7L * 24 * 60 * 60 * 1000;

    private static final SecureRandom RNG = new SecureRandom();

    private final Path root;

    public BlobStore(Path root) {
        this.root = root;
    }

    public record Meta(String id, long ownerId, long size, int blocks, long createdAt,
                       long expiresAt, boolean complete) {
    }

    private static boolean validId(String id) {
        return id != null && id.matches("[0-9a-f]{32}");
    }

    private Path metaPath(String id) {
        return root.resolve(id + ".json");
    }

    private Path blockDir(String id) {
        return root.resolve(id);
    }

    private Path blockPath(String id, int n) {
        return blockDir(id).resolve(n + ".blk");
    }

    /**
     * Bắt đầu một blob mới. Ném {@link IllegalStateException} với mã lỗi ngắn nếu vượt hạn mức
     * hoặc tham số sai (handler đổi thành 4xx tương ứng).
     */
    public synchronized Meta create(long ownerId, long size, int blocks, long maxBlobBytes, long userQuotaBytes, long ttlMs) throws IOException {
        long limitBytes = maxBlobBytes > 0 ? maxBlobBytes : MAX_BYTES;
        if (size <= 0 || size > limitBytes) {
            throw new IllegalStateException("bad_size");
        }
        if (blocks <= 0 || blocks > MAX_BLOCKS) {
            throw new IllegalStateException("bad_blocks");
        }
        Files.createDirectories(root);
        sweep();
        int active = 0;
        long userUsed = 0L;
        try (Stream<Path> s = Files.list(root)) {
            for (Path p : (Iterable<Path>) s.filter(x -> x.toString().endsWith(".json"))::iterator) {
                Meta m = readMeta(p);
                if (m != null && m.ownerId() == ownerId) {
                    if (!m.complete()) {
                        active++;
                    }
                    userUsed += m.size();
                }
            }
        }
        if (active >= MAX_CONCURRENT_PER_USER) {
            throw new IllegalStateException("too_many");
        }
        if (userQuotaBytes > 0 && userUsed + size > userQuotaBytes) {
            throw new IllegalStateException("quota_exceeded");
        }
        String id = newId();
        long now = System.currentTimeMillis();
        long actualTtl = ttlMs > 0 ? ttlMs : TTL_MS;
        Meta meta = new Meta(id, ownerId, size, blocks, now, now + actualTtl, false);
        Files.createDirectories(blockDir(id));
        writeMeta(meta);
        return meta;
    }

    public synchronized Meta create(long ownerId, long size, int blocks) throws IOException {
        return create(ownerId, size, blocks, MAX_BYTES, 200L * 1024 * 1024, TTL_MS);
    }

    public synchronized void putBlock(long ownerId, String id, int n, byte[] data) throws IOException {
        Meta m = requireOwner(ownerId, id);
        if (m.complete()) {
            throw new IllegalStateException("already_complete");
        }
        if (n < 0 || n >= m.blocks()) {
            throw new IllegalStateException("bad_block");
        }
        if (data == null || data.length == 0 || data.length > MAX_BLOCK_BYTES) {
            throw new IllegalStateException("bad_block_size");
        }
        Files.createDirectories(blockDir(id));
        Files.write(blockPath(id, n), data);
    }

    public synchronized Meta finish(long ownerId, String id) throws IOException {
        Meta m = requireOwner(ownerId, id);
        if (m.complete()) {
            return m;
        }
        long total = 0;
        for (int i = 0; i < m.blocks(); i++) {
            Path p = blockPath(id, i);
            if (!Files.exists(p)) {
                throw new IllegalStateException("missing_blocks");
            }
            total += Files.size(p);
        }
        if (total != m.size()) {
            throw new IllegalStateException("size_mismatch");
        }
        long now = System.currentTimeMillis();
        Meta done = new Meta(m.id(), m.ownerId(), m.size(), m.blocks(), m.createdAt(), now + TTL_MS, true);
        writeMeta(done);
        return done;
    }

    /** Đọc một khối đã hoàn tất; trả null nếu không có/không hợp lệ. */
    public synchronized byte[] block(String id, int n) throws IOException {
        Meta m = readMeta(metaPathSafe(id));
        if (m == null || !m.complete() || n < 0 || n >= m.blocks()) {
            return null;
        }
        Path p = blockPath(id, n);
        return Files.exists(p) ? Files.readAllBytes(p) : null;
    }

    public synchronized Meta meta(String id) {
        return readMeta(metaPathSafe(id));
    }

    public synchronized boolean delete(long ownerId, String id) {
        Meta m = readMeta(metaPathSafe(id));
        if (m == null) {
            return false;
        }
        if (m.ownerId() != ownerId) {
            return false;
        }
        try {
            deleteTree(blockDir(id));
            Files.deleteIfExists(metaPath(id));
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    /** Xoá blob hết hạn (hoặc tệp mồ côi). Gọi mỗi lần tạo blob nên không cần luồng riêng. */
    public synchronized void sweep() {
        try {
            if (!Files.isDirectory(root)) {
                return;
            }
            long now = System.currentTimeMillis();
            try (Stream<Path> s = Files.list(root)) {
                for (Path p : (Iterable<Path>) s::iterator) {
                    String name = p.getFileName().toString();
                    if (!name.endsWith(".json")) {
                        continue;
                    }
                    Meta m = readMeta(p);
                    String id = name.substring(0, name.length() - 5);
                    if (m == null) {
                        try {
                            deleteTree(blockDir(id));
                            Files.deleteIfExists(p);
                        } catch (IOException ignored) {
                        }
                        continue;
                    }
                    if (m.expiresAt() > 0 && now > m.expiresAt()) {
                        try {
                            deleteTree(blockDir(id));
                            Files.deleteIfExists(p);
                        } catch (IOException ignored) {
                        }
                    }
                }
            }
        } catch (IOException ignored) {
        }
    }

    private Meta requireOwner(long ownerId, String id) throws IOException {
        Meta m = readMeta(metaPathSafe(id));
        if (m == null) {
            throw new IllegalStateException("not_found");
        }
        if (m.ownerId() != ownerId) {
            throw new IllegalStateException("forbidden");
        }
        return m;
    }

    private Path metaPathSafe(String id) {
        return validId(id) ? metaPath(id) : root.resolve("__invalid__");
    }

    private String newId() {
        while (true) {
            byte[] b = new byte[16];
            RNG.nextBytes(b);
            StringBuilder sb = new StringBuilder(32);
            for (byte x : b) {
                sb.append(Character.forDigit((x >> 4) & 0xF, 16)).append(Character.forDigit(x & 0xF, 16));
            }
            String id = sb.toString();
            if (!Files.exists(metaPath(id))) {
                return id;
            }
        }
    }

    private void writeMeta(Meta m) throws IOException {
        Files.writeString(metaPath(m.id()), Json.write(Map.of(
                "id", m.id(),
                "ownerId", m.ownerId(),
                "size", m.size(),
                "blocks", m.blocks(),
                "createdAt", m.createdAt(),
                "expiresAt", m.expiresAt(),
                "complete", m.complete())), java.nio.charset.StandardCharsets.UTF_8);
    }

    private Meta readMeta(Path p) {
        try {
            if (!Files.exists(p)) {
                return null;
            }
            Map<String, Object> m = Json.readMap(Files.readString(p, java.nio.charset.StandardCharsets.UTF_8));
            return new Meta(
                    str(m.get("id")), lng(m.get("ownerId")), lng(m.get("size")), (int) lng(m.get("blocks")),
                    lng(m.get("createdAt")), lng(m.get("expiresAt")), bool(m.get("complete")));
        } catch (Exception e) {
            return null;
        }
    }

    private static void deleteTree(Path dir) throws IOException {
        if (!Files.exists(dir)) {
            return;
        }
        try (Stream<Path> s = Files.walk(dir)) {
            for (Path p : (Iterable<Path>) s.sorted(Comparator.reverseOrder())::iterator) {
                Files.deleteIfExists(p);
            }
        }
    }

    private static String str(Object v) {
        return v == null ? null : v.toString();
    }

    private static long lng(Object v) {
        return v instanceof Number n ? n.longValue() : 0L;
    }

    private static boolean bool(Object v) {
        return v instanceof Boolean b ? b : "true".equalsIgnoreCase(String.valueOf(v));
    }
}
