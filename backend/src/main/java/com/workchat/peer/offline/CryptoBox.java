package com.workchat.peer.protocol;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.OAEPParameterSpec;
import javax.crypto.spec.PSource;
import javax.crypto.spec.SecretKeySpec;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.spec.MGF1ParameterSpec;
import java.security.spec.PSSParameterSpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;

/** RSA trao đổi khóa + AES-GCM mã hóa nội dung peer-to-peer. */
public final class CryptoBox {
    public static final int AES_KEY_BYTES = 32;
    public static final int GCM_TAG_BITS = 128;
    public static final int IV_BYTES = 12;
    private static final SecureRandom RNG = new SecureRandom();
    private static final char[] HEX = "0123456789abcdef".toCharArray();

    public sealed interface Result permits Result.Ok, Result.Fail {
        record Ok(byte[] data) implements Result {
        }

        record Fail(String reason) implements Result {
        }
    }

    private CryptoBox() {
    }

    public static KeyPair newRsa() throws Exception {
        KeyPairGenerator g = KeyPairGenerator.getInstance("RSA");
        g.initialize(2048);
        return g.generateKeyPair();
    }

    // ---------- Định danh bền vững: chữ ký số Ed25519 (chống MITM) ----------

    /** Sinh cặp khóa định danh Ed25519 (dùng để ký transcript bắt tay). */
    public static KeyPair newEd25519() throws Exception {
        return KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
    }

    public static String edPubB64(PublicKey pub) {
        return Base64.getEncoder().encodeToString(pub.getEncoded());
    }

    public static PublicKey edPubFromB64(String s) throws Exception {
        byte[] raw = Base64.getDecoder().decode(s);
        return KeyFactory.getInstance("Ed25519").generatePublic(new X509EncodedKeySpec(raw));
    }

    public static String edPrivB64(PrivateKey priv) {
        return Base64.getEncoder().encodeToString(priv.getEncoded());
    }

    public static PrivateKey edPrivFromB64(String s) throws Exception {
        byte[] raw = Base64.getDecoder().decode(s);
        return KeyFactory.getInstance("Ed25519").generatePrivate(new java.security.spec.PKCS8EncodedKeySpec(raw));
    }

    public static byte[] signEd(PrivateKey priv, byte[] msg) throws Exception {
        Signature sg = Signature.getInstance("Ed25519");
        sg.initSign(priv);
        sg.update(msg);
        return sg.sign();
    }

    /** Xác thực chữ ký; trả false (không ném) khi khóa/chữ ký hỏng. */
    public static boolean verifyEd(PublicKey pub, byte[] msg, byte[] sig) {
        try {
            Signature sg = Signature.getInstance("Ed25519");
            sg.initVerify(pub);
            sg.update(msg);
            return sg.verify(sig);
        } catch (Exception e) {
            return false;
        }
    }

    /** Sinh nonce ngẫu nhiên 16 byte, biểu diễn base64. */
    public static String newNonce() {
        byte[] n = new byte[16];
        RNG.nextBytes(n);
        return Base64.getEncoder().encodeToString(n);
    }

    /** Mã hóa public key (X.509) ra base64 để trao đổi. */
    public static String pubB64(PublicKey pub) {
        return Base64.getEncoder().encodeToString(pub.getEncoded());
    }

