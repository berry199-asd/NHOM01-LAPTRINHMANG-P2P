package com.workchat.tracker.ws;

import com.workchat.tracker.common.Json;
import com.workchat.tracker.db.RoomDao;
import com.workchat.tracker.db.SocialDao;
import com.workchat.tracker.db.UserDao;
import com.workchat.tracker.model.User;
import io.netty.channel.Channel;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.SimpleChannelInboundHandler;
import io.netty.handler.codec.http.websocketx.CloseWebSocketFrame;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import io.netty.handler.codec.http.websocketx.WebSocketFrame;
import io.netty.handler.timeout.IdleState;
import io.netty.handler.timeout.IdleStateEvent;
import io.netty.util.AttributeKey;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

public final class WsFrameHandler extends SimpleChannelInboundHandler<WebSocketFrame> {
    public static final AttributeKey<String> ATTR_USER = AttributeKey.valueOf("user");
    public static final AttributeKey<Long> ATTR_USER_ID = AttributeKey.valueOf("userId");

    private final ClientRegistry registry;
    private final UserDao dao;
    private final RoomDao roomDao;
    private final SocialDao socialDao;
    private final PeerSignaling signaling;
    private final PeerSessionResolver peerSessions;
    private final RelayGuard relayGuard = new RelayGuard();

    /** Nguồn tra cứu chìa phiên Peer Core (RAM) — tách khỏi gói http để tránh phụ thuộc vòng. */
    public interface PeerSessionResolver {
        /** Trả về userId nếu chìa hợp lệ và còn hạn, ngược lại null. */
        Long resolve(String key);
    }

    public WsFrameHandler(ClientRegistry registry, UserDao dao, RoomDao roomDao, SocialDao socialDao,
                          PeerSignaling signaling, PeerSessionResolver peerSessions) {
        this.registry = registry;
        this.dao = dao;
        this.roomDao = roomDao;
        this.socialDao = socialDao;
        this.signaling = signaling;
        this.peerSessions = peerSessions;
    }

    @Override
    protected void channelRead0(ChannelHandlerContext ctx, WebSocketFrame frame) {
        if (frame instanceof CloseWebSocketFrame) {
            ctx.close();
            return;
        }
        if (!(frame instanceof TextWebSocketFrame text)) {
            return;
        }
        Map<String, Object> msg = Json.readMap(text.text());
        String type = str(msg, "type");
        if (type == null) {
            return;
        }
        switch (type) {
            case "auth" -> onAuth(ctx, msg);
            case "signal" -> onSignal(ctx, msg);
            case "light_event" -> onLightEvent(ctx, msg);
            case "ping" -> onHeartbeat(ctx);
            case "heartbeat" -> onHeartbeat(ctx);
            case "logout" -> ctx.close();
            default -> send(ctx, Map.of("type", "error", "code", "UNKNOWN_TYPE"));
        }
    }

    /**
     * Heartbeat qua kênh WS/TCP (dual với UDP heartbeat): gia hạn presence cho Peer Core khi
     * mạng chặn gói UDP. Chỉ áp cho kết nối đã xác thực.
     */
    private void onHeartbeat(ChannelHandlerContext ctx) {
        Long uid = ctx.channel().attr(ATTR_USER_ID).get();
        if (uid != null) {
            registry.touchPeerWs(uid);
        }
        send(ctx, Map.of("type", "pong"));
    }

