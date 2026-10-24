package com.workchat.tracker;

import com.workchat.tracker.config.AppConfig;
import com.workchat.tracker.config.TlsSupport;
import com.workchat.tracker.db.ConfigDao;
import com.workchat.tracker.db.DataSourceFactory;
import com.workchat.tracker.db.KeyDao;
import com.workchat.tracker.db.OfflineDao;
import com.workchat.tracker.db.OtpDao;
import com.workchat.tracker.db.RoomDao;
import com.workchat.tracker.db.SocialDao;
import com.workchat.tracker.db.UserDao;
import com.workchat.tracker.http.HttpRestHandler;
import com.workchat.tracker.mail.Mailer;
import com.workchat.tracker.model.OfflineConfig;
import com.workchat.tracker.udp.HeartbeatService;
import com.workchat.tracker.ws.ClientRegistry;
import com.workchat.tracker.ws.PeerSignaling;
import com.workchat.tracker.ws.WsFrameHandler;
import io.netty.bootstrap.ServerBootstrap;
import io.netty.channel.Channel;
import io.netty.channel.ChannelInitializer;
import io.netty.channel.ChannelOption;
import io.netty.channel.EventLoopGroup;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.SocketChannel;
import io.netty.channel.socket.nio.NioServerSocketChannel;
import io.netty.handler.codec.http.HttpObjectAggregator;
import io.netty.handler.codec.http.HttpServerCodec;
import io.netty.handler.codec.http.websocketx.WebSocketServerProtocolHandler;
import io.netty.handler.ssl.SslContext;
import io.netty.handler.timeout.IdleStateHandler;

import javax.sql.DataSource;

