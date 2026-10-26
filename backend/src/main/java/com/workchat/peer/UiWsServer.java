package com.workchat.peer;

import com.workchat.tracker.common.Json;
import io.netty.bootstrap.ServerBootstrap;
import io.netty.channel.Channel;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.ChannelInitializer;
import io.netty.channel.ChannelOption;
import io.netty.channel.EventLoopGroup;
import io.netty.channel.SimpleChannelInboundHandler;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.SocketChannel;
import io.netty.channel.socket.nio.NioServerSocketChannel;
import io.netty.handler.codec.http.HttpHeaderNames;
import io.netty.handler.codec.http.HttpObjectAggregator;
import io.netty.handler.codec.http.HttpServerCodec;
import io.netty.handler.codec.http.websocketx.CloseWebSocketFrame;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import io.netty.handler.codec.http.websocketx.WebSocketFrame;
import io.netty.handler.codec.http.websocketx.WebSocketServerProtocolHandler;

import com.workchat.peer.offline.OfflineStore;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * WebSocket nội bộ (chỉ 127.0.0.1) cho React: hello/bind/unbind + lệnh send/seen + E2E.
 *
 * <p>Bảo mật (M3): chỉ bind trên loopback; kiểm {@code Origin} theo allowlist và
 * {@code Host} chống DNS rebinding; giới hạn tần suất hello/bind. Khi chưa bind,
 * mọi lệnh ngoài hello/bind/unbind bị từ chối {@code not_bound}.
 */
public final class UiWsServer {
    /** Các tín hiệu thiết lập cuộc gọi (WebRTC) được chuyển qua kênh sự kiện nhẹ. */
    private static final Set<String> CALL_SIGNALS = Set.of(
            "invite", "accept", "reject", "cancel", "end", "offer", "answer", "ice", "presence");

    /** Cấu hình bảo mật cho UI WS. */
    public record Security(Set<String> allowedOrigins, boolean allowAnyOrigin, boolean allowNoOrigin) {
        /**
         * Mặc định: cho phép frontend dev loopback:8443 (cả HTTP lẫn HTTPS vì Vite dev phục vụ
         * HTTPS tự ký khi cần mic/camera); thêm origin qua env.
         *
         * <p>Trước đây mặc định CHỈ có HTTP, nên khi Peer Core được khởi động không kèm
         * {@code PEER_UI_ALLOWED_ORIGINS} (vd chạy từ IDE), UI mở bằng {@code https://localhost:8443}
         * bị từ chối ngay ở bắt tay WS — mọi cuộc gọi/tin nhắn im lặng (LỖI B). Thêm HTTPS
         * loopback là mở rộng thuần tuý, không nới lỏng sang host khác.
         */
        public static Security fromEnv() {
            String extra = System.getenv("PEER_UI_ALLOWED_ORIGINS");
            Set<String> origins = new HashSet<>(Arrays.asList(
                    "http://localhost:8443", "http://127.0.0.1:8443",
                    "https://localhost:8443", "https://127.0.0.1:8443"));
            if (extra != null && !extra.isBlank()) {
                for (String o : extra.split(",")) {
                    String t = o.trim();
                    if (!t.isEmpty()) {
                        origins.add(t);
                    }
                }
            }
            boolean any = truthy(System.getenv("PEER_UI_ALLOW_ANY_ORIGIN"));
            boolean noOrigin = truthy(System.getenv("PEER_UI_ALLOW_NO_ORIGIN"));
            return new Security(origins, any, noOrigin);
        }

        /** Kiểm tra một Origin có được phép mở UI WS không (dùng chung với bắt tay và cho test). */
        public boolean originAllowed(String origin) {
            if (allowAnyOrigin) {
                return true;
            }
            if (origin == null || origin.isBlank()) {
                return allowNoOrigin;
            }
            if (allowedOrigins.contains(origin)) {
                return true;
            }
            try {
                java.net.URI u = java.net.URI.create(origin);
                String scheme = u.getScheme();
                int p = u.getPort();
                String h = u.getHost();
                if (("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))
                        && (p == 8443 || p == 5173 || p == -1)
                        && h != null) {
                    if (h.equalsIgnoreCase("localhost") || h.equals("127.0.0.1") || h.equals("[::1]")
                            || com.workchat.peer.net.LocalNetworks.isPrivate(h)) {
                        return true;
                    }
                }
            } catch (Exception ignored) {
            }
            return false;
        }

        private static boolean truthy(String v) {
            return v != null && (v.equals("1") || v.equalsIgnoreCase("true") || v.equalsIgnoreCase("on"));
        }
    }

