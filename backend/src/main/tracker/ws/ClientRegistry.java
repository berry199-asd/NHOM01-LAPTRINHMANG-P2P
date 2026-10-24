package com.workchat.tracker.ws;

import com.workchat.tracker.common.Json;
import io.netty.channel.Channel;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;

public final class ClientRegistry {
    public record PeerAddress(String username, String ip, int port, String pubKey,
                              int udpPort, String udpPublicIp, int udpPublicPort) {
    }

    private final Map<String, Channel> sessions = new ConcurrentHashMap<>();
    /** Địa chỉ Peer Core (TCP P2P) đã đăng ký, key = userId. */
    private final Map<Long, PeerAddress> peers = new ConcurrentHashMap<>();
    /** Bí mật heartbeat cấp cho mỗi Peer Core lúc đăng ký (chống giả mạo gói UDP). */
    private final Map<Long, String> hbSecrets = new ConcurrentHashMap<>();
    /** Thời điểm nhận heartbeat/signal cuối cùng, key = userId. */
    private final Map<Long, Long> lastSeen = new ConcurrentHashMap<>();
    /** Quá hạn này (ms) không có heartbeat → coi như offline và gỡ khỏi danh sách. */
    private volatile long peerTtlMs = 10_000;

    public void put(String username, Channel ch) {
        sessions.put(username, ch);
    }

    public Channel get(String username) {
        return sessions.get(username);
    }

    public boolean isOnline(String username) {
        return sessions.containsKey(username);
    }

    public String removeIfPresent(Channel ch) {
        for (Map.Entry<String, Channel> e : sessions.entrySet()) {
            if (e.getValue() == ch && sessions.remove(e.getKey(), ch)) {
                return e.getKey();
            }
        }
        return null;
    }

    public int onlineCount() {
        return sessions.size();
    }

    public void setPeerTtlMs(long ttlMs) {
        if (ttlMs > 0) {
            this.peerTtlMs = ttlMs;
        }
    }

    public long peerTtlMs() {
        return peerTtlMs;
    }

    /** Đăng ký endpoint peer; trả về bí mật heartbeat để peer dùng cho gói UDP. */
    public String setPeer(long userId, String username, String ip, int port, String pubKey,
                          int udpPort, String udpPublicIp, int udpPublicPort) {
        String secret = Long.toHexString(ThreadLocalRandom.current().nextLong());
        peers.put(userId, new PeerAddress(username, ip, port, pubKey == null ? "" : pubKey,
                udpPort, udpPublicIp == null ? "" : udpPublicIp, udpPublicPort));
        hbSecrets.put(userId, secret);
        lastSeen.put(userId, System.currentTimeMillis());
        return secret;
    }

    /** Cập nhật sống còn nếu bí mật khớp; trả về true nếu heartbeat hợp lệ. */
    public boolean touchPeer(long userId, String secret) {
        if (secret == null) {
            return false;
        }
        String expected = hbSecrets.get(userId);
        if (expected == null || !expected.equals(secret)) {
            return false;
        }
        lastSeen.put(userId, System.currentTimeMillis());
        return true;
    }

    /**
     * Heartbeat qua kênh WS/TCP đã xác thực (không cần bí mật UDP). Gia hạn presence nếu peer
     * đã đăng ký — dùng khi mạng chặn UDP heartbeat. Trả về true nếu peer tồn tại.
     */
    public boolean touchPeerWs(long userId) {
        if (!peers.containsKey(userId)) {
            return false;
        }
        lastSeen.put(userId, System.currentTimeMillis());
        return true;
    }

    public PeerAddress peer(long userId) {
        return peers.get(userId);
    }

    public boolean isPeerAlive(long userId) {
        return peers.containsKey(userId) && !isStale(userId, System.currentTimeMillis());
    }

    /**
     * Người dùng được coi là "đang trực tuyến" nếu đang mở phiên WS đã xác thực (Peer Core đã
     * kết nối signaling) HOẶC Peer Core của họ còn sống (đã đăng ký endpoint và còn heartbeat).
     *
     * <p>Nhờ vậy trạng thái online phản ánh đúng cả khi Peer Core vừa kết nối chưa kịp đăng ký
     * endpoint, hoặc khi endpoint tạm hết hạn nhưng phiên WS vẫn mở.
     */
    public boolean isUserOnline(long userId, String username) {
        return (username != null && isOnline(username)) || isPeerAlive(userId);
    }

    /** Thời điểm nhận heartbeat cuối (epoch ms), 0 nếu chưa từng đăng ký. */
    public long lastSeenAt(long userId) {
        Long seen = lastSeen.get(userId);
        return seen == null ? 0L : seen;
    }

    /** Username gắn với peer đã đăng ký; null nếu chưa có. */
    public String usernameOf(long userId) {
        PeerAddress addr = peers.get(userId);
        return addr == null ? null : addr.username();
    }

    /** Các userId đang sống (đã đăng ký và còn heartbeat trong hạn). */
    public List<Long> alivePeerIds() {
        long now = System.currentTimeMillis();
        List<Long> out = new ArrayList<>();
        for (Long uid : peers.keySet()) {
            if (!isStale(uid, now)) {
                out.add(uid);
            }
        }
        return out;
    }

    public int peerCount() {
        return peers.size();
    }

    public int alivePeerCount() {
        long now = System.currentTimeMillis();
        int c = 0;
        for (Long uid : peers.keySet()) {
            if (!isStale(uid, now)) {
                c++;
            }
        }
        return c;
    }

    /** Danh sách userId đã quá hạn heartbeat (để sweeper dọn dẹp). */
    public List<Long> stalePeerIds() {
        long now = System.currentTimeMillis();
        List<Long> out = new ArrayList<>();
        for (Long uid : peers.keySet()) {
            if (isStale(uid, now)) {
                out.add(uid);
            }
        }
        return out;
    }

    private boolean isStale(long userId, long now) {
        Long seen = lastSeen.get(userId);
        return seen == null || now - seen > peerTtlMs;
    }

    public void clearPeer(long userId) {
        peers.remove(userId);
        hbSecrets.remove(userId);
        lastSeen.remove(userId);
    }

    public boolean sendTo(String username, Map<String, Object> payload) {
        Channel ch = sessions.get(username);
        if (ch == null || !ch.isActive()) {
            return false;
        }
        ch.writeAndFlush(new TextWebSocketFrame(Json.write(payload)));
        return true;
    }

    /** Username của mọi phiên WS đang mở (dùng để phát thông báo hệ thống). */
    public List<String> onlineUsernames() {
        return new ArrayList<>(sessions.keySet());
    }

    /** Gửi một payload tới mọi phiên WS đang mở; trả về số phiên gửi thành công. */
    public int sendToAll(Map<String, Object> payload) {
        String json = Json.write(payload);
        int sent = 0;
        for (Map.Entry<String, Channel> e : sessions.entrySet()) {
            Channel ch = e.getValue();
            if (ch != null && ch.isActive()) {
                ch.writeAndFlush(new TextWebSocketFrame(json));
                sent++;
            }
        }
        return sent;
    }

    /** Số peer đang sống có địa chỉ công khai (ứng viên P2P trực tiếp). */
    public int p2pPeerCount() {
        long now = System.currentTimeMillis();
        int c = 0;
        for (Map.Entry<Long, PeerAddress> e : peers.entrySet()) {
            if (!isStale(e.getKey(), now)
                    && e.getValue() != null && e.getValue().udpPublicPort() > 0) {
                c++;
            }
        }
        return c;
    }
}
