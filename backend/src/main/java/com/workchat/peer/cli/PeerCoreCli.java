package com.workchat.peer.cli;

import com.fasterxml.jackson.databind.JsonNode;
import com.workchat.peer.PeerAutoBinder;
import com.workchat.peer.PeerCore;
import com.workchat.peer.PeerRegistrationService;
import com.workchat.peer.StaticTokenTicketProvider;
import com.workchat.peer.TicketProvider;
import com.workchat.peer.UiWsServer;
import com.workchat.peer.WsSignaling;
import com.workchat.peer.net.NatPortMapper;
import com.workchat.tracker.common.Json;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;

/**
 * Chạy một Peer Core.
 *
 * <p>Mặc định (không tham số): Peer Core khởi động ở trạng thái UNBOUND, tự chọn cổng
 * UI trong 48001–48010, P2P tự chọn, rồi chờ trình duyệt gửi {@code bind} để kích hoạt.
 * Các cờ {@code --token/--port/--api} chỉ dùng để gỡ lỗi.
 */
public final class PeerCoreCli {
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    public static void main(String[] args) throws Exception {
        String serverArg = arg(args, "--server", null);
        String serverEnv = env("PEER_SERVER_URL");
        String server = serverArg != null && !serverArg.isBlank() ? serverArg.trim()
                : envDefault("PEER_SERVER_URL", "http://127.0.0.1:9090");
        String serverSource = serverArg != null && !serverArg.isBlank() ? "--server"
                : (serverEnv != null && !serverEnv.isBlank() ? "PEER_SERVER_URL" : "mặc định");
        String listenIp = arg(args, "--ip", envDefault("PEER_LISTEN_IP", "127.0.0.1"));
        String tokenArg = arg(args, "--token", env("PEER_TOKEN"));
        String listenPortRaw = arg(args, "--port", env("PEER_LISTEN_PORT"));
        String apiPortRaw = arg(args, "--api", env("PEER_API_PORT"));
        String uiPortRaw = arg(args, "--ui", env("PEER_UI_PORT"));
        String udpPortRaw = arg(args, "--udp", env("PEER_UDP_PORT"));
        String stunSpec = arg(args, "--stun", envDefault("PEER_STUN", "stun.l.google.com:19302"));
        String wsUrl = toWsUrl(server);

        announceServer(server, serverSource);

        int listenPort = (listenPortRaw != null && !listenPortRaw.isBlank())
                ? Integer.parseInt(listenPortRaw.trim()) : scanFreePort(listenIp, 48101, 10);
        int apiPort = (apiPortRaw != null && !apiPortRaw.isBlank())
                ? Integer.parseInt(apiPortRaw.trim()) : scanFreePort("127.0.0.1", 48201, 10);
        int uiPort = (uiPortRaw != null && !uiPortRaw.isBlank())
                ? Integer.parseInt(uiPortRaw.trim()) : scanFreePort("127.0.0.1", 48001, 10);
        int udpPort = (udpPortRaw == null || udpPortRaw.isBlank() || udpPortRaw.equalsIgnoreCase("off"))
                ? -1 : Integer.parseInt(udpPortRaw.trim());

        boolean debugToken = tokenArg != null && !tokenArg.isBlank();
        String relayOnlyRaw = arg(args, "--relay-only", arg(args, "--force-relay", env("PEER_RELAY_ONLY")));
        String directOnlyRaw = arg(args, "--force-direct-only", env("PEER_FORCE_DIRECT_ONLY"));

        if (debugToken) {
            runDebugToken(args, server, wsUrl, listenIp, listenPort, apiPort, uiPort, udpPort, stunSpec,
                    tokenArg, relayOnlyRaw, directOnlyRaw);
            return;
        }

        // ---- Chế độ mặc định: UNBOUND → chờ bind ----
        PeerCore core = new PeerCore(server, listenIp, listenPort);
        core.startMesh();
        if (udpPort >= 0) {
            core.startUdp(udpPort, stunList(stunSpec));
            startNatMapping(core, listenPort);
        }
        applyDebugFlags(core, relayOnlyRaw, directOnlyRaw);
        core.startApi(apiPort);

        PeerAutoBinder binder = new PeerAutoBinder(core, server, wsUrl, listenIp, listenPort, uiPort);
        binder.setSuspendListener(() -> core.notifyUi(Map.of("type", "session_expired")));

        startUiWs(core, binder, uiPort);

        Runtime.getRuntime().addShutdownHook(new Thread(binder::shutdown, "peer-shutdown"));

        System.out.println("[peer] UNBOUND — chờ trình duyệt bind trên 127.0.0.1:" + uiPort + "/ui"
                + " | mesh=" + listenIp + ":" + listenPort + " api=http://127.0.0.1:" + apiPort
                + " signaling=" + wsUrl);
        Thread.currentThread().join();
    }