    private final PeerCore core;
    private final PeerAutoBinder binder;
    private final String ip;
    private final int port;
    private final Security security;

    public UiWsServer(PeerCore core, PeerAutoBinder binder, String ip, int port, Security security) {
        this.core = core;
        this.binder = binder;
        this.ip = ip;
        this.port = port;
        this.security = security == null ? Security.fromEnv() : security;
    }

    /**
     * Lọc trắng một khung {@code call} từ UI thành frame gửi qua kênh sự kiện nhẹ.
     *
     * <p>Trả về frame đã lọc (có {@code t=call}, {@code roomId}, {@code signal}, {@code callId})
     * hoặc {@code null} nếu khung KHÔNG hợp lệ; lý do được ghi vào {@code errorOut} để UI báo
     * ngay cho người dùng thay vì bỏ im lặng (LỖI B: bên gọi treo chuông 45s mà không biết vì sao).
     */
    static Map<String, Object> sanitizeCall(Map<String, Object> m, List<String> errorOut) {
        Object rv = m.get("roomId");
        Object sigv = m.get("signal");
        String sig = sigv instanceof String s ? s : null;
        if (!(rv instanceof Number r) || sig == null || !CALL_SIGNALS.contains(sig)) {
            fail(errorOut, "thieu roomId hoac tin hieu khong hop le");
            return null;
        }
        Object cidv = m.get("callId");
        if (!(cidv instanceof String cs) || !cs.matches("^[0-9A-Za-z_-]{4,72}$")) {
            fail(errorOut, "callId khong hop le");
            return null;
        }
        Object tov = m.get("to");
        if (tov != null && !(tov instanceof Number)) {
            fail(errorOut, "truong to khong phai so");
            return null;
        }
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("t", "call");
        fields.put("roomId", r.longValue());
        fields.put("signal", sig);
        fields.put("callId", cs);
        Object kindv = m.get("kind");
        if (kindv instanceof String ks && ("voice".equals(ks) || "video".equals(ks))) {
            fields.put("kind", ks);
        }
        if (tov instanceof Number tn) {
            fields.put("to", tn.longValue());
        }
        Object cnv = m.get("callerName");
        if (cnv instanceof String cns && cns.length() <= 128) {
            fields.put("callerName", cns);
        }
        // Tín hiệu `presence` (cuộc gọi nhóm đang diễn ra): chỉ là định danh, không nội dung.
        Object callerIdv = m.get("callerId");
        if (callerIdv instanceof Number cidn) {
            fields.put("callerId", cidn.longValue());
        }
        Object startedAtv = m.get("startedAt");
        if (startedAtv instanceof Number san) {
            fields.put("startedAt", san.longValue());
        }
        Object pv = m.get("participants");
        if (pv == null) {
            pv = m.get("participantIds");
        }
        if (pv instanceof List<?> pl) {
            List<Long> ids = new ArrayList<>();
            for (Object item : pl) {
                if (ids.size() >= 256) {
                    break;
                }
                if (item instanceof Number n) {
                    ids.add(n.longValue());
                }
            }
            fields.put("participants", ids);
        }
        Object sdpv = m.get("sdp");
        if (sdpv instanceof String ss && ss.length() <= 65536) {
            fields.put("sdp", ss);
        }
        Object stv = m.get("sdpType");
        if (stv instanceof String st && ("offer".equals(st) || "answer".equals(st))) {
            fields.put("sdpType", st);
        }
        Object candv = m.get("candidate");
        if (candv instanceof Map<?, ?> cm) {
            Map<String, Object> cand = new LinkedHashMap<>();
            Object c = cm.get("candidate");
            if (c instanceof String cs2 && cs2.length() <= 4096) {
                cand.put("candidate", cs2);
            }
            Object mline = cm.get("sdpMLineIndex");
            if (mline instanceof Number mn) {
                cand.put("sdpMLineIndex", mn.intValue());
            }
            Object mid = cm.get("sdpMid");
            if (mid instanceof String ms && ms.length() <= 64) {
                cand.put("sdpMid", ms);
            }
            fields.put("candidate", cand);
        }
        Object reasonv = m.get("reason");
        if (reasonv instanceof String rs && rs.length() <= 64) {
            fields.put("reason", rs);
        }
        return fields;
    }

    private static void fail(List<String> errorOut, String reason) {
        if (errorOut != null) {
            errorOut.add(reason);
        }
    }