    public static PublicKey pubFromB64(String b64) throws Exception {
        byte[] raw = Base64.getDecoder().decode(b64);
        return KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(raw));
    }

    public static SecretKey newAes() throws Exception {
        KeyGenerator g = KeyGenerator.getInstance("AES");
        g.init(AES_KEY_BYTES * 8);
        return g.generateKey();
    }

    /** Mã hóa AES key bằng RSA-OAEP SHA-256 public key của peer (chỉ connector dùng). */
    public static Result encryptAesTo(PublicKey peerPub, SecretKey aes) {
        return wrapOaep(peerPub, aes.getEncoded());
    }

    /** Giải mã AES key bằng RSA-OAEP SHA-256 private key của mình (chỉ acceptor dùng). */
    public static Result decryptAesFrom(PrivateKey priv, byte[] wrapped) {
        return unwrapOaep(priv, wrapped);
    }

    // ---------- E2E offline: RSA-OAEP(SHA-256) bọc khoá + RSA-PSS(SHA-256) ký ----------

    private static final String OAEP_TRANSFORM = "RSA/ECB/OAEPWithSHA-256AndMGF1Padding";
    private static final String PSS_TRANSFORM = "RSASSA-PSS";
    private static final int PSS_SALT_BYTES = 32;

    private static OAEPParameterSpec oaepSpec() {
        // PHẢI chỉ định MGF1 SHA-256; mặc định của JDK là MGF1 SHA-1.
        return new OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256, PSource.PSpecified.DEFAULT);
    }

    private static PSSParameterSpec pssSpec() {
        return new PSSParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256, PSS_SALT_BYTES, 1);
    }

    /** Bọc khoá AES (32 byte) bằng RSA-OAEP SHA-256 của người nhận. */
    public static Result wrapOaep(PublicKey recipientPub, byte[] aesKey) {
        try {
            Cipher c = Cipher.getInstance(OAEP_TRANSFORM);
            c.init(Cipher.ENCRYPT_MODE, recipientPub, oaepSpec());
            return new Result.Ok(c.doFinal(aesKey));
        } catch (Exception e) {
            return new Result.Fail(e.getMessage());
        }
    }

    /** Giải bọc khoá AES bằng RSA-OAEP SHA-256 với private key của mình. */
    public static Result unwrapOaep(PrivateKey recipientPriv, byte[] wrapped) {
        try {
            Cipher c = Cipher.getInstance(OAEP_TRANSFORM);
            c.init(Cipher.DECRYPT_MODE, recipientPriv, oaepSpec());
            return new Result.Ok(c.doFinal(wrapped));
        } catch (Exception e) {
            return new Result.Fail(e.getMessage());
        }
    }

    /** Ký RSA-PSS SHA-256 (salt 32 byte) trên dữ liệu. */
    public static Result signPss(PrivateKey priv, byte[] data) {
        try {
            Signature s = Signature.getInstance(PSS_TRANSFORM);
            s.setParameter(pssSpec());
            s.initSign(priv);
            s.update(data);
            return new Result.Ok(s.sign());
        } catch (Exception e) {
            return new Result.Fail(e.getMessage());
        }
    }

    /** Xác thực RSA-PSS SHA-256; trả false (không ném) khi sai. */
    public static boolean verifyPss(PublicKey pub, byte[] data, byte[] sig) {
        try {
            Signature s = Signature.getInstance(PSS_TRANSFORM);
            s.setParameter(pssSpec());
            s.initVerify(pub);
            s.update(data);
            return s.verify(sig);
        } catch (Exception e) {
            return false;
        }
    }

    /** Fingerprint = SHA-256(DER X.509 của public key), hex thường (64 ký tự). */
    public static String fingerprintSha256(PublicKey pub) {
        try {
            return hex(MessageDigest.getInstance("SHA-256").digest(pub.getEncoded()));
        } catch (Exception e) {
            throw new IllegalStateException("fingerprint", e);
        }
    }

    /** DER (X.509 SubjectPublicKeyInfo) của public key, để lưu trữ/trao đổi thô. */
    public static byte[] publicKeyDer(PublicKey pub) {
        return pub.getEncoded();
    }

    public static PublicKey publicKeyFromDer(byte[] der) throws Exception {
        return KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(der));
    }

    public static String hex(byte[] b) {
        char[] out = new char[b.length * 2];
        for (int i = 0; i < b.length; i++) {
            int v = b[i] & 0xFF;
            out[i * 2] = HEX[v >>> 4];
            out[i * 2 + 1] = HEX[v & 0x0F];
        }
        return new String(out);
    }

    public static SecretKey aesFromBytes(byte[] raw) {
        return new SecretKeySpec(raw, "AES");
    }

    /** AES-GCM encrypt với IV 12 byte (đầu ciphertext). */
    public static Result encryptAes(SecretKey key, byte[] plain) {
        try {
            byte[] iv = new byte[IV_BYTES];
            RNG.nextBytes(iv);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_BITS, iv));
            byte[] ct = c.doFinal(plain);
            byte[] out = new byte[iv.length + ct.length];
            System.arraycopy(iv, 0, out, 0, iv.length);
            System.arraycopy(ct, 0, out, iv.length, ct.length);
            return new Result.Ok(out);
        } catch (Exception e) {
            return new Result.Fail(e.getMessage());
        }
    }

    public static Result decryptAes(SecretKey key, byte[] data) {
        try {
            byte[] iv = new byte[IV_BYTES];
            byte[] ct = new byte[data.length - IV_BYTES];
            System.arraycopy(data, 0, iv, 0, IV_BYTES);
            System.arraycopy(data, IV_BYTES, ct, 0, ct.length);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_BITS, iv));
            return new Result.Ok(c.doFinal(ct));
        } catch (Exception e) {
            return new Result.Fail(e.getMessage());
        }
    }

    public static String b64(byte[] raw) {
        return Base64.getEncoder().encodeToString(raw);
    }

    public static byte[] unb64(String s) {
        return Base64.getDecoder().decode(s);
    }
}