    /** Chế độ gỡ lỗi: dùng thẳng token phiên (--token / PEER_TOKEN), bỏ qua hello/bind. */
    private static void runDebugToken(String[] args, String server, String wsUrl, String listenIp,
                                      int listenPort, int apiPort, int uiPort, int udpPort, String stunSpec,
                                      String token, String relayOnlyRaw, String directOnlyRaw) throws Exception {
        JsonNode me = get(server + "/api/me", token);
        long userId = me.path("user").path("id").asLong();
        String username = me.path("user").path("username").asText();

        PeerCore core = new PeerCore(new PeerCore.Identity(userId, username), server, listenIp, listenPort);
        core.startMesh();
        if (udpPort >= 0) {
            core.startUdp(udpPort, stunList(stunSpec));
        }
        core.attachToken(token);
        applyDebugFlags(core, relayOnlyRaw, directOnlyRaw);
        core.startApi(apiPort);
        if (udpPort >= 0) {
            startNatMapping(core, listenPort);
        }
        startUiWs(core, null, uiPort);

        TicketProvider tickets = new StaticTokenTicketProvider(token);
        PeerRegistrationService registration = new PeerRegistrationService(core, userId, server, listenIp,
                listenPort, tickets);
        registration.setOnServerReachable(core::onServerReachable);
        try {
            registration.registerOrThrow();
        } catch (Exception e) {
            System.err.println("Đăng ký peer thất bại: " + e.getMessage());
            System.exit(2);
        }

        WsSignaling sig = new WsSignaling(core, wsUrl, token);
        sig.setOnReconnected(registration::reRegisterQuietly);
        sig.setOnConnectivity(core::onSignalingConnectivity);
        core.attachSignaling(sig);
        sig.start();

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            registration.stop();
            sig.stop();
        }, "peer-shutdown"));

        System.out.println("[peer] " + username + " (id=" + userId + ") mesh=" + listenIp + ":" + listenPort
                + " api=http://127.0.0.1:" + apiPort + " signaling=" + wsUrl);
        Thread.currentThread().join();
    }

    private static void startUiWs(PeerCore core, PeerAutoBinder binder, int uiPort) {
        UiWsServer ui = new UiWsServer(core, binder, "127.0.0.1", uiPort, UiWsServer.Security.fromEnv());
        Thread ut = new Thread(() -> {
            try {
                ui.run();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }, "ui-ws");
        ut.setDaemon(true);
        ut.start();
        System.out.println("[peer] ui ws 127.0.0.1:" + uiPort + "/ui");
    }

    private static void applyDebugFlags(PeerCore core, String relayOnlyRaw, String directOnlyRaw) {
        if (truthy(relayOnlyRaw)) {
            core.setRelayOnly(true);
            System.out.println("[peer] chế độ force-relay: bỏ qua kênh trực tiếp");
        }
        if (truthy(directOnlyRaw)) {
            core.setForceDirectOnly(true);
            System.out.println("[peer] chế độ force-direct-only: không dùng Relay");
        }
    }

    /**
     * Mở cổng tự động (UPnP/NAT-PMP) cho cổng UDP data-plane và TCP mesh, chạy nền.
     * Kết quả chỉ được dùng khi STUN không đo được địa chỉ công khai (xem {@link PeerCore#onPortMapped}).
     */
    private static void startNatMapping(PeerCore core, int meshTcpPort) {
        int udp = core.udpPort();
        if (udp <= 0) {
            return;
        }
        NatPortMapper.startAsync(udp, meshTcpPort, new NatPortMapper.Listener() {
            @Override
            public void onMapped(int udpPort, int externalPort, String externalIp, String method) {
                System.out.println("[peer] NAT " + method + ": udp " + udpPort + " -> " + externalPort
                        + (externalIp == null || externalIp.isBlank() ? "" : (" ip=" + externalIp)));
                core.onPortMapped(externalIp, externalPort);
            }

            @Override
            public void onFailed(String reason) {
                System.out.println("[peer] NAT mở cổng tự động không khả dụng: " + reason);
            }
        });
    }

    /**
     * In Tracker đang dùng và nguồn cấu hình (--server / PEER_SERVER_URL / mặc định) để dễ chẩn đoán.
     * Cảnh báo nếu khác máy chủ mà web đang gọi (VITE_API_URL) — thường là nguyên nhân tin kẹt "Đang chờ".
     */
    private static void announceServer(String server, String source) {
        System.out.println("[peer] Tracker: " + server + " (nguồn: " + source + ")");
        String webUrl = env("VITE_API_URL");
        if (webUrl != null && !webUrl.isBlank()) {
            String a = authority(server);
            String b = authority(webUrl);
            if (!a.isEmpty() && !b.isEmpty() && !a.equalsIgnoreCase(b)) {
                System.out.println("[peer] CẢNH BÁO: VITE_API_URL=" + webUrl + " (" + b
                        + ") khác Tracker (" + a + ") — web và Peer Core đang trỏ tới 2 máy chủ khác nhau;"
                        + " hãy đặt PEER_SERVER_URL cho khớp để tin nhắn không kẹt \"Đang chờ\".");
            }
        }
    }

    /** Lấy "host:port" từ URL (bỏ scheme/path); trả "" nếu không phân tích được. */
    private static String authority(String url) {
        try {
            String a = URI.create(url.trim()).getAuthority();
            return a == null ? "" : a;
        } catch (Exception e) {
            return "";
        }
    }

    private static String arg(String[] args, String flag, String fallback) {
        for (int i = 0; i < args.length - 1; i++) {
            if (args[i].equals(flag)) {
                return args[i + 1];
            }
        }
        return fallback;
    }

    private static JsonNode get(String url, String token) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(url)).GET();
        if (token != null) {
            b.header("Authorization", "Bearer " + token);
        }
        HttpResponse<String> r = HTTP.send(b.build(), HttpResponse.BodyHandlers.ofString());
        if (r.statusCode() != 200) {
            throw new IllegalStateException(url + " -> " + r.statusCode());
        }
        return Json.tree(r.body());
    }

    /** Tìm cổng trống đầu tiên trong dải [base, base+count) trên {@code host}. */
    private static int scanFreePort(String host, int base, int count) {
        for (int p = base; p < base + count; p++) {
            try (java.net.ServerSocket ss = new java.net.ServerSocket()) {
                ss.setReuseAddress(true);
                ss.bind(new java.net.InetSocketAddress(host, p));
                return p;
            } catch (Exception ignored) {
                // cổng đang bận — thử cổng kế tiếp
            }
        }
        throw new IllegalStateException("không còn cổng trống trong dải " + base + "-" + (base + count - 1));
    }

    private static String env(String name) {
        return System.getenv(name);
    }

    /** Giá trị cờ boolean: "1"/"true"/"on" (không phân biệt hoa thường) → bật. */
    private static boolean truthy(String v) {
        return v != null && (v.equals("1") || v.equalsIgnoreCase("true") || v.equalsIgnoreCase("on"));
    }

    /**
     * Suy URL WebSocket từ URL HTTP(S) của Tracker: https→wss, http→ws, giữ nguyên host:port
     * và thêm "/ws". Bền hơn so với thay thế chuỗi "http" (tránh hỏng nếu host chứa "http").
     */
    static String toWsUrl(String server) {
        String base = (server == null || server.isBlank()) ? "http://127.0.0.1:9090" : server.trim();
        String ws;
        if (base.startsWith("https://")) {
            ws = "wss://" + base.substring("https://".length());
        } else if (base.startsWith("http://")) {
            ws = "ws://" + base.substring("http://".length());
        } else {
            ws = base;
        }
        while (ws.endsWith("/")) {
            ws = ws.substring(0, ws.length() - 1);
        }
        return normalizeLocalhost(ws) + "/ws";
    }

    /**
     * Ghim host "localhost" về "127.0.0.1" cho URL WS. Trên Windows, "localhost" có thể phân giải
     * sang IPv6 (::1) trong khi Tracker chỉ nghe IPv4 → bắt tay WS thất bại dù HTTP vẫn thông.
     * Chỉ áp cho host đúng bằng "localhost" (không đụng IP/tên miền khác).
     */
    static String normalizeLocalhost(String wsUrl) {
        for (String scheme : new String[] {"ws://", "wss://"}) {
            if (!wsUrl.startsWith(scheme)) {
                continue;
            }
            String rest = wsUrl.substring(scheme.length());
            // Chỉ ghim khi host ĐÚNG BẰNG "localhost" (sau nó là ':', '/' hoặc hết chuỗi) —
            // "localhost.example.com" phải giữ nguyên.
            if (rest.equals("localhost") || rest.startsWith("localhost:") || rest.startsWith("localhost/")) {
                return scheme + "127.0.0.1" + rest.substring("localhost".length());
            }
        }
        return wsUrl;
    }

    private static String envDefault(String name, String def) {
        String v = System.getenv(name);
        return v == null || v.isBlank() ? def : v;
    }

    /** Phân tích "host1:port1,host2:3478" thành danh sách máy chủ STUN; "off"/"none" để tắt. */
    private static java.util.List<String> stunList(String spec) {
        java.util.List<String> out = new java.util.ArrayList<>();
        if (spec == null || spec.isBlank() || spec.equalsIgnoreCase("off") || spec.equalsIgnoreCase("none")) {
            return out;
        }
        for (String part : spec.split(",")) {
            String t = part.trim();
            if (t.isEmpty()) {
                continue;
            }
            if (t.lastIndexOf(':') < 0) {
                t = t + ":3478";
            }
            out.add(t);
        }
        return out;
    }
}