    private void onAuth(ChannelHandlerContext ctx, Map<String, Object> msg) {
        if (ctx.channel().hasAttr(ATTR_USER)) {
            return;
        }
        String token = str(msg, "token");
        if (token == null || token.isBlank()) {
            send(ctx, Map.of("type", "error", "code", "MISSING_TOKEN"));
            return;
        }
        try {
            User u = null;
            Optional<User> opt = dao.findUserByToken(token.trim());
            if (opt.isPresent()) {
                u = opt.get();
            } else {
                // Chấp nhận chìa phiên Peer Core (RAM) do /api/peer/exchange cấp.
                Long peerUserId = peerSessions == null ? null : peerSessions.resolve(token.trim());
                if (peerUserId != null) {
                    u = dao.findById(peerUserId).orElse(null);
                }
            }
            if (u == null) {
                send(ctx, Map.of("type", "error", "code", "UNAUTHORIZED"));
                ctx.close();
                return;
            }
            Channel old = registry.get(u.username());
            if (old != null && old.isActive() && old != ctx.channel()) {
                old.writeAndFlush(new TextWebSocketFrame(Json.write(Map.of("type", "kicked"))));
                old.close();
            }
            ctx.channel().attr(ATTR_USER).set(u.username());
            ctx.channel().attr(ATTR_USER_ID).set(u.id());
            registry.put(u.username(), ctx.channel());
            try {
                signaling.signalUserRooms(u.id());
            } catch (Exception ex) {
                // không chặn auth nếu signaling lỗi
            }
            try {
                // Phiên WS đã xác thực ⇒ người dùng đang trực tuyến → báo cho các thành viên
                // cùng phòng cập nhật chấm trạng thái theo thời gian thực.
                signaling.broadcastPresence(u.id(), u.username(), true);
            } catch (Exception ex) {
                // không chặn auth nếu broadcast lỗi
            }
            Map<String, Object> user = Map.of(
                    "id", u.id(),
                    "username", u.username(),
                    "display_name", u.displayName(),
                    "role", u.role()
            );
            send(ctx, Map.of("type", "auth_ok", "user", user));
        } catch (Exception e) {
            send(ctx, Map.of("type", "error", "code", "DB_ERROR"));
        }
    }

    /**
     * Sự kiện nhẹ typing/seen do Peer Core gửi qua WS: định tuyến theo phòng tới các thành viên
     * online (không cần PeerLink). Đây là đường dự phòng khi relay peer-to-peer không dùng được.
     */
    private void onLightEvent(ChannelHandlerContext ctx, Map<String, Object> msg) {
        String username = ctx.channel().attr(ATTR_USER).get();
        Long uid = ctx.channel().attr(ATTR_USER_ID).get();
        if (username == null || uid == null) {
            send(ctx, Map.of("type", "error", "code", "NOT_AUTHENTICATED"));
            return;
        }
        Object rv = msg.get("roomId");
        Object ev = msg.get("event");
        if (!(rv instanceof Number r) || !(ev instanceof Map<?, ?> raw)) {
            send(ctx, Map.of("type", "error", "code", "BAD_LIGHT_EVENT"));
            return;
        }
        Map<String, Object> event = new LinkedHashMap<>();
        for (Map.Entry<?, ?> e : raw.entrySet()) {
            if (e.getKey() != null) {
                event.put(e.getKey().toString(), e.getValue());
            }
        }
        try {
            int delivered = signaling.routeLightEvent(r.longValue(), uid, username, event);
            if (delivered < 0) {
                send(ctx, Map.of("type", "error", "code", "LIGHT_FORBIDDEN"));
            }
        } catch (Exception ex) {
            send(ctx, Map.of("type", "error", "code", "LIGHT_FAILED"));
        }
    }

