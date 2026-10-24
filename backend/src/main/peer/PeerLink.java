package com.workchat.peer;

import com.workchat.tracker.common.Json;
import com.workchat.peer.protocol.CryptoBox;
import io.netty.buffer.ByteBuf;
import io.netty.buffer.Unpooled;
import io.netty.channel.Channel;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.SimpleChannelInboundHandler;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.PublicKey;
import java.util.Map;

/** Một kết nối TCP mesh với một peer: bắt tay RSA/AES rồi trao đổi frame JSON mã hóa (AES-GCM). */
public final class PeerLink extends SimpleChannelInboundHandler<ByteBuf> {
    private final PeerCore core;
    private final boolean initiator;
    private final long expectedUserId;
    private final KeyPair rsa;

    private volatile Channel ch;
    private volatile long remoteId;
    private volatile String remoteUsername;
    private volatile String remoteIdPub;
    private volatile String remoteRsaPub;
    private volatile String remoteNonce;
    private final String myNonce;
    private volatile SecretKey aes;
    private volatile boolean ready;
    private volatile boolean helloAckSent;

    /** Frame/binary đang đợi handshake xong; khung điều khiển luôn đi trước khối file. */
    private final FrameQueues pendingOut = new FrameQueues();

    public PeerLink(PeerCore core, boolean initiator, long expectedUserId) {
        this.core = core;
        this.initiator = initiator;
        this.expectedUserId = expectedUserId;
        this.myNonce = CryptoBox.newNonce();
        try {
            this.rsa = CryptoBox.newRsa();
        } catch (Exception e) {
            throw new IllegalStateException("rsa init", e);
        }
    }

    public boolean initiator() {
        return initiator;
    }

    public boolean ready() {
        return ready;
    }

    public boolean isActive() {
        Channel c = ch;
        return c != null && c.isActive();
    }

    /** Kênh còn chỗ trong bộ đệm ghi (dùng để ngừng bơm khối khi bên nhận chậm). */
    public boolean writable() {
        Channel c = ch;
        return c != null && c.isActive() && c.isWritable();
    }

    /** Có thể nhận thêm một khối file ngay bây giờ (kênh rảnh và hàng đợi khối chưa đầy). */
    public boolean canSendChunk() {
        return writable() && pendingOut.chunkCount() < FrameQueues.MAX_CHUNKS;
    }

    public long remoteId() {
        return remoteId;
    }

    public String remoteUsername() {
        return remoteUsername;
    }

    /** Gửi frame JSON an toàn; xếp hàng nếu chưa xong bắt tay. */
    public void send(Map<String, Object> frame) {
        enqueue(frame);
    }

    /** Số item còn nằm trong hàng đợi chờ gửi (chưa thực sự ghi ra kênh). */
    public int pendingCount() {
        return pendingOut.size();
    }

    /** Gửi một khối nhị phân (chia file) an toàn; xếp hàng nếu chưa xong bắt tay/kênh đầy. */
    public void sendBytes(byte[] data) {
        enqueue(data);
    }

    private void enqueue(Object item) {
        if (ready) {
            if (item instanceof byte[] && !writable()) {
                // khối file: chờ kênh rảnh, không ghi thêm vào bộ đệm Netty
                if (!pendingOut.addChunk(item)) {
                    writeItem(item);
                }
                return;
            }
            writeItem(item);
            return;
        }
        if (item instanceof byte[]) {
            if (!pendingOut.addChunk(item)) {
                writeItem(item);
            }
        } else {
            pendingOut.addControl(item);
        }
    }

    private void writeItem(Object item) {
        if (item instanceof byte[] b) {
            writeEncryptedBytes(b);
        } else {
            @SuppressWarnings("unchecked")
            Map<String, Object> frame = (Map<String, Object>) item;
            writeEncrypted(frame);
        }
    }

    private void flushPending() {
        pendingOut.drain(writable(), this::writeItem);
    }

    public void close() {
        Channel c = ch;
        if (c != null) {
            c.close();
        }
    }

    @Override
    public void channelActive(ChannelHandlerContext ctx) {
        this.ch = ctx.channel();
        if (initiator) {
            try {
                sendHello("hello");
            } catch (Exception e) {
                close();
            }
        }
    }

    @Override
    protected void channelRead0(ChannelHandlerContext ctx, ByteBuf frame) {
        byte[] raw = new byte[frame.readableBytes()];
        frame.readBytes(raw);
        if (!ready) {
            onPlain(new String(raw, StandardCharsets.UTF_8));
            return;
        }
        CryptoBox.Result dec = CryptoBox.decryptAes(aes, raw);
        if (dec instanceof CryptoBox.Result.Ok ok) {
            byte[] data = ok.data();
            if (data.length > 0 && (data[0] == PeerCore.FILE_TAG || data[0] == FileChunkFrame.TAG)) {
                // khối nhị phân của file transfer (định dạng cũ hoặc v2 có streamId)
                core.onFileChunk(this, data);
            } else {
                onSecure(new String(data, StandardCharsets.UTF_8));
            }
        } else {
            close();
        }
    }