    public void run() throws InterruptedException {
        EventLoopGroup boss = new NioEventLoopGroup(1);
        EventLoopGroup worker = new NioEventLoopGroup();
        try {
            ServerBootstrap b = new ServerBootstrap();
            b.group(boss, worker)
                    .channel(NioServerSocketChannel.class)
                    .option(ChannelOption.SO_REUSEADDR, true)
                    .childOption(ChannelOption.TCP_NODELAY, true)
                    .childHandler(new ChannelInitializer<SocketChannel>() {
                        @Override
                        protected void initChannel(SocketChannel ch) {
                            ch.pipeline().addLast(new HttpServerCodec());
                            ch.pipeline().addLast(new HttpObjectAggregator(10 * 1024 * 1024));
                            ch.pipeline().addLast(new WebSocketServerProtocolHandler("/ui", null, true, 10 * 1024 * 1024));
                            ch.pipeline().addLast(new UiWsHandler(core, binder, security));
                        }
                    });
            Channel ch = b.bind(ip, port).sync().channel();
            ch.closeFuture().sync();
        } finally {
            boss.shutdownGracefully().syncUninterruptibly();
            worker.shutdownGracefully().syncUninterruptibly();
        }
    }

    private static final class UiWsHandler extends SimpleChannelInboundHandler<WebSocketFrame> {
        private final PeerCore core;
        private final PeerAutoBinder binder;
        private final Security security;
        private boolean allowed;
        private long windowStart;
        private int helloCount;
        private int bindCount;
        private String origin;

        UiWsHandler(PeerCore core, PeerAutoBinder binder, Security security) {
            this.core = core;
            this.binder = binder;
            this.security = security;
        }

        @Override
        public void userEventTriggered(ChannelHandlerContext ctx, Object evt) {
            if (evt instanceof WebSocketServerProtocolHandler.HandshakeComplete hs) {
                if (!originAllowed(hs) || !hostAllowed(hs)) {
                    ctx.close();
                    return;
                }
                origin = hs.requestHeaders() == null ? null
                        : hs.requestHeaders().get(HttpHeaderNames.ORIGIN);
                allowed = true;
                windowStart = System.currentTimeMillis();
                core.registerUi(ctx.channel());
            }
            ctx.fireUserEventTriggered(evt);
        }

        /** Kiểm Origin theo allowlist; thiếu Origin chỉ chấp nhận khi bật cờ gỡ lỗi. */
        private boolean originAllowed(WebSocketServerProtocolHandler.HandshakeComplete hs) {
            String origin = hs.requestHeaders() == null ? null
                    : hs.requestHeaders().get(HttpHeaderNames.ORIGIN);
            return security.originAllowed(origin);
        }

        /** Chống DNS rebinding: Host phải trỏ loopback. */
        private boolean hostAllowed(WebSocketServerProtocolHandler.HandshakeComplete hs) {
            if (security.allowAnyOrigin()) {
                return true;
            }
            String host = hs.requestHeaders() == null ? null
                    : hs.requestHeaders().get(HttpHeaderNames.HOST);
            if (host == null || host.isBlank()) {
                return false;
            }
            String h = host;
            int colon = host.lastIndexOf(':');
            if (colon > 0) {
                h = host.substring(0, colon);
            }
            h = h.trim().toLowerCase(java.util.Locale.ROOT);
            return h.equals("127.0.0.1") || h.equals("localhost") || h.equals("[::1]");
        }

        /** Giới hạn tần suất hello/bind theo cửa sổ 60s cho mỗi kênh. */
        private boolean rateAllow(String kind) {
            long now = System.currentTimeMillis();
            if (now - windowStart >= 60_000L) {
                windowStart = now;
                helloCount = 0;
                bindCount = 0;
            }
            if ("hello".equals(kind)) {
                if (helloCount >= 12) {
                    return false;
                }
                helloCount++;
                return true;
            }
            if (bindCount >= 20) {
                return false;
            }
            bindCount++;
            return true;
        }