    private void onSignal(ChannelHandlerContext ctx, Map<String, Object> msg) {
        String username = ctx.channel().attr(ATTR_USER).get();
        if (username == null) {
            send(ctx, Map.of("type", "error", "code", "NOT_AUTHENTICATED"));
            return;
        }
        String to = str(msg, "to");
        if (to == null || to.isBlank()) {
            send(ctx, Map.of("type", "error", "code", "MISSING_TO"));
            return;
        }
        Object data = msg.get("data");
        Channel target = registry.get(to);
        if (target == null || !target.isActive()) {
            send(ctx, Map.of("type", "error", "code", "NOT_ONLINE", "to", to));
            return;
        }
        // Authorize Relay: chỉ cho phép chuyển tiếp giữa 2 user cùng phòng HOẶC là bạn bè.
        Long fromId = ctx.channel().attr(ATTR_USER_ID).get();
        Long toId = target.attr(ATTR_USER_ID).get();
        if (fromId == null || toId == null) {
            send(ctx, Map.of("type", "error", "code", "RELAY_FORBIDDEN", "to", to));
            return;
        }
        try {
            boolean sameRoom = roomDao.shareRoom(fromId, toId);
            boolean friends = !sameRoom && socialDao.areFriends(fromId, toId);
            if (!sameRoom && !friends) {
                send(ctx, Map.of("type", "error", "code", "RELAY_FORBIDDEN", "to", to));
                return;
            }
        } catch (Exception ex) {
            send(ctx, Map.of("type", "error", "code", "RELAY_FORBIDDEN", "to", to));
            return;
        }
        // Giới hạn Relay (kích thước frame + tốc độ); chỉ áp cho phong bì chuyển tiếp.
        if (isRelay(data)) {
            RelayGuard.Decision d = relayGuard.check(fromId, relayBytes(data), System.currentTimeMillis());
            if (d == RelayGuard.Decision.TOO_LARGE) {
                send(ctx, Map.of("type", "error", "code", "RELAY_TOO_LARGE", "to", to));
                return;
            }
            if (d == RelayGuard.Decision.RATE_LIMITED) {
                send(ctx, Map.of("type", "error", "code", "RELAY_RATE_LIMITED", "to", to));
                return;
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("type", "signal");
        out.put("from", username);
        out.put("data", data);
        target.writeAndFlush(new TextWebSocketFrame(Json.write(out)));
    }

    @Override
    public void userEventTriggered(ChannelHandlerContext ctx, Object evt) throws Exception {
        if (evt instanceof IdleStateEvent e && e.state() == IdleState.ALL_IDLE) {
            ctx.close();
            return;
        }
        super.userEventTriggered(ctx, evt);
    }

    @Override
    public void channelInactive(ChannelHandlerContext ctx) throws Exception {
        String username = ctx.channel().attr(ATTR_USER).get();
        Long uid = ctx.channel().attr(ATTR_USER_ID).get();
        boolean wasCurrent = username != null && registry.get(username) == ctx.channel();
        if (wasCurrent) {
            registry.removeIfPresent(ctx.channel());
        }
        if (wasCurrent && username != null && uid != null && !registry.isUserOnline(uid, username)) {
            // Không còn phiên WS nào và Peer Core cũng không còn sống ⇒ thực sự offline.
            // (Nếu còn phiên khác hoặc Peer Core còn heartbeat thì giữ nguyên trạng thái online.)
            try {
                signaling.broadcastPresence(uid, username, false);
            } catch (Exception ignored) {
                // không chặn đóng kênh nếu broadcast lỗi
            }
        }
        if (uid != null) {
            relayGuard.forget(uid);
        }
        super.channelInactive(ctx);
    }

    @Override
    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
        ctx.close();
    }

    private static String str(Map<String, Object> m, String k) {
        Object v = m.get(k);
        return v == null ? null : v.toString();
    }

    /** Phong bì Relay là map có một trong các khoá "relay"/"rbytes"/"rbf". */
    private static boolean isRelay(Object data) {
        if (!(data instanceof Map<?, ?> m)) {
            return false;
        }
        return m.get("relay") instanceof String || m.get("rbytes") instanceof String
                || m.get("rbf") instanceof String;
    }

    /** Độ dài (ký tự) phong bì Relay; dùng để chặn frame vượt hạn mức. */
    private static int relayBytes(Object data) {
        if (!(data instanceof Map<?, ?> m)) {
            return 0;
        }
        for (String k : new String[] { "rbf", "rbytes", "relay" }) {
            Object v = m.get(k);
            if (v instanceof String s) {
                return s.length();
            }
        }
        return 0;
    }

    private static void send(ChannelHandlerContext ctx, Map<String, Object> payload) {
        if (!ctx.channel().isActive()) {
            return;
        }
        ctx.writeAndFlush(new TextWebSocketFrame(Json.write(payload)));
    }
}