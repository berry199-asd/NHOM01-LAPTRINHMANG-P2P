package com.workchat.peer;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.security.SecureRandom;
import java.util.Arrays;

/**
 * Mã hóa blob theo từng khối bằng AES-256-GCM với nonce TĂNG DẦN (8 byte ngẫu nhiên cho mỗi
 * file + 4 byte bộ đếm big-endian). Tracker chỉ thấy byte mã hóa, kích thước, blobId — không
 * thấy tên/loại/nội dung.
 *
 * <p>Mỗi khối xuất ra {@code [nonce(12)][ciphertext+tag]} để tự chứa nonce khi tải lên theo offset.
 * Hàm thuần, không I/O — kiểm thử được offline.
 */
public final class BlobCrypto {
    public static final int KEY_BYTES = 32;
    public static final int NONCE_BYTES = 12;
    public static final int TAG_BITS = 128;
    private static final SecureRandom RNG = new SecureRandom();

    private BlobCrypto() {
    }

    /** Sinh khóa AES-256 ngẫu nhiên cho một file. */
    public static byte[] newKey() {
        byte[] k = new byte[KEY_BYTES];
        RNG.nextBytes(k);
        return k;
    }

    /** Sinh 8 byte ngẫu nhiên đầu nonce cho một file. */
    public static byte[] newNoncePrefix() {
        byte[] n = new byte[8];
        RNG.nextBytes(n);
        return n;
    }

    /** Ghép nonce 12 byte từ tiền tố 8 byte + bộ đếm 4 byte big-endian. */
    public static byte[] nonce(byte[] prefix8, int counter) {
        byte[] n = new byte[NONCE_BYTES];
        System.arraycopy(prefix8, 0, n, 0, 8);
        n[8] = (byte) (counter >>> 24);
        n[9] = (byte) (counter >>> 16);
        n[10] = (byte) (counter >>> 8);
        n[11] = (byte) counter;
        return n;
    }

    /** Mã hóa một khối; trả {@code [nonce][ct+tag]} hoặc null nếu lỗi. */
    public static byte[] encryptBlock(byte[] key32, byte[] prefix8, int counter, byte[] plain) {
        try {
            byte[] nonce = nonce(prefix8, counter);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key32, "AES"), new GCMParameterSpec(TAG_BITS, nonce));
            byte[] ct = c.doFinal(plain);
            byte[] out = new byte[NONCE_BYTES + ct.length];
            System.arraycopy(nonce, 0, out, 0, NONCE_BYTES);
            System.arraycopy(ct, 0, out, NONCE_BYTES, ct.length);
            return out;
        } catch (Exception e) {
            return null;
        }
    }

    /** Giải mã một khối {@code [nonce][ct+tag]}; trả plaintext hoặc null nếu sai/hỏng. */
    public static byte[] decryptBlock(byte[] key32, byte[] block) {
        if (block == null || block.length <= NONCE_BYTES) {
            return null;
        }
        try {
            byte[] nonce = Arrays.copyOfRange(block, 0, NONCE_BYTES);
            byte[] ct = Arrays.copyOfRange(block, NONCE_BYTES, block.length);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key32, "AES"), new GCMParameterSpec(TAG_BITS, nonce));
            return c.doFinal(ct);
        } catch (Exception e) {
            return null;
        }
    }
}