import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public final class TrackerServer {

    public static void main(String[] args) throws Exception {
        AppConfig cfg = new AppConfig();
        DataSource ds = DataSourceFactory.create(cfg);
        UserDao dao = new UserDao(ds);
        OtpDao otpDao = new OtpDao(ds);
        RoomDao roomDao = new RoomDao(ds);
        SocialDao socialDao = new SocialDao(ds);
        KeyDao keyDao = new KeyDao(ds);
        OfflineDao offlineDao = new OfflineDao(ds);
        ConfigDao configDao = new ConfigDao(ds);
        OfflineConfig offlineConfig = new OfflineConfig(
                configDao.getInt("offline_ttl_days", 30),
                configDao.getInt("offline_mailbox_limit", 500),
                configDao.getInt("offline_pull_limit", 100),
                configDao.getInt("offline_max_text_bytes", 4096));
        System.out.println("[tracker] offline config ttl=" + offlineConfig.ttlDays()
                + "d mailbox=" + offlineConfig.mailboxLimit()
                + " pull=" + offlineConfig.pullLimit()
                + " maxText=" + offlineConfig.maxTextBytes());
        Mailer mailer = cfg.mailConfigured()
                ? new Mailer(cfg.smtpHost(), cfg.smtpPort(), cfg.mailUsername(), cfg.mailPassword())
                : null;
        ClientRegistry registry = new ClientRegistry();
        PeerSignaling signaling = new PeerSignaling(registry, roomDao);
        com.workchat.tracker.db.SystemLogDao systemLogDao = new com.workchat.tracker.db.SystemLogDao(ds);
        com.workchat.tracker.db.ReportsDao reportsDao = new com.workchat.tracker.db.ReportsDao(ds);
        com.workchat.tracker.db.BroadcastDao broadcastDao = new com.workchat.tracker.db.BroadcastDao(ds);

        HeartbeatService heartbeat = new HeartbeatService(
                registry, cfg.heartbeatPort(), cfg.heartbeatIntervalMs(), cfg.heartbeatTtlMs(),
                cfg.heartbeatWorkers(), (uid, username) -> {
                    // Peer Core hết hạn heartbeat → ghi last_seen_at. Chỉ chuyển offline nếu
                    // không còn phiên WS đã xác thực nào (tránh báo offline oan khi WS còn mở).
                    try {
                        dao.setLastSeen(uid, registry.lastSeenAt(uid));
                    } catch (Exception ignored) {
                        // không chặn sweeper nếu DB lỗi
                    }
                    if (!registry.isUserOnline(uid, username)) {
                        signaling.broadcastPresence(uid, username, false);
                    }
                });
        heartbeat.start();

        // Ghi last_seen_at theo chu kỳ thưa (~60s) cho các peer còn sống (không ghi mỗi nhịp).
        ScheduledExecutorService lastSeenWriter = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "last-seen-writer");
            t.setDaemon(true);
            return t;
        });
        lastSeenWriter.scheduleWithFixedDelay(() -> {
            try {
                List<Long> alive = registry.alivePeerIds();
                if (!alive.isEmpty()) {
                    dao.touchLastSeen(alive, System.currentTimeMillis());
                }
            } catch (Exception ignored) {
                // bỏ qua lỗi tạm thời
            }
        }, 60, 60, TimeUnit.SECONDS);

        if (cfg.seedAdminEmail() != null && !cfg.seedAdminEmail().isBlank()) {
            dao.seedAdminIfMissing(cfg.seedAdminEmail(), cfg.seedAdminPassword(), "Quản trị viên hệ thống");
            System.out.println("[tracker] seeded admin " + cfg.seedAdminEmail());
        }

        if (dao.dbOk()) {
            try {
                int backfilled = socialDao.backfillPublicIds();
                System.out.println("[tracker] backfilled " + backfilled + " public_id");
            } catch (Exception e) {
                System.out.println("[tracker] backfill public_id failed: " + e);
            }
        }

        HttpRestHandler restHandler = new HttpRestHandler(
                dao, otpDao, roomDao, socialDao, keyDao, offlineDao, offlineConfig,
                registry, signaling, mailer,
                cfg.sessionTtlDays(), cfg.otpTtlMinutes(), cfg.isDev(), heartbeat,
                cfg.corsAllowOrigin(), systemLogDao, configDao, reportsDao, broadcastDao,
                cfg.blobDir());

        EventLoopGroup boss = new NioEventLoopGroup(1);
        EventLoopGroup worker = new NioEventLoopGroup();
        // TLS tuỳ chọn: bật thì REST qua HTTPS/WSS trên cùng cổng. Khuyến nghị production dùng
        // reverse-proxy (Caddy/nginx + ACME) — xem docs/TLS_WSS.md.
        final SslContext tlsContext;
        if (cfg.tlsConfigured()) {
            try {
                tlsContext = TlsSupport.buildContext(cfg);
                System.out.println("[tracker] TLS bật (PEM) — phục vụ HTTPS/WSS trên cổng " + cfg.port());
            } catch (Exception e) {
                throw new IllegalStateException("Không dựng được SslContext TLS: " + e.getMessage(), e);
            }
        } else {
            tlsContext = null;
            if (cfg.tlsEnabled()) {
                System.out.println("[tracker] cảnh báo: TLS_ENABLED nhưng thiếu TLS_CERT_FILE/TLS_KEY_FILE — chạy HTTP");
            }
        }
        try {
            ServerBootstrap b = new ServerBootstrap();
            b.group(boss, worker)
                    .channel(NioServerSocketChannel.class)
                    .childOption(ChannelOption.TCP_NODELAY, true)
                    .childHandler(new ChannelInitializer<SocketChannel>() {
                        @Override
                        protected void initChannel(SocketChannel ch) {
                            if (tlsContext != null) {
                                ch.pipeline().addLast(tlsContext.newHandler(ch.alloc()));
                            }
                            ch.pipeline().addLast(new HttpServerCodec());
                            ch.pipeline().addLast(new HttpObjectAggregator(cfg.maxBodyBytes()));
                            ch.pipeline().addLast(new IdleStateHandler(0, 0, 30));
                            ch.pipeline().addLast(new WebSocketServerProtocolHandler("/ws", null, true, 10 * 1024 * 1024));
                            ch.pipeline().addLast(new WsFrameHandler(registry, dao, roomDao, socialDao, signaling,
                                    restHandler.peerSessions()::validate));
                            ch.pipeline().addLast(restHandler);
                        }
                    });
            Channel ch = b.bind(cfg.port()).sync().channel();
            String scheme = (tlsContext != null) ? "https" : "http";
            String wsScheme = (tlsContext != null) ? "wss" : "ws";
            System.out.println("[tracker] REST+WS listening on " + scheme + "://localhost:" + cfg.port()
                    + "/  (REST /api/*, " + wsScheme + " /ws)");
            System.out.println("[tracker] db=" + (dao.dbOk() ? "OK" : "FAIL (chờ cài MySQL và tạo database workchat)")
                    + " | mail=" + (mailer != null ? "configured" : "DISABLED")
                    + " | tls=" + (tlsContext != null ? "ON" : "off")
                    + " | jdbc=" + cfg.dbUrl());
            ch.closeFuture().sync();
        } finally {
            boss.shutdownGracefully().syncUninterruptibly();
            worker.shutdownGracefully().syncUninterruptibly();
            DataSourceFactory.close();
        }
    }
}