package com.workchat.peer;

import com.fasterxml.jackson.databind.JsonNode;
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
import io.netty.handler.codec.http.HttpObjectAggregator;
import io.netty.handler.codec.http.HttpServerCodec;
import io.netty.handler.codec.http.websocketx.CloseWebSocketFrame;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import io.netty.handler.codec.http.websocketx.WebSocketFrame;
import io.netty.handler.codec.http.websocketx.WebSocketServerProtocolHandler;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.CountDownLatch;

/**
 * Cổng chờ vé một lần trước khi Peer Core khởi động (chế độ vé).
 *
 * <p>Khi trình duyệt nối tới, cổng gửi {@code need_ticket}. Nhận
 * {@code {type:"ticket", ticket}} thì đổi vé lấy phiên ngắn hạn qua
 * {@code /api/peer/redeem}, rồi đóng cổng để Peer Core thật sự dựng lại trên
 * cùng cổng UI. Token/phiên KHÔNG bị ghi log.
 */
public final class PeerTicketGate {
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    /** Kết quả đổi vé: phiên ngắn hạn + danh tính. */
    public record Redeemed(String token, long userId, String username) {
    }

    private final String server;
    private final String ip;
    private final int port;

    private final CountDownLatch done = new CountDownLatch(1);
    private volatile Redeemed result;
    private volatile String error;
    private volatile Channel serverChannel;

    public PeerTicketGate(String server, String ip, int port) {
        this.server = server;
        this.ip = ip;
        this.port = port;
    }

    /** Chạy cổng và chờ vé tối đa {@code timeoutMs}; trả kết quả hoặc null nếu hết giờ. */
    public Redeemed await(long timeoutMs) throws InterruptedException {
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
                            ch.pipeline().addLast(new HttpObjectAggregator(64 * 1024));
                            ch.pipeline().addLast(new WebSocketServerProtocolHandler("/ui", null, true, 64 * 1024));
                            ch.pipeline().addLast(new GateHandler());
                        }
                    });
            serverChannel = b.bind(ip, port).sync().channel();
            System.out.println("[peer] chờ vé Peer Core trên 127.0.0.1:" + port + "/ui");
            if (!done.await(timeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS)) {
                return null;
            }
            if (error != null) {
                throw new IllegalStateException(error);
            }
            return result;
        } finally {
            if (serverChannel != null) {
                serverChannel.close().syncUninterruptibly();
            }
            boss.shutdownGracefully().syncUninterruptibly();
            worker.shutdownGracefully().syncUninterruptibly();
        }
    }

    private final class GateHandler extends SimpleChannelInboundHandler<WebSocketFrame> {
        @Override
        public void userEventTriggered(ChannelHandlerContext ctx, Object evt) {
            if (evt instanceof WebSocketServerProtocolHandler.HandshakeComplete) {
                ctx.writeAndFlush(new TextWebSocketFrame(Json.write(Map.of("type", "need_ticket"))));
            }
            ctx.fireUserEventTriggered(evt);
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
            Map<String, Object> m = Json.readMap(text.text());
            if (!"ticket".equals(m.get("type"))) {
                return;
            }
            String ticket = m.get("ticket") instanceof String s ? s : null;
            try {
                Redeemed r = redeem(server, ticket);
                result = r;
                ctx.writeAndFlush(new TextWebSocketFrame(Json.write(Map.of(
                        "type", "ticket_ok",
                        "userId", r.userId(),
                        "username", r.username()))));
                done.countDown();
            } catch (Exception e) {
                error = null; // vẫn cho phép thử lại vé khác
                ctx.writeAndFlush(new TextWebSocketFrame(Json.write(Map.of(
                        "type", "ticket_error",
                        "error", e.getMessage() == null ? "redeem_failed" : e.getMessage()))));
            }
        }

        @Override
        public void channelInactive(ChannelHandlerContext ctx) {
            ctx.fireChannelInactive();
        }

        @Override
        public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
            ctx.close();
        }
    }

    /** Đổi vé trực tiếp (không qua cổng) — dùng khi CLI nhận {@code --ticket}. */
    public static Redeemed redeemDirect(String server, String ticket) throws Exception {
        return redeem(server, ticket);
    }

    private static Redeemed redeem(String server, String ticket) throws Exception {
        if (ticket == null || ticket.isBlank()) {
            throw new IllegalStateException("missing_ticket");
        }
        String body = Json.write(Map.of("ticket", ticket));
        HttpRequest req = HttpRequest.newBuilder(URI.create(server + "/api/peer/redeem"))
                .timeout(Duration.ofSeconds(10))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                .build();
        HttpResponse<String> resp = HTTP.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (resp.statusCode() != 200) {
            throw new IllegalStateException("redeem_failed");
        }
        JsonNode tree = Json.tree(resp.body());
        String token = tree.path("token").asText("");
        JsonNode user = tree.path("user");
        if (token.isBlank()) {
            throw new IllegalStateException("redeem_failed");
        }
        return new Redeemed(token, user.path("id").asLong(), user.path("username").asText(""));
    }
}
