package com.workchat.peer.offline;

import com.workchat.peer.protocol.CryptoBox;

import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Arrays;

/**
 * Kho khóa E2E (RSA-2048) bền vững, bảo vệ bằng passphrase.
 *
 * <p>Khóa được dẫn xuất bằng PBKDF2-HMAC-SHA256 (200k vòng, salt 16 byte ngẫu nhiên),
 * toàn bộ material được mã hóa AES-256-GCM. Định dạng file:
 * <pre>
 * [magic "WCPK2"(5)][salt(16)][iters(4 BE)][iv(12)][AES-GCM(payload)]
 * payload = [pubDerLen(4 BE)][pubDer(X.509)][privDerLen(4 BE)][privDer(PKCS#8)][dbKey(32)]
 * </pre>
 * {@code dbKey} là khóa AES-256 ngẫu nhiên dùng mã hóa cột {@code plaintext} của SQLite cục bộ
 * (xem {@link OfflineStore}) — nằm trong cùng kho được bảo vệ bằng passphrase nên bền vững
 * qua các lần đổi mật khẩu.
 *
 * <p>Keystore định dạng cũ "WCPK1" (không có dbKey) vẫn mở được; khi mở thành công sẽ được
 * nâng cấp ngầm lên WCPK2 (sinh dbKey mới, ghi lại với mật khẩu hiện tại).
 *
 * <p>Khóa RSA này chỉ dùng cho tính năng nhắn tin ngoại tuyến, tách biệt với khóa định
 * danh Ed25519 (dùng bắt tay mesh, lưu bền trong {@link PeerIdentityStore}).
 */
public final class E2eKeystore {
    private static final byte[] MAGIC_V1 = "WCPK1".getBytes(StandardCharsets.US_ASCII);
    private static final byte[] MAGIC_V2 = "WCPK2".getBytes(StandardCharsets.US_ASCII);
    private static final int DB_KEY_LEN = 32;
    private static final int SALT_LEN = 16;
    private static final int ITERATIONS = 200_000;
    private static final int KEY_BITS = 256;
    private static final SecureRandom RNG = new SecureRandom();

    /** Cặp khóa đã giải mã, kèm fingerprint SHA-256 (hex) của public key. */
    public static final class Material {
        private final PrivateKey priv;
        private final PublicKey pub;
        private final String fingerprint;
        private final byte[] dbKey;

        Material(PrivateKey priv, PublicKey pub, byte[] dbKey) {
            this.priv = priv;
            this.pub = pub;
            this.fingerprint = CryptoBox.fingerprintSha256(pub);
            this.dbKey = dbKey == null ? null : dbKey.clone();
        }

        public PrivateKey privateKey() {
            return priv;
        }

        public PublicKey publicKey() {
            return pub;
        }

        public String fingerprint() {
            return fingerprint;
        }

        /** Khóa AES-256 để mã hóa SQLite cục bộ (có thể null với kho cũ chưa nâng cấp). */
        public byte[] dbKey() {
            return dbKey == null ? null : dbKey.clone();
        }
    }

    /** Vùng dữ liệu peer (mặc định "peer-data", có thể đổi bằng -Dpeer.dataDir=...). */
    public static Path dataDir() {
        String dir = System.getProperty("peer.dataDir", "peer-data");
        return Path.of(dir);
    }

    /**
     * Thư mục dữ liệu riêng của một tài khoản: {@code peer-data/<userId>/}. Mỗi tài khoản
     * có vùng tách biệt (keystore, khóa định danh, ghim TOFU, SQLite ngoại tuyến) để đăng
     * nhập tài khoản khác không trộn lẫn dữ liệu.
     */
    public static Path userDataDir(long userId) {
        return dataDir().resolve(Long.toString(userId));
    }

    public static Path defaultKeystorePath(long userId) {
        return userDataDir(userId).resolve("peer.keystore");
    }

    private final Path file;

    public E2eKeystore(Path file) {
        this.file = file;
    }

    public boolean exists() {
        return Files.isRegularFile(file);
    }

