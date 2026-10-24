package com.workchat.peer;

import com.fasterxml.jackson.databind.JsonNode;
import com.workchat.tracker.common.Json;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.Map;

/**
 * Đổi vé (kèm nonce) lấy chìa phiên Peer Core qua {@code POST /api/peer/exchange}.
 *
 * <p>Nonce do Peer Core sinh ra (trả trong {@code hello_res}) và được trình duyệt
 * đính kèm khi xin vé; chỉ nonce khớp vé mới đổi được. Vé và chìa phiên KHÔNG ghi log.
 */
public final class PeerBindService implements PeerAutoBinder.TicketExchanger {
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();
    private static final SecureRandom RNG = new SecureRandom();
    private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();

    /** Kết quả đổi vé: chìa phiên + danh tính + hạn. */
    public record Session(String sessionKey, long userId, String username, String publicId, long expiresAt) {
    }

    /** Lỗi khi đổi vé/hết phiên (401) hoặc lỗi mạng. */
    public static final class BindException extends Exception {
        private final int status;

        public BindException(int status, String message) {
            super(message);
            this.status = status;
        }

        public int status() {
            return status;
        }

        public boolean unauthorized() {
            return status == 401 || status == 403;
        }
    }

    private final String server;
    private volatile String nonce;

    public PeerBindService(String server) {
        this.server = server;
        this.nonce = newNonce();
    }

    /** Nonce hiện hành (Peer Core sinh, gửi cho trình duyệt trong hello_res). */
    public String nonce() {
        return nonce;
    }

    /** Sinh nonce mới cho lần bind kế tiếp (gọi khi hello). */
    public String rotateNonce() {
        this.nonce = newNonce();
        return nonce;
    }

    /** Đổi vé + nonce hiện hành lấy chìa phiên. Ném {@link BindException} khi thất bại. */
    public Session exchange(String ticket) throws BindException {
        if (ticket == null || ticket.isBlank()) {
            throw new BindException(400, "missing_ticket");
        }
        String body = Json.write(Map.of("ticket", ticket, "nonce", nonce));
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(server + "/api/peer/exchange"))
                    .timeout(Duration.ofSeconds(10))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                    .build();
            HttpResponse<String> resp = HTTP.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (resp.statusCode() != 200) {
                throw new BindException(resp.statusCode(), "exchange_failed");
            }
            JsonNode tree = Json.tree(resp.body());
            String key = tree.path("token").asText("");
            JsonNode user = tree.path("user");
            if (key.isBlank()) {
                throw new BindException(500, "exchange_failed");
            }
            return new Session(
                    key,
                    user.path("id").asLong(),
                    user.path("username").asText(""),
                    user.path("public_id").asText(""),
                    tree.path("expires_at").asLong(0));
        } catch (BindException e) {
            throw e;
        } catch (Exception e) {
            throw new BindException(0, "exchange_error");
        }
    }

    private static String newNonce() {
        byte[] buf = new byte[16];
        RNG.nextBytes(buf);
        return B64.encodeToString(buf);
    }
}
