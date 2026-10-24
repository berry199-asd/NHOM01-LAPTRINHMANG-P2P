package com.workchat.peer.offline;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Ghim khóa định danh Ed25519 của các peer khác (TOFU — Trust On First Use).
 *
 * <p>Lần đầu thấy một userId, khóa công khai (đã được Tracker phân phối) được ghi nhớ.
 * Các lần sau, nếu khóa cho cùng userId KHÁC đi → đánh dấu {@link Status#CHANGED} để từ chối
 * kết nối và cảnh báo người dùng. Đây là lớp phòng thủ bổ sung khi Tracker bị xâm nhập và cố
 * trả khóa giả (chữ ký số một mình không đủ nếu khóa công khai sai).
 */
public final class TofuPinStore {
    public enum Status { UNKNOWN, MATCH, CHANGED }

    private final Path file;
    private final Map<Long, String> pins = new LinkedHashMap<>();
    private boolean loaded;

    public TofuPinStore(Path file) {
        this.file = file;
    }

    public static Path defaultPath(long userId) {
        return E2eKeystore.userDataDir(userId).resolve("pins");
    }

    /** Kiểm tra và (nếu lần đầu) ghim khóa. Trả về trạng thái đối chiếu. */
    public synchronized Status checkAndPin(long userId, String idPubB64) {
        if (userId <= 0 || idPubB64 == null || idPubB64.isBlank()) {
            return Status.UNKNOWN;
        }
        ensureLoaded();
        String existing = pins.get(userId);
        if (existing == null) {
            pins.put(userId, idPubB64);
            persist();
            return Status.UNKNOWN;
        }
        return existing.equals(idPubB64) ? Status.MATCH : Status.CHANGED;
    }

    /** Khóa đã ghim cho userId (null nếu chưa ghim). */
    public synchronized String pinned(long userId) {
        ensureLoaded();
        return pins.get(userId);
    }

    /** Xóa mọi ghim (dùng khi người dùng chủ động reset danh tính). */
    public synchronized void clear() {
        ensureLoaded();
        pins.clear();
        try {
            Files.deleteIfExists(file);
        } catch (Exception ignored) {
        }
    }

    private void ensureLoaded() {
        if (loaded) {
            return;
        }
        loaded = true;
        try {
            if (!Files.isRegularFile(file)) {
                return;
            }
            for (String line : Files.readAllLines(file, StandardCharsets.US_ASCII)) {
                String s = line.trim();
                if (s.isEmpty()) {
                    continue;
                }
                int sp = s.indexOf(' ');
                if (sp <= 0) {
                    continue;
                }
                try {
                    pins.put(Long.parseLong(s.substring(0, sp)), s.substring(sp + 1).trim());
                } catch (NumberFormatException ignored) {
                    // bỏ qua dòng hỏng
                }
            }
        } catch (Exception ignored) {
            // File hỏng: coi như chưa ghim gì.
        }
    }

    private void persist() {
        try {
            Files.createDirectories(file.toAbsolutePath().getParent());
            StringBuilder sb = new StringBuilder();
            for (Map.Entry<Long, String> e : pins.entrySet()) {
                sb.append(e.getKey()).append(' ').append(e.getValue()).append('\n');
            }
            Path tmp = file.resolveSibling(file.getFileName() + ".tmp");
            Files.write(tmp, sb.toString().getBytes(StandardCharsets.US_ASCII));
            Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING);
        } catch (Exception ignored) {
            // Không chặn kết nối nếu không ghi được file ghim.
        }
    }
}