    /** Mở keystore hiện có. Ném {@link IllegalStateException} khi sai passphrase hoặc file hỏng. */
    public Material open(char[] passphrase) {
        try {
            byte[] all = Files.readAllBytes(file);
            ByteBuffer buf = ByteBuffer.wrap(all);
            byte[] magic = new byte[MAGIC_V2.length];
            buf.get(magic);
            boolean v2;
            if (Arrays.equals(magic, MAGIC_V2)) {
                v2 = true;
            } else if (Arrays.equals(magic, MAGIC_V1)) {
                v2 = false;
            } else {
                throw new IllegalStateException("keystore: sai magic");
            }
            byte[] salt = new byte[SALT_LEN];
            buf.get(salt);
            int iters = buf.getInt();
            if (iters < 10_000) {
                throw new IllegalStateException("keystore: số vòng PBKDF2 không hợp lệ");
            }
            byte[] iv = new byte[CryptoBox.IV_BYTES];
            buf.get(iv);
            byte[] ct = new byte[buf.remaining()];
            buf.get(ct);
            SecretKey key = derive(passphrase, salt, iters);
            byte[] payload = aesGcm(Cipher.DECRYPT_MODE, key, iv, ct);
            ByteBuffer p = ByteBuffer.wrap(payload);
            int pubLen = p.getInt();
            if (pubLen <= 0 || pubLen > payload.length - 4) {
                throw new IllegalStateException("keystore: độ dài khóa sai");
            }
            byte[] pubDer = new byte[pubLen];
            p.get(pubDer);
            byte[] privDer;
            byte[] dbKey;
            boolean upgrade = false;
            if (v2) {
                int privLen = p.getInt();
                if (privLen <= 0 || privLen + DB_KEY_LEN > p.remaining()) {
                    throw new IllegalStateException("keystore: độ dài khóa riêng sai");
                }
                privDer = new byte[privLen];
                p.get(privDer);
                dbKey = new byte[DB_KEY_LEN];
                p.get(dbKey);
            } else {
                // WCPK1: phần còn lại là khóa riêng; sinh dbKey mới và nâng cấp ngầm.
                privDer = new byte[p.remaining()];
                p.get(privDer);
                dbKey = new byte[DB_KEY_LEN];
                RNG.nextBytes(dbKey);
                upgrade = true;
            }
            PublicKey pub = KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(pubDer));
            PrivateKey priv = KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(privDer));
            Arrays.fill(payload, (byte) 0);
            if (upgrade) {
                try {
                    store(pubDer, privDer, dbKey, passphrase);
                } catch (Exception ignored) {
                    // Không nâng cấp được (file chỉ đọc…) → vẫn dùng khóa vừa sinh trong phiên này.
                }
            }
            return new Material(priv, pub, dbKey);
        } catch (IllegalStateException e) {
            throw e;
        } catch (Exception e) {
            // Sai passphrase làm AES-GCM ném ra nhưng message không lộ thông tin.
            throw new IllegalStateException("không mở được kho khóa (sai mật khẩu?)", e);
        }
    }

    /** Tạo keystore mới (RSA-2048) rồi trả về cặp khóa đã giải mã. */
    public Material create(char[] passphrase) {
        try {
            KeyPair kp = CryptoBox.newRsa();
            byte[] dbKey = new byte[DB_KEY_LEN];
            RNG.nextBytes(dbKey);
            store(kp.getPublic().getEncoded(), kp.getPrivate().getEncoded(), dbKey, passphrase);
            return new Material(kp.getPrivate(), kp.getPublic(), dbKey);
        } catch (Exception e) {
            throw new IllegalStateException("không tạo được kho khóa", e);
        }
    }

    /**
     * Đổi passphrase cho keystore hiện có: giải mã bằng mật khẩu cũ rồi ghi lại với
     * salt/iv mới (khóa RSA và dbKey giữ nguyên). Ném {@link IllegalStateException} nếu sai mật khẩu cũ.
     */
    public Material changePassphrase(char[] oldPassphrase, char[] newPassphrase) {
        Material mat = open(oldPassphrase);
        store(mat.publicKey().getEncoded(), mat.privateKey().getEncoded(), mat.dbKey(), newPassphrase);
        return mat;
    }

    /**
     * Ghi lại keystore bằng passphrase mới từ material đã giải mã trong RAM
     * (dùng khi Core đã mở khóa và người dùng đổi mã xác thực qua OTP).
     */
    public Material reencrypt(Material mat, char[] newPassphrase) {
        if (mat == null) {
            throw new IllegalStateException("keystore material null");
        }
        store(mat.publicKey().getEncoded(), mat.privateKey().getEncoded(), mat.dbKey(), newPassphrase);
        return mat;
    }

    /** Xóa keystore (dùng khi quên mật khẩu — lần mở khóa sau sẽ tạo khóa mới). */
    public boolean delete() {
        try {
            return Files.deleteIfExists(file);
        } catch (Exception e) {
            return false;
        }
    }

    /** Ghi file keystore (định dạng WCPK2 ở javadoc lớp) nguyên tử qua file .tmp. */
    private void store(byte[] pubDer, byte[] privDer, byte[] dbKey, char[] passphrase) {
        try {
            byte[] db = new byte[DB_KEY_LEN];
            if (dbKey != null && dbKey.length == DB_KEY_LEN) {
                System.arraycopy(dbKey, 0, db, 0, DB_KEY_LEN);
            } else {
                RNG.nextBytes(db);
            }
            ByteBuffer payload = ByteBuffer.allocate(4 + pubDer.length + 4 + privDer.length + DB_KEY_LEN);
            payload.putInt(pubDer.length).put(pubDer)
                    .putInt(privDer.length).put(privDer)
                    .put(db);

            byte[] salt = new byte[SALT_LEN];
            RNG.nextBytes(salt);
            SecretKey key = derive(passphrase, salt, ITERATIONS);
            byte[] iv = new byte[CryptoBox.IV_BYTES];
            RNG.nextBytes(iv);
            byte[] ct = aesGcm(Cipher.ENCRYPT_MODE, key, iv, payload.array());

            byte[] out = ByteBuffer.allocate(MAGIC_V2.length + SALT_LEN + 4 + CryptoBox.IV_BYTES + ct.length)
                    .put(MAGIC_V2).put(salt).putInt(ITERATIONS).put(iv).put(ct).array();
            Path tmp = file.resolveSibling(file.getFileName() + ".tmp");
            Files.createDirectories(file.toAbsolutePath().getParent());
            Files.write(tmp, out);
            Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING);
        } catch (Exception e) {
            throw new IllegalStateException("không ghi được kho khóa", e);
        }
    }

    private static SecretKey derive(char[] pass, byte[] salt, int iters) throws Exception {
        SecretKeyFactory f = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
        byte[] raw = f.generateSecret(new PBEKeySpec(pass, salt, iters, KEY_BITS)).getEncoded();
        SecretKey k = new SecretKeySpec(raw, "AES");
        Arrays.fill(raw, (byte) 0);
        return k;
    }

    private static byte[] aesGcm(int mode, SecretKey key, byte[] iv, byte[] in) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(mode, key, new GCMParameterSpec(CryptoBox.GCM_TAG_BITS, iv));
        return c.doFinal(in);
    }
}
