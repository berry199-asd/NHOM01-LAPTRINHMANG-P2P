package com.workchat.peer;

import com.workchat.tracker.common.Json;
import com.fasterxml.jackson.databind.JsonNode;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/** Client WS tới server (control-plane): auth + nhận peer_address. */
public final class WsSignaling {
    private final PeerCore core;
    private final String wsUrl;
    private final String token;
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "ws-signaling");
        t.setDaemon(true);
        return t;
    });
    /**
     * Luồng riêng cho callback (vd đăng ký lại sau khi nối lại — có gọi HTTP). Không dùng chung
     * với {@link #scheduler} để HTTP chậm không làm trễ nhịp ping/pong (Tracker đóng kết nối
     * khi allIdle > 30 s nếu ping bị hoãn).
     */
    private final java.util.concurrent.ExecutorService callbacks = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "ws-signaling-cb");
        t.setDaemon(true);
        return t;
    });
    private final AtomicBoolean stopped = new AtomicBoolean();
    private volatile WebSocket ws;
    private volatile boolean everConnected;
    private volatile Runnable onReconnected;
    private volatile Runnable onUnauthorized;
    private volatile java.util.function.Consumer<Boolean> onConnectivity;
    private final StringBuilder rxBuffer = new StringBuilder();
    /** Số lần nối lại liên tiếp (đặt lại 0 sau auth_ok) — dùng cho backoff. */
    private volatile int reconnectAttempt;
    /** Chặn lên lịch nối lại trùng khi cả onError lẫn onClose cùng bắn. */
    private final AtomicBoolean reconnectScheduled = new AtomicBoolean();

    /** Trạng thái kênh WS tới Tracker: connecting | open | closed | error (để UI hiện lý do). */
    private volatile String channelState = "closed";
    /** Thời điểm nhận pong gần nhất từ Tracker (ms epoch, 0 = chưa từng nhận). */
    private volatile long lastPongAt;
    /** Loại lỗi gần nhất (tên lớp/mã — KHÔNG chứa token/nội dung) và thời điểm (ms epoch). */
    private volatile String lastError;
    private volatile long lastErrorAt;

    public WsSignaling(PeerCore core, String wsUrl, String token) {
        this.core = core;
        this.wsUrl = wsUrl;
        this.token = token;
    }

    /** Callback chạy mỗi lần WS signaling NỐI LẠI (không tính lần kết nối đầu tiên). */
    public void setOnReconnected(Runnable onReconnected) {
        this.onReconnected = onReconnected;
    }

    /** Callback chạy khi Tracker từ chối xác thực (chìa phiên hết hạn/bị thu hồi). */
    public void setOnUnauthorized(Runnable onUnauthorized) {
        this.onUnauthorized = onUnauthorized;
    }

    /**
     * Callback báo trạng thái kết nối tới Tracker: {@code true} sau khi xác thực WS thành công
     * (auth_ok), {@code false} khi mất kết nối/đang thử lại. Dùng để UI hiện rõ máy chủ có
     * kết nối được hay không.
     */
    public void setOnConnectivity(java.util.function.Consumer<Boolean> onConnectivity) {
        this.onConnectivity = onConnectivity;
    }

    private void notifyConnectivity(boolean connected) {
        java.util.function.Consumer<Boolean> cb = onConnectivity;
        if (cb != null) {
            try {
                cb.accept(connected);
            } catch (Exception e) {
                System.err.println("[peer-ws] onConnectivity lỗi: " + e.getMessage());
            }
        }
    }

    public void start() {
        connect();
        // Ping mỗi 15 s (Tracker đóng kết nối khi allIdle > 30 s): biên an toàn gấp đôi, tránh
        // đứt/nối lại liên tục khi nhịp bị trễ nhẹ.
        scheduler.scheduleWithFixedDelay(this::ping, 15, 15, TimeUnit.SECONDS);
    }

    private void ping() {
        WebSocket w = ws;
        if (w != null) {
            // Phải là JSON {"type":"ping"}: Tracker phân tích bằng Json.readMap và chỉ trả "pong"
            // (đồng thời làm mới presence WS qua touchPeerWs) khi đọc được trường type.
            w.sendText(Json.write(Map.of("type", "ping")), true);
        }
    }

    /**
     * Trạng thái kênh WS tới Tracker cho UI — chỉ dữ liệu KHÔNG nhạy cảm (không token/nội dung):
     * địa chỉ Tracker (host:port), trạng thái kênh, số lần nối lại, lần cuối nhận pong, lỗi cuối.
     */
    public Map<String, Object> status() {
        Map<String, Object> out = new java.util.LinkedHashMap<>();
        out.put("tracker", trackerHost(wsUrl));
        out.put("ws", channelState);
        out.put("attempts", reconnectAttempt);
        out.put("lastPong", lastPongAt);
        String err = lastError;
        if (err != null) {
            out.put("lastError", err);
            out.put("lastErrorAt", lastErrorAt);
        }
        return out;
    }

    /** Rút "host:port" từ URL WS (bỏ scheme và path) — không lộ token/thông tin khác. */
    static String trackerHost(String wsUrl) {
        if (wsUrl == null || wsUrl.isBlank()) {
            return "";
        }
        try {
            URI u = URI.create(wsUrl.trim());
            String authority = u.getAuthority();
            return authority == null ? "" : authority;
        } catch (Exception e) {
            return "";
        }
    }

    private void markError(String kind) {
        this.channelState = "error";
        this.lastError = kind;
        this.lastErrorAt = System.currentTimeMillis();
    }

    /** Kênh WS đang mở (đã nhận auth_ok) hay không — Peer Core dùng để suy ra Tracker dùng được. */
    public boolean isOpen() {
        return "open".equals(channelState);
    }

    /**
     * Rút "loại lỗi" KHÔNG nhạy cảm từ ngoại lệ: bóc {@link java.util.concurrent.CompletionException},
     * và với lỗi bắt tay WS thì ghi mã HTTP (vd {@code handshake_401}) thay vì chỉ tên lớp.
     */
    private static String errorKind(Throwable e) {
        Throwable c = e;
        while (c instanceof java.util.concurrent.CompletionException && c.getCause() != null) {
            c = c.getCause();
        }
        if (c instanceof java.net.http.WebSocketHandshakeException h) {
            return "handshake_" + h.getResponse().statusCode();
        }
        return c == null ? "unknown" : c.getClass().getSimpleName();
    }

    private void connect() {
        this.channelState = "connecting";
        reconnectScheduled.set(false);
        if (stopped.get()) {
            return;
        }
        HttpClient cl = HttpClient.newHttpClient();
        WebSocket.Listener listener = new WebSocket.Listener() {
            @Override
            public void onOpen(WebSocket webSocket) {
                ws = webSocket;
                webSocket.request(1);
                webSocket.sendText(Json.write(Map.of("type", "auth", "token", token)), true);
            }

            @Override
            public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
                // JDK có thể giao 1 message thành nhiều phần (last=false); phải gom đủ mới xử lý,
                // nếu không các frame lớn (vd khối file qua Relay ~44KB) sẽ bị chặt và mất.
                String full = null;
                synchronized (rxBuffer) {
                    rxBuffer.append(data);
                    if (last) {
                        full = rxBuffer.toString();
                        rxBuffer.setLength(0);
                    }
                }
                if (full != null) {
                    dispatch(full);
                }
                webSocket.request(1);
                return null;
            }

            @Override
            public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
                ws = null;
                channelState = "closed";
                lastError = "closed_" + statusCode;
                lastErrorAt = System.currentTimeMillis();
                notifyConnectivity(false);
                scheduleReconnect();
                return null;
            }

            @Override
            public void onError(WebSocket webSocket, Throwable error) {
                ws = null;
                markError(errorKind(error));
                notifyConnectivity(false);
                scheduleReconnect();
            }
        };
        cl.newWebSocketBuilder()
                .connectTimeout(java.time.Duration.ofSeconds(10))
                .buildAsync(URI.create(wsUrl), listener)
                .exceptionally(ex -> {
                    ws = null;
                    markError(errorKind(ex));
                    notifyConnectivity(false);
                    scheduleReconnect();
                    return null;
                });
    }

    private void scheduleReconnect() {
        if (stopped.get()) {
            return;
        }
        // Cả onError lẫn onClose có thể cùng bắn → chỉ lên lịch một lần cho mỗi kết nối hỏng.
        if (!reconnectScheduled.compareAndSet(false, true)) {
            return;
        }
        long jitterSeed = System.nanoTime();
        long delay = reconnectDelayMs(reconnectAttempt, jitterSeed);
        reconnectAttempt++;
        scheduler.schedule(this::connect, delay, TimeUnit.MILLISECONDS);
    }

    /**
     * Thời gian chờ trước lần nối lại kế tiếp (ms): tăng theo cấp số nhân 0.5→1→2→4→8→16→30s
     * (tối đa 30s), kèm jitter ±25% (tất định theo {@code jitterSeed} để kiểm thử được) nhằm
     * tránh nhiều Peer Core cùng nối lại đồng loạt sau khi Tracker hồi phục.
     */
    static long reconnectDelayMs(int attempt, long jitterSeed) {
        int i = Math.max(0, Math.min(attempt, 6));
        long base = Math.min(30_000L, 500L << i);
        long span = Math.max(1L, base / 4);
        long off = Math.floorMod(jitterSeed, 2 * span + 1) - span;
        return Math.max(200L, base + off);
    }

    /**
     * Gửi sự kiện nhẹ (typing/seen) tới Tracker để định tuyến theo phòng (không cần PeerLink).
     * Trả false nếu kênh WS chưa mở (khi đó Peer Core sẽ dùng HTTP dự phòng).
     */
    public boolean sendLightEvent(long roomId, Map<String, Object> event) {
        WebSocket w = ws;
        if (w == null) {
            return false;
        }
        Map<String, Object> out = new java.util.LinkedHashMap<>();
        out.put("type", "light_event");
        out.put("roomId", roomId);
        out.put("event", event);
        w.sendText(Json.write(out), true).whenComplete((v, e) -> {
            if (e != null) {
                System.err.println("[wsend] FAIL light_event room=" + roomId + " err=" + e);
            }
        });
        return true;
    }

    /** Gửi một gói signaling/relay tới user khác (username) qua Tracker. */
    public boolean sendSignal(String toUsername, Map<String, Object> data) {
        WebSocket w = ws;
        if (w == null || toUsername == null || toUsername.isBlank()) {
            return false;
        }
        w.sendText(Json.write(Map.of("type", "signal", "to", toUsername, "data", data)), true)
                .whenComplete((v, e) -> {
                    if (e != null) {
                        System.err.println("[wsend] FAIL to=" + toUsername + " err=" + e);
                    }
                });
        return true;
    }

    private void dispatch(String text) {
        JsonNode n = Json.tree(text);
        String type = n.path("type").asText();
        if ("auth_ok".equals(type)) {
            boolean reconnect = everConnected;
            everConnected = true;
            reconnectAttempt = 0;
            reconnectScheduled.set(false);
            channelState = "open";
            notifyConnectivity(true);
            System.out.println("[peer-ws] auth_ok" + (reconnect ? " (reconnect)" : ""));
            if (reconnect && onReconnected != null) {
                // Chạy ngoài luồng listener VÀ ngoài luồng scheduler ping (đăng ký lại là HTTP
                // blocking) để nhịp ping không bị trễ.
                callbacks.execute(() -> {
                    try {
                        onReconnected.run();
                    } catch (Exception e) {
                        System.err.println("[peer-ws] onReconnected lỗi: " + e.getMessage());
                    }
                });
            }
        } else if ("peer_address".equals(type)) {
            long roomId = n.path("roomId").asLong();
            List<Map<String, Object>> peers = new ArrayList<>();
            for (JsonNode p : n.path("peers")) {
                peers.add(Map.of(
                        "userId", p.path("userId").asLong(),
                        "username", p.path("username").asText(),
                        "ip", p.path("ip").asText(),
                        "port", p.path("port").asInt(),
                        "pubkey", p.path("pubkey").asText(""),
                        "udpPort", p.path("udpPort").asInt(0),
                        "udpPublicIp", p.path("udpPublicIp").asText(""),
                        "udpPublicPort", p.path("udpPublicPort").asInt(0)));
            }
            core.onPeerAddress(roomId, peers);
        } else if ("presence".equals(type)) {
            long userId = n.path("userId").asLong();
            boolean online = n.path("online").asBoolean();
            String username = n.path("username").asText("");
            if (userId > 0) {
                core.onPresence(userId, online, username);
            }
        } else if ("signal".equals(type)) {
            String from = n.path("from").asText("");
            Map<String, Object> data = Json.readMap(n.path("data").toString());
            core.onRelay(from, data);
        } else if ("light_event".equals(type)) {
            // Sự kiện nhẹ (typing/seen) do Tracker định tuyến theo phòng — không qua PeerLink.
            core.onTrackerLightEvent(
                    n.path("from").asText(""),
                    n.path("fromUserId").asLong(),
                    n.path("roomId").asLong(),
                    Json.readMap(n.path("event").toString()));
        } else if ("friend_accepted".equals(type)) {
            // Kết bạn được chấp nhận (một trong hai phía): chuyển tiếp tới UI để nạp ngay
            // bạn + phòng 1-1 mà không cần reload (nội dung công khai tối thiểu, không email).
            Map<String, Object> out = new java.util.LinkedHashMap<>();
            out.put("type", "friend_accepted");
            out.put("room", Json.readMap(n.path("room").toString()));
            out.put("friend", Json.readMap(n.path("friend").toString()));
            core.notifyUi(out);
        } else if ("room_added".equals(type) || "room_updated".equals(type)) {
            // Được thêm vào phòng hoặc phòng được cập nhật: chuyển tiếp tới UI để cập nhật ngay
            Map<String, Object> out = new java.util.LinkedHashMap<>();
            out.put("type", type);
            out.put("room", Json.readMap(n.path("room").toString()));
            core.notifyUi(out);
        } else if ("room_removed".equals(type)) {
            Map<String, Object> out = new java.util.LinkedHashMap<>();
            out.put("type", "room_removed");
            out.put("roomId", n.path("roomId").asLong());
            core.notifyUi(out);
        } else if ("system_notice".equals(type)) {
            // Thông báo hệ thống từ admin: chuyển tiếp tới UI nội bộ để hiển thị toast.
            Map<String, Object> out = new java.util.LinkedHashMap<>();
            out.put("type", "system_notice");
            out.put("id", n.path("id").asLong());
            out.put("title", n.path("title").asText(""));
            out.put("content", n.path("content").asText(""));
            out.put("sent_at", n.path("sent_at").asLong(0));
            core.notifyUi(out);
        } else if ("error".equals(type)) {
            String code = n.path("code").asText("");
            if ("UNAUTHORIZED".equals(code)) {
                System.err.println("[peer-ws] phiên Peer Core bị từ chối (UNAUTHORIZED)");
                Runnable cb = onUnauthorized;
                if (cb != null) {
                    try {
                        cb.run();
                    } catch (Exception e) {
                        System.err.println("[peer-ws] onUnauthorized lỗi: " + e.getMessage());
                    }
                }
            }
        } else if ("pong".equals(type)) {
            // Giữ kết nối + ghi nhận thời điểm Tracker còn phản hồi (để UI thấy "lần cuối nhận pong").
            lastPongAt = System.currentTimeMillis();
        }
    }

    public void stop() {
        stopped.set(true);
        scheduler.shutdownNow();
        callbacks.shutdownNow();
        WebSocket w = ws;
        if (w != null) {
            try {
                w.sendClose(WebSocket.NORMAL_CLOSURE, "bye");
            } catch (Exception ignored) {
            }
        }
    }
}