    @Override
    public void channelInactive(ChannelHandlerContext ctx) {
        core.onLinkDead(this);
    }

    @Override
    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
        ctx.close();
    }

    // ---------- bắt tay (plaintext nhưng CÓ chữ ký số xác thực định danh) ----------

    private void onPlain(String json) {
        Map<String, Object> m = Json.readMap(json);
        String type = str(m, "type");
        if ("hello".equals(type) || "hello_ack".equals(type)) {
            if (!verifyHello(m)) {
                // sai chữ ký / khóa định danh không khớp signaling → từ chối (chống MITM)
                close();
                return;
            }
            if ("hello".equals(type) && !helloAckSent) {
                helloAckSent = true;
                try {
                    sendHello("hello_ack");
                } catch (Exception e) {
                    close();
                }
            } else if ("hello_ack".equals(type) && initiator && !ready) {
                try {
                    sendSession();
                } catch (Exception e) {
                    close();
                }
            }
        } else if ("session".equals(type)) {
            acceptSession(m);
        }
    }

    /** Gửi hello/hello_ack: khóa định danh + khóa phiên RSA tạm + nonce, ký bằng Ed25519. */
    private void sendHello(String type) throws Exception {
        String idPub = core.identityPubB64();
        String rsaPub = CryptoBox.pubB64(rsa.getPublic());
        long uid = core.identity().userId();
        String uname = core.identity().username();
        byte[] sig = core.signIdentity(
                helloTranscript(uid, uname, idPub, rsaPub, myNonce).getBytes(StandardCharsets.UTF_8));
        sendPlain(Map.of(
                "type", type,
                "userId", uid,
                "username", uname,
                "idPub", idPub,
                "rsa", rsaPub,
                "nonce", myNonce,
                "sig", CryptoBox.b64(sig)));
    }

    /**
     * Xác thực hello của đối phương: khóa định danh phải khớp đúng khóa mà Tracker
     * đã phân phối qua signaling cho userId này, và chữ ký phải hợp lệ trên transcript.
     */
    private boolean verifyHello(Map<String, Object> m) {
        long uid = num(m, "userId", -1);
        String uname = str(m, "username");
        String idPub = str(m, "idPub");
        String rsaPub = str(m, "rsa");
        String nonce = str(m, "nonce");
        String sigB64 = str(m, "sig");
        if (uid <= 0 || uname == null || idPub == null || rsaPub == null || nonce == null || sigB64 == null) {
            return false;
        }
        if (expectedUserId > 0 && uid != expectedUserId) {
            return false;
        }
        String expected = core.expectedIdPub(uid);
        if (expected == null || !expected.equals(idPub)) {
            return false;
        }
        boolean ok;
        try {
            PublicKey idk = CryptoBox.edPubFromB64(idPub);
            ok = CryptoBox.verifyEd(idk,
                    helloTranscript(uid, uname, idPub, rsaPub, nonce).getBytes(StandardCharsets.UTF_8),
                    CryptoBox.unb64(sigB64));
        } catch (Exception e) {
            return false;
        }
        if (!ok) {
            return false;
        }
        // TOFU: khóa định danh phải khớp khóa đã ghim lần đầu (nếu có) — chống Tracker giả trả khóa.
        if (!core.verifyTofuPin(uid, idPub)) {
            return false;
        }
        remoteId = uid;
        remoteUsername = uname;
        remoteIdPub = idPub;
        remoteRsaPub = rsaPub;
        remoteNonce = nonce;
        return true;
    }

    /** Initiator: mã hóa khóa phiên AES tới RSA tạm của đối phương (đã xác thực), kèm chữ ký. */
    private void sendSession() throws Exception {
        PublicKey peerPub = CryptoBox.pubFromB64(remoteRsaPub);
        SecretKey key = aes();
        CryptoBox.Result enc = CryptoBox.encryptAesTo(peerPub, key);
        if (!(enc instanceof CryptoBox.Result.Ok ok)) {
            throw new IllegalStateException("aes wrap");
        }
        String cipher = CryptoBox.b64(ok.data());
        byte[] sig = core.signIdentity(
                sessionTranscript(core.identity().userId(), myNonce, remoteId, remoteNonce, cipher)
                        .getBytes(StandardCharsets.UTF_8));
        sendPlain(Map.of("type", "session", "aes", cipher, "sig", CryptoBox.b64(sig)));
        markReady();
    }

    /** Acceptor: xác thực chữ ký phiên rồi giải mã khóa AES bằng RSA private của mình. */
    private void acceptSession(Map<String, Object> m) {
        String cipher = str(m, "aes");
        String sigB64 = str(m, "sig");
        if (cipher == null || sigB64 == null || remoteIdPub == null) {
            close();
            return;
        }
        long initiatorId = remoteId;
        boolean ok;
        try {
            ok = CryptoBox.verifyEd(CryptoBox.edPubFromB64(remoteIdPub),
                    sessionTranscript(initiatorId, remoteNonce, core.identity().userId(), myNonce, cipher)
                            .getBytes(StandardCharsets.UTF_8),
                    CryptoBox.unb64(sigB64));
        } catch (Exception e) {
            close();
            return;
        }
        if (!ok) {
            close();
            return;
        }
        try {
            byte[] wrapped = CryptoBox.unb64(cipher);
            CryptoBox.Result dec = CryptoBox.decryptAesFrom(rsa.getPrivate(), wrapped);
            if (dec instanceof CryptoBox.Result.Ok okd) {
                aes = CryptoBox.aesFromBytes(okd.data());
                markReady();
            } else {
                close();
            }
        } catch (Exception e) {
            close();
        }
    }

    private static String helloTranscript(long userId, String username, String idPub, String rsaPub, String nonce) {
        return "workchat-peer-hello-v1\n" + userId + "\n" + username + "\n" + idPub + "\n" + rsaPub + "\n" + nonce;
    }

    private static String sessionTranscript(long initiatorId, String initNonce, long acceptorId,
                                            String acceptorNonce, String aesCipher) {
        return "workchat-peer-session-v1\n" + initiatorId + "\n" + initNonce + "\n"
                + acceptorId + "\n" + acceptorNonce + "\n" + aesCipher;
    }

    private void markReady() {
        ready = true;
        core.onLinkReady(this);
        core.reofferFilesOnLink(remoteId);
        flushPending();
    }

    @Override
    public void channelWritabilityChanged(ChannelHandlerContext ctx) {
        if (ctx.channel().isWritable()) {
            flushPending();
            core.onLinkWritable(this);
        }
    }

    private SecretKey aes() throws Exception {
        if (aes == null) {
            aes = CryptoBox.newAes();
        }
        return aes;
    }

    /** Mã hóa payload bằng khóa AES phiên để gửi qua kênh dữ liệu UDP; null nếu chưa sẵn sàng. */
    public byte[] encryptForUdp(byte[] plain) {
        SecretKey k = aes;
        if (k == null) {
            return null;
        }
        CryptoBox.Result enc = CryptoBox.encryptAes(k, plain);
        return enc instanceof CryptoBox.Result.Ok ok ? ok.data() : null;
    }

    /** Giải mã ciphertext nhận qua UDP bằng khóa AES phiên; null nếu sai/hỏng. */
    public byte[] decryptFromUdp(byte[] data) {
        SecretKey k = aes;
        if (k == null) {
            return null;
        }
        CryptoBox.Result dec = CryptoBox.decryptAes(k, data);
        if (dec instanceof CryptoBox.Result.Ok ok) {
            return ok.data();
        }
        return null;
    }

    // ---------- ghi ----------

    private void writeEncrypted(Map<String, Object> frame) {
        SecretKey k = aes;
        if (k == null) {
            close();
            return;
        }
        String json = Json.write(frame);
        CryptoBox.Result enc = CryptoBox.encryptAes(k, json.getBytes(StandardCharsets.UTF_8));
        if (enc instanceof CryptoBox.Result.Ok ok) {
            writeRaw(ok.data());
        } else {
            close();
        }
    }

    /** AES-GCM mã hóa và gửi thẳng một khối nhị phân (đã gồm tag + seq). */
    private void writeEncryptedBytes(byte[] data) {
        SecretKey k = aes;
        if (k == null) {
            close();
            return;
        }
        CryptoBox.Result enc = CryptoBox.encryptAes(k, data);
        if (enc instanceof CryptoBox.Result.Ok ok) {
            writeRaw(ok.data());
        } else {
            close();
        }
    }

    private void sendPlain(Map<String, Object> m) {
        writeRaw(Json.write(m).getBytes(StandardCharsets.UTF_8));
    }

    private void writeRaw(byte[] data) {
        ByteBuf buf = Unpooled.buffer(4 + data.length);
        buf.writeInt(data.length);
        buf.writeBytes(data);
        Channel c = ch;
        if (c != null && c.isActive()) {
            c.writeAndFlush(buf);
        }
    }

    private void onSecure(String json) {
        Map<String, Object> m = Json.readMap(json);
        core.onPeerMessage(this, m);
    }

    private static String str(Map<String, Object> m, String k) {
        Object v = m.get(k);
        return v == null ? null : v.toString();
    }

    private static long num(Map<String, Object> m, String k, long fallback) {
        Object v = m.get(k);
        if (v instanceof Number n) {
            return n.longValue();
        }
        return fallback;
    }
}