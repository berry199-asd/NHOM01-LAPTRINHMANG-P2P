package com.workchat.peer.offline;

import com.workchat.peer.protocol.CryptoBox;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.KeyPair;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.util.Base64;
import java.util.List;

/**
 * Khóa định danh Ed25519 BỀN VỮNG theo người dùng (TOFU).
 *
 * <p>Khác với khóa RSA E2E (bảo vệ bằng passphrase), khóa định danh Ed25519 cần sẵn sàng
 * ngay cả trước khi mở khóa kho E2E (bắt tay mesh có thể xảy ra trước unlock), nên được
 * lưu trong file riêng {@code peer-data/<userId>/identity.ed25519}. File chỉ chứa khóa X.509
 * (công khai) + PKCS#8 (riêng), dạng text base64; đặt quyền hạn chế khi hệ điều hành hỗ trợ.
 *
 * <p>Nhờ vậy khóa định danh của một user KHÔNG đổi qua các lần khởi động lại → Tracker và
 * các peer khác có thể ghim (pin) khóa lần đầu (TOFU) và phát hiện thay đổi bất thường.
 */
public final class PeerIdentityStore {
    private static final String HEADER = "WCED1";
    private final Path file;

    public PeerIdentityStore(Path file) {
        this.file = file;
    }

    public static Path defaultPath(long userId) {
        return E2eKeystore.userDataDir(userId).resolve("identity.ed25519");
    }

    /** Nạp khóa định danh hiện có, hoặc tạo mới và lưu bền nếu chưa có. */
    public synchronized KeyPair loadOrCreate() {
        KeyPair existing = load();
        if (existing != null) {
            return existing;
        }
        try {
            KeyPair kp = CryptoBox.newEd25519();
            store(kp);
            return kp;
        } catch (Exception e) {
            throw new IllegalStateException("không tạo được khóa định danh Ed25519", e);
        }
    }

    private KeyPair load() {
        try {
            if (!Files.isRegularFile(file)) {
                return null;
            }
            List<String> lines = Files.readAllLines(file, StandardCharsets.US_ASCII);
            if (lines.size() < 3 || !HEADER.equals(lines.get(0).trim())) {
                return null;
            }
            String pubB64 = lines.get(1).trim();
            String privB64 = lines.get(2).trim();
            if (pubB64.isEmpty() || privB64.isEmpty()) {
                return null;
            }
            PublicKey pub = CryptoBox.edPubFromB64(pubB64);
            PrivateKey priv = CryptoBox.edPrivFromB64(privB64);
            return new KeyPair(pub, priv);
        } catch (Exception e) {
            // File hỏng: coi như không có (sẽ tạo mới). Không ném để tránh chặn khởi động.
            return null;
        }
    }

    private void store(KeyPair kp) throws Exception {
        Files.createDirectories(file.toAbsolutePath().getParent());
        String body = HEADER + "\n"
                + CryptoBox.edPubB64(kp.getPublic()) + "\n"
                + CryptoBox.edPrivB64(kp.getPrivate()) + "\n";
        Path tmp = file.resolveSibling(file.getFileName() + ".tmp");
        Files.write(tmp, body.getBytes(StandardCharsets.US_ASCII));
        try {
            Files.setPosixFilePermissions(tmp, java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"));
        } catch (UnsupportedOperationException ignored) {
            // Windows: bỏ qua, dựa vào quyền thư mục người dùng.
        }
        Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING);
    }

    /** Xóa khóa định danh (chỉ dùng khi reset toàn bộ danh tính). */
    public boolean delete() {
        try {
            return Files.deleteIfExists(file);
        } catch (Exception e) {
            return false;
        }
    }

    static String b64(byte[] raw) {
        return Base64.getEncoder().encodeToString(raw);
    }
}