        @Override
        protected void channelRead0(ChannelHandlerContext ctx, WebSocketFrame frame) {
            if (frame instanceof CloseWebSocketFrame) {
                core.unregisterUi(ctx.channel());
                ctx.close();
                return;
            }
            if (!(frame instanceof TextWebSocketFrame text)) {
                return;
            }
            if (!allowed) {
                ctx.close();
                return;
            }
            Map<String, Object> m = Json.readMap(text.text());
            String type = m.get("type") == null ? null : m.get("type").toString();

            if ("hello".equals(type)) {
                if (!rateAllow("hello")) {
                    send(ctx, Map.of("type", "error", "code", "rate_limited"));
                    return;
                }
                send(ctx, helloFrame());
                return;
            }
            if ("bind".equals(type)) {
                if (!rateAllow("bind")) {
                    send(ctx, Map.of("type", "bind_error", "error", "rate_limited"));
                    return;
                }
                String ticket = m.get("ticket") instanceof String s ? s : null;
                if (binder != null) {
                    send(ctx, binder.bind(ticket));
                } else {
                    send(ctx, Map.of("type", "bind_error", "error", "no_binder"));
                }
                return;
            }
            if ("unbind".equals(type) || "logout".equals(type)) {
                if (binder != null) {
                    binder.unbind();
                } else {
                    core.revokeSession();
                }
                send(ctx, Map.of("type", "unbound", "ok", true));
                return;
            }
            // Ping/pong để UI đo độ trễ tới Peer Core (không cần đã bind).
            if ("ping".equals(type)) {
                Object tsv = m.get("ts");
                send(ctx, Map.of("type", "pong", "ts", tsv instanceof Number n ? n.longValue() : 0L));
                return;
            }

            // Mọi lệnh khác yêu cầu đã bind.
            if (!core.isBound()) {
                send(ctx, Map.of("type", "error", "code", "not_bound"));
                return;
            }

            if ("send".equals(type)) {
                Object rv = m.get("roomId");
                Object tv = m.get("text");
                if (rv instanceof Number r && tv instanceof String t) {
                    Object cv = m.get("clientId");
                    String cid = cv instanceof String s && s.matches("^[0-9A-Za-z_:-]{8,64}$") ? s : null;
                    Object rcv = m.get("replyToClientId");
                    String replyTo = rcv instanceof String s && s.matches("^[0-9A-Za-z_:-]{8,64}$") ? s : null;
                    Map<String, Object> ss = new LinkedHashMap<>();
                    ss.put("type", "send_state");
                    ss.put("roomId", r.longValue());
                    ss.put("clientId", cid == null ? "" : cid);
                    try {
                        com.workchat.peer.PeerCore.SendResult res = core.sendChat(r.longValue(), t, cid, replyTo);
                        ss.put("state", res.acked() ? "sent" : "stored");
                        send(ctx, ss);
                        if (res.meshCount() == 0 && !res.acked() && !res.queued()) {
                            send(ctx, Map.of("type", "error", "code", "NO_PEERS_ONLINE"));
                        }
                    } catch (Exception e) {
                        // Luôn trả send_state để UI không kẹt "Đang gửi…"; kênh vẫn dùng tiếp.
                        ss.put("state", "stored");
                        ss.put("error", "SEND_FAILED");
                        send(ctx, ss);
                        System.err.println("[peer-send] send lỗi: " + e.getMessage());
                    }
                }
            } else if ("seen".equals(type)) {
                Object rv = m.get("roomId");
                Object mv = m.get("messageId");
                if (rv instanceof Number r && mv instanceof String s) {
                    core.sendSeen(r.longValue(), s);
                }
            } else if ("typing".equals(type) || "edit".equals(type) || "recall".equals(type) || "reaction".equals(type)) {
                Object rv = m.get("roomId");
                if (rv instanceof Number r) {
                    java.util.Map<String, Object> fields = new java.util.HashMap<>();
                    fields.put("t", type);
                    Object cv = m.get("clientId");
                    if (cv instanceof String s && s.matches("^[0-9A-Za-z_:-]{8,64}$")) {
                        fields.put("clientId", s);
                    }
                    Object tv = m.get("text");
                    if (tv instanceof String ts) {
                        fields.put("text", ts);
                    }
                    Object ev = m.get("emoji");
                    if (ev instanceof String es) {
                        fields.put("emoji", es);
                    }
                    Object rmv = m.get("remove");
                    if (rmv instanceof Boolean rb) {
                        fields.put("remove", rb);
                    }
                    fields.put("roomId", r.longValue());
                    core.sendEvent(r.longValue(), fields);
                    if ("edit".equals(type) && cv instanceof String cid && tv instanceof String ts) {
                        core.applyLocalEdit(cid, ts);
                    }
                    if ("recall".equals(type) && cv instanceof String cid) {
                        core.applyLocalRecall(cid);
                    }
                }
            } else if ("call".equals(type)) {
                // Tín hiệu thiết lập cuộc gọi (WebRTC) — forward qua kênh sự kiện nhẹ.
                // Danh sách trường được lọc trắng; không lưu offline (đúng cho chuông cuộc gọi).
                List<String> err = new ArrayList<>(1);
                Map<String, Object> fields = sanitizeCall(m, err);
                if (fields == null) {
                    // LỖI B: trước đây khung sai bị bỏ IM LẶNG nên bên gọi treo chuông 45s
                    // mà không hiểu vì sao. Nay trả lỗi RÕ ràng cho UI.
                    String reason = err.isEmpty() ? "khung cuoc goi khong hop le" : err.get(0);
                    CallDebug.log("ui-gui-bo", Map.of("lyDo", reason));
                    send(ctx, Map.of("type", "error", "code", "bad_call", "error", reason));
                    return;
                }
                CallDebug.log("ui-gui", CallDebug.summary(fields));
                PeerCore.Identity id = core.identity();
                if (id != null) {
                    fields.putIfAbsent("fromUserId", id.userId());
                    fields.putIfAbsent("fromUsername", id.username());
                }
                PeerCore.EventSendResult sr = core.sendEvent(((Number) fields.get("roomId")).longValue(), fields);
                CallDebug.log("ui-gui-ket-qua", Map.of(
                        "signal", String.valueOf(fields.get("signal")),
                        "state", sr.state(),
                        "via", String.valueOf(sr.via()),
                        "peers", sr.peers(),
                        "pending", sr.pending()));
            } else if ("unlock".equals(type)) {
                Object pv = m.get("passphrase");
                String pass = pv instanceof String s ? s : null;
                // KDF + mở keystore là việc nặng: KHÔNG chạy trên vòng sự kiện UI WS.
                core.runAsync("unlock", () -> {
                    Map<String, Object> res = core.unlock(pass);
                    send(ctx, res);
                    if (Boolean.TRUE.equals(res.get("ok"))) {
                        // Xả outbox đang chờ rồi kéo hộp thư; vẫn ở luồng nền.
                        core.retryPending();
                        core.pullOffline();
                    }
                });
            } else if ("lock".equals(type)) {
                core.lock();
                send(ctx, Map.of("type", "locked", "ok", true));
            } else if ("change_passphrase".equals(type)) {
                Object ov = m.get("oldPassphrase");
                Object nv = m.get("newPassphrase");
                Object tv = m.get("ticket");
                if (tv instanceof String ticket && !ticket.isBlank()) {
                    send(ctx, core.changePassphraseWithTicket(ticket, nv instanceof String ns ? ns : null));
                } else {
                    send(ctx, core.changePassphrase(
                            ov instanceof String os ? os : null,
                            nv instanceof String ns ? ns : null));
                }
            } else if ("reset_keystore".equals(type)) {
                send(ctx, core.resetKeystore());
            } else if ("offline_pull".equals(type)) {
                core.runAsync("offline_pull", () -> {
                    int n = core.pullOffline();
                    send(ctx, Map.of("type", "offline_pull_done", "count", n));
                });
            } else if ("retry".equals(type)) {
                Object cv = m.get("clientId");
                if (cv instanceof String cid && !cid.isBlank()) {
                    core.runAsync("retry", () -> {
                        core.retryMessage(cid);
                        send(ctx, Map.of("type", "retry_done", "count", 0));
                    });
                } else {
                    core.runAsync("retry_pending", () -> {
                        int n = core.retryPending();
                        send(ctx, Map.of("type", "retry_done", "count", n));
                    });
                }
            } else if ("delivery".equals(type)) {
                Object cv = m.get("clientId");
                Object rv = m.get("recipientId");
                if (cv instanceof String cid && rv instanceof Number rid) {
                    core.runAsync("delivery", () -> core.markDelivered(cid, rid.longValue()));
                }
            } else if ("decrypt_batch".equals(type)) {
                Object idsObj = m.get("clientMsgIds");
                if (idsObj instanceof List<?> list) {
                    List<String> cids = new ArrayList<>();
                    for (Object o : list) {
                        if (o instanceof String s && !s.isBlank()) cids.add(s);
                    }
                    core.runAsync("decrypt_batch", () -> {
                        List<Map<String, Object>> items = new ArrayList<>();
                        for (String cid : cids) {
                            try {
                                OfflineStore.LocalMsg msg = core.localMsg(cid);
                                if (msg != null && msg.plaintext() != null) {
                                    Map<String, Object> item = new LinkedHashMap<>();
                                    item.put("clientMsgId", msg.clientMsgId());
                                    item.put("roomId", msg.roomId());
                                    item.put("text", msg.plaintext());
                                    item.put("status", msg.status());
                                    item.put("contentType", msg.contentType());
                                    items.add(item);
                                }
                            } catch (Exception ignored) {}
                        }
                        send(ctx, Map.of("type", "decrypt_batch_res", "items", items));
                    });
                }
            } else if ("history".equals(type)) {
                Object rv = m.get("roomId");
                if (rv instanceof Number r) {
                    long roomId = r.longValue();
                    int lim = m.get("limit") instanceof Number l ? Math.min(Math.max(1, l.intValue()), 100) : 50;
                    long before = m.get("before") instanceof Number b ? b.longValue() : Long.MAX_VALUE;
                    core.runAsync("ui_history", () -> {
                        List<OfflineStore.LocalMsg> page = before == Long.MAX_VALUE
                                ? core.localHistory(roomId, lim)
                                : core.localHistoryBefore(roomId, before, lim);
                        List<Map<String, Object>> items = new ArrayList<>();
                        for (OfflineStore.LocalMsg msg : page) {
                            Map<String, Object> mm = new LinkedHashMap<>();
                            mm.put("clientMsgId", msg.clientMsgId());
                            mm.put("roomId", msg.roomId());
                            mm.put("senderId", msg.senderId());
                            mm.put("contentType", msg.contentType());
                            mm.put("text", msg.plaintext());
                            mm.put("sentAt", msg.sentAt());
                            mm.put("direction", msg.direction());
                            mm.put("status", msg.status());
                            items.add(mm);
                        }
                        boolean hasMore = !page.isEmpty()
                                && core.hasMoreHistoryBefore(roomId, page.get(page.size() - 1).sentAt());
                        Map<String, Object> out = new LinkedHashMap<>();
                        out.put("type", "history");
                        out.put("roomId", roomId);
                        out.put("messages", items);
                        out.put("hasMore", hasMore);
                        send(ctx, out);
                    });
                }
            } else if ("file_begin".equals(type)) {
                // Cấp fileId + vé upload một lần; UI PUT byte thô lên HTTP loopback (không qua WS).
                Object rv = m.get("roomId");
                Object sv = m.get("size");
                long roomId = rv instanceof Number r ? r.longValue() : 0L;
                long size = sv instanceof Number s ? s.longValue() : -1L;
                String name = m.get("name") instanceof String ns ? ns : "file.bin";
                String mime = m.get("mime") instanceof String ms ? ms : "";
                String reqId = m.get("reqId") instanceof String rs ? rs : "";
                send(ctx, core.beginFileUpload(roomId, name, mime, size, origin, reqId));
            } else if ("file_open".equals(type)) {
                // Cấp vé tải một lần cho từng lần mở tệp; UI GET byte thô qua HTTP loopback.
                Object fv = m.get("fileId");
                String reqId = m.get("reqId") instanceof String rs ? rs : "";
                if (fv instanceof String fid && !fid.isBlank()) {
                    send(ctx, core.openFileDownload(fid, origin, reqId));
                }
            } else if ("file_cancel".equals(type)) {
                Object fv = m.get("fileId");
                if (fv instanceof String fid && !fid.isBlank()) {
                    send(ctx, core.cancelFile(fid));
                }
            } else if ("file_retry".equals(type)) {
                Object fv = m.get("fileId");
                if (fv instanceof String fid && !fid.isBlank()) {
                    send(ctx, core.retryFile(fid));
                }
            }
        }

        private Map<String, Object> helloFrame() {
            if (binder != null) {
                return binder.hello();
            }
            // Chế độ gỡ lỗi (--token): đã bind sẵn, không có binder.
            PeerCore.Identity id = core.identity();
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("type", "hello_res");
            out.put("state", id == null ? "unbound" : "bound");
            out.put("port", 0);
            out.put("apiPort", core.apiPort());
            out.put("nonce", "");
            out.put("e2e", core.e2eState());
            if (id != null) {
                out.put("boundUserId", id.userId());
                out.put("boundUsername", id.username());
                out.put("boundPublicId", "");
            }
            return out;
        }

        private static void send(ChannelHandlerContext ctx, Map<String, Object> frame) {
            ctx.writeAndFlush(new TextWebSocketFrame(Json.write(frame)));
        }

        @Override
        public void channelInactive(ChannelHandlerContext ctx) {
            core.unregisterUi(ctx.channel());
        }

        @Override
        public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
            ctx.close();
        }
    }
}
