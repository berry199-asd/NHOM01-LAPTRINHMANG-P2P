package com.workchat.tracker.ws;

import com.workchat.tracker.db.RoomDao;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Tính toán và đẩy địa chỉ Peer (control-plane, không relay nội dung nhắn tin). */
public final class PeerSignaling {
    private final ClientRegistry registry;
    private final RoomDao roomDao;

    public PeerSignaling(ClientRegistry registry, RoomDao roomDao) {
        this.registry = registry;
        this.roomDao = roomDao;
    }

    /**
     * Gửi {type: "peer_address", roomId, peers: [...]} tới từng thành viên online của phòng.
     * peers chứa địa chỉ TCP của các peer đã đăng ký endpoint (không kể chính mình).
     */
    public void signalRoom(long roomId) throws java.sql.SQLException {
        List<RoomDao.MemberRow> members = roomDao.members(roomId);
        for (RoomDao.MemberRow recipient : members) {
            if (!registry.isOnline(recipient.username())) {
                continue;
            }
            List<Map<String, Object>> peers = new ArrayList<>();
            for (RoomDao.MemberRow p : members) {
                if (p.userId() == recipient.userId()) {
                    continue;
                }
                ClientRegistry.PeerAddress addr = registry.peer(p.userId());
                if (addr == null || !registry.isPeerAlive(p.userId())) {
                    continue;
                }
                peers.add(Map.of(
                        "userId", p.userId(),
                        "username", addr.username(),
                        "ip", addr.ip(),
                        "port", addr.port(),
                        "pubkey", addr.pubKey() == null ? "" : addr.pubKey(),
                        "udpPort", addr.udpPort(),
                        "udpPublicIp", addr.udpPublicIp() == null ? "" : addr.udpPublicIp(),
                        "udpPublicPort", addr.udpPublicPort()
                ));
            }
            registry.sendTo(recipient.username(), Map.of(
                    "type", "peer_address",
                    "roomId", roomId,
                    "peers", peers
            ));
        }
    }

    /** Gửi peer_address cho user sau khi user đăng ký endpoint, theo mọi phòng user tham gia. */
    public void signalUserRooms(long userId) throws java.sql.SQLException {
        List<RoomDao.RoomRow> rooms = roomDao.roomsOf(userId);
        for (RoomDao.RoomRow room : rooms) {
            signalRoom(room.id());
        }
    }

    /**
     * Định tuyến sự kiện nhẹ (typing/seen/recall/reaction) theo PHÒNG qua phiên WS đã xác thực của từng thành
     * viên — KHÔNG phụ thuộc PeerLink/peer heartbeat. Dùng làm đường dự phòng khi hai Peer Core
     * không nối trực tiếp được (relay cũng cần PeerLink), hoặc khi kênh WS của máy gửi đứt nhưng
     * HTTP còn (khi đó Peer Core POST tới {@code /api/events/light}).
     *
     * <p>Chỉ chấp nhận {@code typing}/{@code seen}/{@code recall}/{@code reaction} và chỉ chuyển các trường phi nội dung
     * (roomId, messageId/clientId, emoji, remove, ts) — bảo toàn E2E: Tracker không bao giờ thấy nội dung tin.
     *
     * @return số thành viên online đã nhận; {@code -1} nếu người gửi không thuộc phòng.
     */
    public int routeLightEvent(long roomId, long fromUserId, String fromUsername,
                               Map<String, Object> event) throws java.sql.SQLException {
        Map<String, Object> safe = sanitizeLightEvent(event);
        if (safe == null) {
            return 0;
        }
        List<RoomDao.MemberRow> members = roomDao.members(roomId);
        boolean member = false;
        for (RoomDao.MemberRow m : members) {
            if (m.userId() == fromUserId) {
                member = true;
                break;
            }
        }
        if (!member) {
            return -1;
        }
        Map<String, Object> out = new java.util.LinkedHashMap<>();
        out.put("type", "light_event");
        out.put("from", fromUsername);
        out.put("fromUserId", fromUserId);
        out.put("roomId", roomId);
        out.put("event", safe);
        int sent = 0;
        for (RoomDao.MemberRow m : members) {
            if (m.userId() == fromUserId) {
                continue;
            }
            if (registry.isOnline(m.username()) && registry.sendTo(m.username(), out)) {
                sent++;
            }
        }
        return sent;
    }

    /**
     * Lọc sự kiện nhẹ trước khi chuyển tiếp: chấp nhận {@code typing}, {@code seen}, {@code recall}, {@code reaction}
     * và CHỈ giữ trường phi nội dung (type, messageId, clientId, emoji, remove, ts).
     * Trả {@code null} nếu không hợp lệ — nhờ vậy nội dung tin thật (plaintext/file) không bao giờ bị đẩy qua Tracker.
     */
    static Map<String, Object> sanitizeLightEvent(Map<String, Object> event) {
        if (event == null) {
            return null;
        }
        String type = event.get("type") == null ? "" : event.get("type").toString();
        if (!"typing".equals(type) && !"seen".equals(type) && !"recall".equals(type) && !"reaction".equals(type)) {
            return null;
        }
        Map<String, Object> safe = new java.util.LinkedHashMap<>();
        safe.put("type", type);
        if ("seen".equals(type)) {
            Object mid = event.get("messageId");
            if (mid instanceof String s && !s.isBlank() && s.length() <= 128) {
                safe.put("messageId", s);
            }
        }
        if ("recall".equals(type)) {
            Object cid = event.get("clientId");
            if (cid instanceof String s && !s.isBlank() && s.length() <= 128) {
                safe.put("clientId", s);
            }
        }
        if ("reaction".equals(type)) {
            Object cid = event.get("clientId");
            if (cid instanceof String s && !s.isBlank() && s.length() <= 128) {
                safe.put("clientId", s);
            }
            Object em = event.get("emoji");
            if (em instanceof String s && s.length() <= 10) {
                safe.put("emoji", s);
            }
            Object rm = event.get("remove");
            if (rm instanceof Boolean b) {
                safe.put("remove", b);
            }
        }
        Object ts = event.get("ts");
        if (ts instanceof Number n) {
            safe.put("ts", n.longValue());
        }
        return safe;
    }

    /**
     * Phát thông báo online/offline của một user tới mọi thành viên online cùng phòng.
     * Giúp client cập nhật trạng thái "đang hoạt động" theo thời gian thực.
     */
    public void broadcastPresence(long userId, String username, boolean online) {
        try {
            List<RoomDao.RoomRow> rooms = roomDao.roomsOf(userId);
            Set<String> recipients = new HashSet<>();
            for (RoomDao.RoomRow room : rooms) {
                for (RoomDao.MemberRow m : roomDao.members(room.id())) {
                    if (m.userId() == userId) {
                        continue;
                    }
                    if (registry.isOnline(m.username())) {
                        recipients.add(m.username());
                    }
                }
            }
            Map<String, Object> frame = Map.of(
                    "type", "presence",
                    "userId", userId,
                    "username", username == null ? "" : username,
                    "online", online);
            for (String to : recipients) {
                registry.sendTo(to, frame);
            }
        } catch (Exception ignored) {
            // không chặn auth/disconnect nếu broadcast lỗi
        }
    }
}
