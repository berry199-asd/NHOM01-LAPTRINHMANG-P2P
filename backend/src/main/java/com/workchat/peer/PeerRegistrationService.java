package com.workchat.peer;

import com.fasterxml.jackson.databind.JsonNode;
import com.workchat.tracker.common.Json;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Đăng ký Peer Core với Tracker và duy trì heartbeat UDP.
 *
 * <p>Mỗi lần Tracker nhận đăng ký sẽ cấp một secret heartbeat mới. Vì vậy khi
 * WS signaling kết nối lại (sau khi mất mạng) bắt buộc phải đăng ký lại VÀ khởi
 * động lại heartbeat với secret mới, nếu không node sẽ bị coi là offline.
 */
public final class PeerRegistrationService {
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    private final PeerCore core;
    private final long userId;
    private final String server;
    private final String listenIp;
    private final int listenPort;
    private final TicketProvider tickets;

    private final Object lock = new Object();
    private volatile UdpHeartbeat heartbeat;
    /** Gọi khi Tracker từ chối (401/403) — phiên Peer Core đã hết hạn. */
    private volatile Runnable onUnauthorized;
    /** Gọi sau khi đăng ký lại thành công (Tracker đã trở lại) — dùng để xả outbox + kéo hộp thư. */
    private volatile Runnable onServerReachable;

    public PeerRegistrationService(PeerCore core, long userId, String server, String listenIp, int listenPort,
                                   TicketProvider tickets) {
        this.core = core;
        this.userId = userId;
        this.server = server;
        this.listenIp = listenIp;
        this.listenPort = listenPort;
        this.tickets = tickets;
    }

    public void setOnUnauthorized(Runnable onUnauthorized) {
        this.onUnauthorized = onUnauthorized;
    }

    /**
     * Callback chạy sau khi đăng ký lại thành công (Tracker kết nối được trở lại). Peer Core
     * dùng để tự động gửi lại outbox đang chờ và kéo hộp thư mà không cần người dùng thao tác.
     */
    public void setOnServerReachable(Runnable onServerReachable) {
        this.onServerReachable = onServerReachable;
    }

    /** Đăng ký lần đầu; ném lỗi nếu Tracker từ chối để CLI dừng ngay. */
    public void registerOrThrow() throws Exception {
        startHeartbeat(registerOnce());
    }

    /** Đăng ký lại sau reconnect; chỉ ghi log khi lỗi, không làm sập tiến trình. */
    public void reRegisterQuietly() {
        try {
            startHeartbeat(registerOnce());
            System.out.println("[peer] đăng ký lại sau khi WS signaling nối lại");
            Runnable cb = onServerReachable;
            if (cb != null) {
                try {
                    cb.run();
                } catch (Exception e) {
                    System.err.println("[peer] onServerReachable lỗi: " + e.getMessage());
                }
            }
        } catch (Exception e) {
            System.err.println("[peer] đăng ký lại thất bại: " + e.getMessage());
        }
    }

    public void stop() {
        synchronized (lock) {
            if (heartbeat != null) {
                heartbeat.stop();
                heartbeat = null;
            }
        }
    }

    private record HeartbeatConfig(String host, int port, String secret, long intervalMs) {
    }

    private HeartbeatConfig registerOnce() throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("ip", listenIp);
        body.put("port", listenPort);
        body.put("pubkey", core.identityPubB64());
        body.put("udpPort", core.udpPort());
        body.put("udpPublicIp", core.udpPublicIp());
        body.put("udpPublicPort", core.udpPublicPort());

        String ticket = tickets.ticket();
        HttpRequest req = HttpRequest.newBuilder(URI.create(server + "/api/peer/register"))
                .timeout(Duration.ofSeconds(10))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + ticket)
                .POST(HttpRequest.BodyPublishers.ofString(Json.write(body)))
                .build();
        HttpResponse<String> resp = HTTP.send(req, HttpResponse.BodyHandlers.ofString());
        if (resp.statusCode() != 200) {
            if (resp.statusCode() == 401 || resp.statusCode() == 403) {
                Runnable cb = onUnauthorized;
                if (cb != null) {
                    cb.run();
                }
            }
            throw new IllegalStateException("đăng ký peer thất bại: " + resp.statusCode());
        }

        JsonNode hb = Json.tree(resp.body()).path("heartbeat");
        int hbPort = hb.path("port").asInt();
        String hbSecret = hb.path("secret").asText("");
        long hbInterval = hb.path("intervalMs").asLong(3000L);
        String hbHost = URI.create(server).getHost();
        if (hbHost == null || hbHost.isBlank()) {
            hbHost = "127.0.0.1";
        }
        return new HeartbeatConfig(hbHost, hbPort, hbSecret, hbInterval);
    }

    private void startHeartbeat(HeartbeatConfig cfg) {
        if (cfg.port() <= 0 || cfg.secret().isBlank()) {
            return;
        }
        synchronized (lock) {
            if (heartbeat != null) {
                heartbeat.stop();
            }
            UdpHeartbeat hb = new UdpHeartbeat(cfg.host(), cfg.port(), userId, cfg.secret(), cfg.intervalMs());
            hb.start();
            heartbeat = hb;
        }
        System.out.println("[peer] heartbeat UDP → " + cfg.host() + ":" + cfg.port() + " @" + cfg.intervalMs() + "ms");
    }
}
