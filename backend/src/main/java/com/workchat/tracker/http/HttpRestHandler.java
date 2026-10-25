package com.workchat.tracker.http;

import at.favre.lib.crypto.bcrypt.BCrypt;
import com.fasterxml.jackson.databind.JsonNode;
import com.workchat.peer.protocol.CryptoBox;
import com.workchat.tracker.common.Json;
import com.workchat.tracker.db.KeyDao;
import com.workchat.tracker.db.OfflineDao;
import com.workchat.tracker.db.OtpDao;
import com.workchat.tracker.db.RoomDao;
import com.workchat.tracker.db.SocialDao;
import com.workchat.tracker.db.UserDao;
import com.workchat.tracker.mail.Mailer;
import com.workchat.tracker.model.OfflineConfig;
import com.workchat.tracker.model.Profile;
import com.workchat.tracker.model.User;
import com.workchat.tracker.ws.ClientRegistry;
import com.workchat.tracker.ws.PeerSignaling;
import io.netty.buffer.Unpooled;
import io.netty.channel.ChannelHandler;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.SimpleChannelInboundHandler;
import io.netty.handler.codec.http.DefaultFullHttpResponse;
import io.netty.handler.codec.http.FullHttpRequest;
import io.netty.handler.codec.http.FullHttpResponse;
import io.netty.handler.codec.http.HttpHeaderNames;
import io.netty.handler.codec.http.HttpMethod;
import io.netty.handler.codec.http.HttpResponseStatus;
import io.netty.handler.codec.http.HttpVersion;
import io.netty.util.AttributeKey;

import jakarta.mail.MessagingException;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;

@ChannelHandler.Sharable
public final class HttpRestHandler extends SimpleChannelInboundHandler<FullHttpRequest> {
    private static final String USERNAME_RE = "^[a-zA-Z0-9_.\\-]{3,32}$";
    private static final String EMAIL_RE = "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$";
    private static final String DOB_RE = "^\\d{4}-\\d{2}-\\d{2}$";
    private static final String DATA_IMAGE_PREFIX = "data:image/";
    private static final int MAX_AVATAR_LEN = 1_500_000;
    private static final int MAX_COVER_LEN = 2_000_000;
    private static final int MAX_OTP_ATTEMPTS = 5;
    private static final long OTP_COOLDOWN_MS = 30_000L;
    private static final long LOGIN_WINDOW_MS = 15 * 60_000L;
    private static final int MAX_LOGIN_ATTEMPTS = 5;
    private static final SecureRandom RNG = new SecureRandom();

    /** Nhãn thuật toán phong bì E2E (<= 32 ký tự, khớp cột message_cache.algo). */
    private static final String E2E_ALGO = "v1:OAEP256+GCM256+PSS256";
    private static final java.util.Set<String> OFFLINE_TYPES =
            java.util.Set.of("text", "image", "video", "file", "voice");
    private static final java.util.Set<String> OFFLINE_CONTENT_TYPES =
            java.util.Set.of("text", "voice_short", "media_ref");
    private static final int MAX_PULL_IDS = 500;

    /** Khoá cấu hình admin được phép ghi (số nguyên) — tránh ghi tuỳ tiện vào system_config. */
    private static final java.util.Set<String> ALLOWED_CONFIG_KEYS = java.util.Set.of(
            "max_file_size_mb", "heartbeat_timeout_sec", "max_login_attempts",
            "offline_ttl_days", "offline_mailbox_limit", "offline_pull_limit",
            "offline_max_text_bytes", "session_ttl_days", "message_cache_ttl_days",
            "max_room_members",
            "max_image_mb", "max_file_mb_direct", "max_file_mb_blob",
            "max_files_per_message", "user_blob_quota_mb", "blob_ttl_days");

    /** Số thành viên tối đa mỗi phòng (gồm người tạo) khi admin chưa cấu hình. */
    private static final int DEFAULT_MAX_ROOM_MEMBERS = 20;

    private final UserDao dao;
    private final OtpDao otpDao;
    private final RoomDao roomDao;
    private final SocialDao socialDao;
    private final KeyDao keyDao;
    private final OfflineDao offlineDao;
    private final OfflineConfig offlineConfig;
    private final ClientRegistry registry;
    private final PeerSignaling signaling;
    private final Mailer mailer;
    private final int sessionTtlDays;
    private final int otpTtlMinutes;
    private final boolean devMode;
    private final com.workchat.tracker.udp.HeartbeatService heartbeat;
    private final com.workchat.tracker.db.SystemLogDao systemLogDao;
    private final com.workchat.tracker.db.ConfigDao configDao;
    private final com.workchat.tracker.db.ReportsDao reportsDao;
    private final com.workchat.tracker.db.BroadcastDao broadcastDao;
    private final BlobStore blobs;
    private final PeerTicketStore peerTickets = new PeerTicketStore();
    private final PeerSessionStore peerSessions;

    /** Chìa phiên Peer Core dùng chung cho cả REST và WS (đối xứng hai kênh). */
    public PeerSessionStore peerSessions() {
        return peerSessions;
    }

    /**
     * Mọi truy vấn MySQL (blocking) đều được đẩy sang executor riêng, không chạy trên event loop.
     * Vì là pipeline dùng chung nên các request cùng kết nối vẫn giữ thứ tự nhờ NioEventLoop,
     * còn thời gian xử lý được nhường lại cho mạng.
     */
    private final ExecutorService dbExecutor = Executors.newFixedThreadPool(8, r -> {
        Thread t = new Thread(r, "db-worker");
        t.setDaemon(true);
        return t;
    });

    private final Map<String, Long> otpCooldowns = new ConcurrentHashMap<>();
    private final Map<Long, java.util.List<Long>> e2eOtpRateLimits = new ConcurrentHashMap<>();
    private final Map<String, E2eResetTicket> e2eResetTickets = new ConcurrentHashMap<>();

    private record E2eResetTicket(long userId, long expiresAt) {}
    private final Map<String, LoginFail> loginFails = new ConcurrentHashMap<>();
    private final Map<String, Bucket> rateBuckets = new ConcurrentHashMap<>();

    private static final class LoginFail {
        long windowStart;
        int count;
    }

    private static final class Bucket {
        long start;
        int count;
    }

    public HttpRestHandler(UserDao dao, OtpDao otpDao, RoomDao roomDao, SocialDao socialDao,
                           KeyDao keyDao, OfflineDao offlineDao, OfflineConfig offlineConfig,
                           ClientRegistry registry, PeerSignaling signaling,
                           Mailer mailer,
                           int sessionTtlDays, int otpTtlMinutes, boolean devMode,
                           com.workchat.tracker.udp.HeartbeatService heartbeat,
                           String corsAllowOrigin,
                           com.workchat.tracker.db.SystemLogDao systemLogDao,
                           com.workchat.tracker.db.ConfigDao configDao,
                           com.workchat.tracker.db.ReportsDao reportsDao,
                           com.workchat.tracker.db.BroadcastDao broadcastDao,
                           String blobDir) {
        this.dao = dao;
        this.otpDao = otpDao;
        this.roomDao = roomDao;
        this.socialDao = socialDao;
        this.keyDao = keyDao;
        this.offlineDao = offlineDao;
        this.offlineConfig = offlineConfig;
        this.registry = registry;
        this.signaling = signaling;
        this.mailer = mailer;
        this.sessionTtlDays = sessionTtlDays;
        this.otpTtlMinutes = otpTtlMinutes;
        this.devMode = devMode;
        this.heartbeat = heartbeat;
        this.systemLogDao = systemLogDao;
        this.configDao = configDao;
        this.reportsDao = reportsDao;
        this.broadcastDao = broadcastDao;
        this.blobs = new BlobStore(java.nio.file.Path.of(
                (blobDir == null || blobDir.isBlank()) ? "blob-data" : blobDir));
        this.peerSessions = new PeerSessionStore(dao, sessionTtlDays);
        corsAllowOriginStatic = (corsAllowOrigin == null || corsAllowOrigin.isBlank()) ? "*" : corsAllowOrigin.trim();
    }

    /** Bucket tỷ lệ đơn giản theo khoá (thường là IP): max lần / windowMs. */
    private boolean rateAllow(String key, int max, long windowMs) {
        long now = System.currentTimeMillis();
        Bucket b = rateBuckets.computeIfAbsent(key, k -> {
            Bucket bb = new Bucket();
            bb.start = now;
            return bb;
        });
        synchronized (b) {
            if (now - b.start >= windowMs) {
                b.start = now;
                b.count = 0;
            }
            if (b.count >= max) {
                return false;
            }
            b.count++;
            return true;
        }
    }

    @Override
    protected void channelRead0(ChannelHandlerContext ctx, FullHttpRequest req) {
        String reqOrigin = req.headers().get(HttpHeaderNames.ORIGIN);
        ctx.channel().attr(REQ_ORIGIN).set(reqOrigin == null ? "" : reqOrigin);
        if (req.method() == HttpMethod.OPTIONS) {
            write(ctx, HttpResponseStatus.OK, "{}");
            return;
        }
        FullHttpRequest retained = req.retain();
        try {
            dbExecutor.execute(() -> {
                try {
                    dispatch(ctx, retained);
                } catch (SQLException e) {
                    write(ctx, HttpResponseStatus.INTERNAL_SERVER_ERROR, err("db_error"));
                } catch (Exception e) {
                    write(ctx, HttpResponseStatus.INTERNAL_SERVER_ERROR, err("server_error"));
                } finally {
                    retained.release();
                }
            });
        } catch (RejectedExecutionException e) {
            retained.release();
            write(ctx, HttpResponseStatus.SERVICE_UNAVAILABLE, err("busy"));
        }
    }

    private void dispatch(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        String uri = req.uri();
        int q = uri.indexOf('?');
        String path = q < 0 ? uri : uri.substring(0, q);
        String query = q < 0 ? "" : uri.substring(q + 1);
        HttpMethod m = req.method();

        switch (path) {
            case "/api/health" -> handleHealth(ctx);
            case "/api/config/public" -> getOnly(ctx, m, () -> handlePublicConfig(ctx));
            case "/api/register" -> postOnly(ctx, m, () -> handleRegister(ctx, req));
            case "/api/login" -> postOnly(ctx, m, () -> handleLogin(ctx, req));
            case "/api/logout" -> postOnly(ctx, m, () -> handleLogout(ctx, req));
            case "/api/resend-otp" -> postOnly(ctx, m, () -> handleResendOtp(ctx, req));
            case "/api/verify-otp" -> postOnly(ctx, m, () -> handleVerifyOtp(ctx, req));
            case "/api/forgot-password" -> postOnly(ctx, m, () -> handleForgotPassword(ctx, req));
            case "/api/reset-password" -> postOnly(ctx, m, () -> handleResetPassword(ctx, req));
            case "/api/change-password" -> postOnly(ctx, m, () -> handleChangePassword(ctx, req));
            case "/api/update-profile" -> postOnly(ctx, m, () -> handleUpdateProfile(ctx, req));
            case "/api/change-email/request" -> postOnly(ctx, m, () -> handleChangeEmailRequest(ctx, req));
            case "/api/change-email/confirm" -> postOnly(ctx, m, () -> handleChangeEmailConfirm(ctx, req));
            case "/api/me" -> getOnly(ctx, m, () -> handleMe(ctx, req));
            case "/api/users/search" -> getOnly(ctx, m, () -> handleUserSearch(ctx, req, query));
            case "/api/users/by-public-id" -> getOnly(ctx, m, () -> handleUserByPublicId(ctx, req, query));
            case "/api/friends" -> getOnly(ctx, m, () -> handleFriendList(ctx, req));
            case "/api/friends/requests" -> getOnly(ctx, m, () -> handleFriendRequests(ctx, req));
            case "/api/friends/sent" -> getOnly(ctx, m, () -> handleFriendSent(ctx, req));
            case "/api/friends/suggestions" -> getOnly(ctx, m, () -> handleFriendSuggestions(ctx, req));
            case "/api/friends/request" -> postOnly(ctx, m, () -> handleFriendRequestCreate(ctx, req));
            case "/api/friends/accept" -> postOnly(ctx, m, () -> handleFriendRequestRespond(ctx, req, true));
            case "/api/friends/reject" -> postOnly(ctx, m, () -> handleFriendRequestRespond(ctx, req, false));
            case "/api/rooms" -> handleRooms(ctx, m, req);
            case "/api/rooms/direct" -> postOnly(ctx, m, () -> handleRoomDirect(ctx, req));
            case "/api/rooms/join" -> postOnly(ctx, m, () -> handleRoomJoin(ctx, req));
            case "/api/rooms/invite" -> postOnly(ctx, m, () -> handleRoomInvite(ctx, req));
            case "/api/peer/register" -> postOnly(ctx, m, () -> handlePeerRegister(ctx, req));
            case "/api/peer/ticket" -> postOnly(ctx, m, () -> handlePeerTicket(ctx, req));
            case "/api/e2e/otp/request" -> postOnly(ctx, m, () -> handleE2eOtpRequest(ctx, req));
            case "/api/e2e/otp/verify" -> postOnly(ctx, m, () -> handleE2eOtpVerify(ctx, req));
            case "/api/e2e/otp/consume" -> postOnly(ctx, m, () -> handleE2eOtpConsume(ctx, req));
            case "/api/peer/exchange" -> postOnly(ctx, m, () -> handlePeerExchange(ctx, req));
            case "/api/peer/heartbeat/state" -> getOnly(ctx, m, () -> handleHeartbeatState(ctx));
            case "/api/keys" -> postOnly(ctx, m, () -> handleKeyRegister(ctx, req));
            case "/api/offline/store" -> postOnly(ctx, m, () -> handleOfflineStore(ctx, req));
            case "/api/events/light" -> postOnly(ctx, m, () -> handleLightEvent(ctx, req));
            case "/api/offline/pull" -> postOnly(ctx, m, () -> handleOfflinePull(ctx, req));
            case "/api/offline/ack" -> postOnly(ctx, m, () -> handleOfflineAck(ctx, req));
            case "/api/admin/users" -> getOnly(ctx, m, () -> handleAdminUsers(ctx, req, query));
            case "/api/admin/peers" -> getOnly(ctx, m, () -> handleAdminPeers(ctx, req));
            case "/api/admin/logs" -> getOnly(ctx, m, () -> handleAdminLogs(ctx, req, query));
            case "/api/admin/overview" -> getOnly(ctx, m, () -> handleAdminOverview(ctx, req));
            case "/api/admin/config" -> adminConfig(ctx, m, req);
            case "/api/admin/reports" -> getOnly(ctx, m, () -> handleAdminReports(ctx, req, query));
            case "/api/admin/broadcasts" -> adminBroadcasts(ctx, m, req, query);
            default -> {
                if (path.equals("/api/blob") || path.startsWith("/api/blob/")) {
                    handleBlob(ctx, m, req, path, query);
                } else if (m == HttpMethod.GET && path.matches("/api/users/\\d+/pubkey")) {
                    handleUserPubkey(ctx, req, path);
                } else if (m == HttpMethod.GET && path.startsWith("/api/users/by-public-id/")) {
                    handleUserByPublicId(ctx, req, "public_id=" + path.substring("/api/users/by-public-id/".length()));
                } else if (m == HttpMethod.POST && path.matches("/api/friends/[0-9A-Za-z_-]+/(accept|reject|cancel|unfriend)")) {
                    handleFriendPathAction(ctx, req, path);
                } else if (path.matches("/api/rooms/\\d+/messages/[^/]+/(edit|recall|reaction)")) {
                    handleMessageAction(ctx, m, req, path);
                } else if (m == HttpMethod.POST && path.matches("/api/rooms/\\d+/messages/forward")) {
                    handleMessageForward(ctx, req, path);
                } else if (m == HttpMethod.POST && path.matches("/api/rooms/\\d+/read")) {
                    handleRoomRead(ctx, req, path);
                } else if (m == HttpMethod.DELETE && path.matches("/api/rooms/\\d+/messages/[^/]+")) {
                    handleMessageDelete(ctx, req, path);
                } else if (path.matches("/api/rooms/\\d+/messages")) {
                    if (m == HttpMethod.POST) {
                        handleMessageSend(ctx, req, path);
                    } else if (m == HttpMethod.GET) {
                        handleMessageList(ctx, req, path, query);
                    } else {
                        write(ctx, HttpResponseStatus.METHOD_NOT_ALLOWED, err("method_not_allowed"));
                    }
                } else if ((m == HttpMethod.PATCH || m == HttpMethod.POST) && path.matches("/api/rooms/\\d+/settings")) {
                    handleRoomSettingsPatch(ctx, req, path);
                } else if (m == HttpMethod.POST && path.matches("/api/rooms/\\d+/transfer-owner")) {
                    handleRoomTransferOwner(ctx, req, path);
                } else if (m == HttpMethod.POST && path.matches("/api/rooms/\\d+/dissolve")) {
                    handleRoomDissolve(ctx, req, path);
                } else if (m == HttpMethod.GET && path.matches("/api/rooms/\\d+/blocks")) {
                    handleRoomBlocksList(ctx, req, path);
                } else if (m == HttpMethod.POST && path.matches("/api/rooms/\\d+/blocks/\\d+")) {
                    handleRoomBlockAdd(ctx, req, path);
                } else if (m == HttpMethod.DELETE && path.matches("/api/rooms/\\d+/blocks/\\d+")) {
                    handleRoomBlockRemove(ctx, req, path);
                } else if (m == HttpMethod.GET && path.matches("/api/rooms/\\d+/join-requests")) {
                    handleJoinRequestsList(ctx, req, path);
                } else if (m == HttpMethod.POST && path.matches("/api/rooms/\\d+/join-requests/approve-all")) {
                    handleJoinRequestsApproveAll(ctx, req, path);
                } else if (m == HttpMethod.POST && path.matches("/api/rooms/\\d+/join-requests/\\d+/(approve|reject)")) {
                    handleJoinRequestDecision(ctx, req, path);
                } else if (m == HttpMethod.POST && path.matches("/api/rooms/\\d+/members/\\d+/role")) {
                    handleRoomMemberRolePath(ctx, req, path);
                } else if (m == HttpMethod.DELETE && path.matches("/api/rooms/\\d+/members/\\d+")) {
                    handleRoomMemberDelete(ctx, req, path);
                } else if (m == HttpMethod.POST && path.matches("/api/rooms/\\d+/member/add")) {
                    handleRoomMemberAdd(ctx, req, path);
                } else if (m == HttpMethod.POST && path.matches("/api/rooms/\\d+/member/role")) {
                    handleRoomMemberRole(ctx, req, path);
                } else if (m == HttpMethod.POST && path.matches("/api/rooms/\\d+/member/remove")) {
                    handleRoomMemberRemove(ctx, req, path);
                } else if (m == HttpMethod.POST && path.matches("/api/rooms/\\d+/leave")) {
                    handleRoomLeave(ctx, req, path);
                } else if ((m == HttpMethod.PATCH || m == HttpMethod.POST) && path.matches("/api/rooms/\\d+")) {
                    handleRoomUpdate(ctx, req, path);
                } else if (m == HttpMethod.GET && path.startsWith("/api/rooms/")) {
                    handleRoomDetail(ctx, req, path);
                } else if (m == HttpMethod.POST && path.matches("/api/admin/users/\\d+/(lock|unlock)")) {
                    handleAdminLock(ctx, req, path);
                } else if (m == HttpMethod.POST && path.matches("/api/admin/users/\\d+/role")) {
                    handleAdminSetRole(ctx, req, path);
                } else if (m == HttpMethod.POST && path.matches("/api/admin/reports/\\d+/status")) {
                    handleAdminReportStatus(ctx, req, path);
                } else {
                    write(ctx, HttpResponseStatus.NOT_FOUND, err("not_found"));
                }
            }
        }
    }

    private interface ThrowingAction {
        void run() throws SQLException;
    }

    private static void postOnly(ChannelHandlerContext ctx, HttpMethod m, ThrowingAction a) throws SQLException {
        if (m == HttpMethod.POST) {
            a.run();
        } else {
            write(ctx, HttpResponseStatus.METHOD_NOT_ALLOWED, err("method_not_allowed"));
        }
    }

    private static void getOnly(ChannelHandlerContext ctx, HttpMethod m, ThrowingAction a) throws SQLException {
        if (m == HttpMethod.GET) {
            a.run();
        } else {
            write(ctx, HttpResponseStatus.METHOD_NOT_ALLOWED, err("method_not_allowed"));
        }
    }

    private void handleHealth(ChannelHandlerContext ctx) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("status", "ok");
        body.put("db", dao.dbOk());
        body.put("mail", mailer != null);
        body.put("online", registry.alivePeerCount());
        body.put("sessions", registry.onlineCount());
        write(ctx, HttpResponseStatus.OK, Json.write(body));
    }

    /** Cấu hình công khai (không nhạy cảm) để UI biết giới hạn trước khi gọi API. */
    private static String maskEmail(String email) {
        if (email == null || !email.contains("@")) return "***";
        int at = email.indexOf('@');
        if (at <= 2) return email.charAt(0) + "***" + email.substring(at);
        return email.substring(0, 2) + "***" + email.substring(at);
    }

    private void handleE2eOtpRequest(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        User u = requireUser(ctx, bearer(req));
        if (u == null) return;

        JsonNode b = Json.tree(body(req));
        String inputEmail = nstr(b, "email");
        String userEmail = u.email() == null ? "" : u.email().trim().toLowerCase(Locale.ROOT);
        String testEmail = (inputEmail == null || inputEmail.isBlank()) ? userEmail : inputEmail.trim().toLowerCase(Locale.ROOT);

        if (!testEmail.isEmpty() && !userEmail.isEmpty() && !MessageDigest.isEqual(userEmail.getBytes(StandardCharsets.UTF_8), testEmail.getBytes(StandardCharsets.UTF_8))) {
            String masked = maskEmail(userEmail);
            write(ctx, HttpResponseStatus.BAD_REQUEST, Json.write(Map.of("ok", false, "error", "Email không khớp với tài khoản đã đăng ký (Email tài khoản: " + masked + ")")));
            return;
        }

        long now = System.currentTimeMillis();
        java.util.List<Long> times = e2eOtpRateLimits.computeIfAbsent(u.id(), k -> new java.util.concurrent.CopyOnWriteArrayList<>());
        times.removeIf(t -> now - t > 15 * 60_000L);
        if (times.size() >= 3) {
            write(ctx, HttpResponseStatus.TOO_MANY_REQUESTS, Json.write(Map.of("ok", false, "error", "Đã gửi quá 3 lần trong 15 phút. Vui lòng thử lại sau.")));
            return;
        }
        times.add(now);

        String code = String.format("%06d", RNG.nextInt(1_000_000));
        try {
            otpDao.revokeActive(userEmail, "e2e_reset");
            otpDao.insert(userEmail, "e2e_reset", OtpDao.sha256Hex(code), 5);
    
        } catch (SQLException e) {
            System.err.println("[tracker-otp] Lỗi lưu OTP E2E: " + e.getMessage());
            write(ctx, HttpResponseStatus.INTERNAL_SERVER_ERROR, Json.write(Map.of("ok", false, "error", "Lỗi cơ sở dữ liệu khi tạo mã OTP. Vui lòng chạy migration 008_e2e_reset_otp_purpose.sql trên MySQL.")));
            return;
        }


        if (mailer != null) {
            try {
                mailer.sendOtpCode(userEmail, code, 5);
                System.out.println("[tracker-mail] Đã gửi mã OTP E2E reset tới email người dùng");
            } catch (Exception e) {
                System.err.println("[tracker-mail] Gửi OTP E2E lỗi: " + e.getMessage());
            }
        } else {
            System.err.println("[tracker-mail] WARNING: Mailer chưa cấu hình. Mã OTP E2E reset cho " + userEmail + " là: " + code);
        }

        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true)));
    }

    private void handleE2eOtpVerify(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        User u = requireUser(ctx, bearer(req));
        if (u == null) return;

        JsonNode b = Json.tree(body(req));
        String inputEmail = nstr(b, "email");
        String code = nstr(b, "otp");
        if (code == null || code.isBlank()) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, Json.write(Map.of("ok", false, "error", "Thiếu mã OTP")));
            return;
        }

        String userEmail = u.email() == null ? "" : u.email().trim().toLowerCase(Locale.ROOT);
        String testEmail = (inputEmail == null || inputEmail.isBlank()) ? userEmail : inputEmail.trim().toLowerCase(Locale.ROOT);
        if (!testEmail.isEmpty() && !userEmail.isEmpty() && !MessageDigest.isEqual(userEmail.getBytes(StandardCharsets.UTF_8), testEmail.getBytes(StandardCharsets.UTF_8))) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, Json.write(Map.of("ok", false, "error", "Email không khớp với tài khoản đã đăng ký")));
            return;
        }

        Optional<OtpDao.OtpRow> row;
        try {
            row = otpDao.findActive(userEmail, "e2e_reset");
        } catch (SQLException e) {
            System.err.println("[tracker-otp] Lỗi tra cứu OTP E2E: " + e.getMessage());
            write(ctx, HttpResponseStatus.INTERNAL_SERVER_ERROR, Json.write(Map.of("ok", false, "error", "Lỗi cơ sở dữ liệu khi kiểm tra mã OTP")));
            return;
        }
        if (row.isEmpty()) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, Json.write(Map.of("ok", false, "error", "Mã OTP không hợp lệ hoặc đã hết hạn")));
            return;
        }

        byte[] expect = OtpDao.sha256Hex(code.trim()).getBytes(StandardCharsets.US_ASCII);
        byte[] actual = row.get().codeHash().getBytes(StandardCharsets.US_ASCII);
        if (MessageDigest.isEqual(expect, actual)) {
            otpDao.markConsumed(row.get().id());
            String ticket = java.util.UUID.randomUUID().toString().replace("-", "") + Long.toHexString(System.currentTimeMillis());
            e2eResetTickets.put(ticket, new E2eResetTicket(u.id(), System.currentTimeMillis() + 5 * 60_000L));
            write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true, "ticket", ticket)));
            return;
        }

        otpDao.incrementAttempt(row.get().id());
        if (row.get().attemptCount() + 1 >= 3) {
            otpDao.markConsumed(row.get().id());
            write(ctx, HttpResponseStatus.BAD_REQUEST, Json.write(Map.of("ok", false, "error", "Mã OTP không đúng. Đã bị hủy sau 3 lần sai.")));
            return;
        }
        int left = 3 - (row.get().attemptCount() + 1);
        write(ctx, HttpResponseStatus.BAD_REQUEST, Json.write(Map.of("ok", false, "error", "Mã OTP không đúng. Còn lại " + left + " lần thử.")));
    }

    private void handleE2eOtpConsume(ChannelHandlerContext ctx, FullHttpRequest req) {
        JsonNode b = Json.tree(body(req));
        String ticket = nstr(b, "ticket");
        if (ticket == null || ticket.isBlank()) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, Json.write(Map.of("ok", false, "error", "Thiếu ticket")));
            return;
        }
        E2eResetTicket t = e2eResetTickets.remove(ticket);
        long now = System.currentTimeMillis();
        if (t == null || now > t.expiresAt()) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, Json.write(Map.of("ok", false, "error", "Ticket không hợp lệ hoặc đã hết hạn")));
            return;
        }
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true, "userId", t.userId())));
    }

    public static int clampConfig(String key, int val) {
        return switch (key) {
            case "max_image_mb" -> Math.max(1, Math.min(50, val));
            case "max_file_mb_direct" -> Math.max(1, Math.min(100, val));
            case "max_file_mb_blob" -> Math.max(1, Math.min(50, val));
            case "max_files_per_message" -> Math.max(1, Math.min(20, val));
            case "user_blob_quota_mb" -> Math.max(10, Math.min(2048, val));
            case "blob_ttl_days" -> Math.max(1, Math.min(30, val));
            case "max_room_members" -> Math.max(2, Math.min(100, val));
            default -> val;
        };
    }

    public int maxImageMb() {
        return clampConfig("max_image_mb", configDao.getInt("max_image_mb", 10));
    }

    public int maxFileMbDirect() {
        return clampConfig("max_file_mb_direct", configDao.getInt("max_file_mb_direct", 25));
    }

    public int maxFileMbBlob() {
        return clampConfig("max_file_mb_blob", configDao.getInt("max_file_mb_blob", 10));
    }

    public int maxFilesPerMessage() {
        return clampConfig("max_files_per_message", configDao.getInt("max_files_per_message", 5));
    }

    public int userBlobQuotaMb() {
        return clampConfig("user_blob_quota_mb", configDao.getInt("user_blob_quota_mb", 200));
    }

    public int blobTtlDays() {
        return clampConfig("blob_ttl_days", configDao.getInt("blob_ttl_days", 7));
    }

    private void handlePublicConfig(ChannelHandlerContext ctx) throws SQLException {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("max_room_members", maxRoomMembers());
        body.put("max_image_mb", maxImageMb());
        body.put("max_file_mb_direct", maxFileMbDirect());
        body.put("max_file_mb_blob", maxFileMbBlob());
        body.put("max_files_per_message", maxFilesPerMessage());
        body.put("user_blob_quota_mb", userBlobQuotaMb());
        body.put("blob_ttl_days", blobTtlDays());
        write(ctx, HttpResponseStatus.OK, Json.write(body));
    }

    /** Số thành viên tối đa mỗi phòng (gồm người tạo), admin cấu hình được. */
    private int maxRoomMembers() {
        return configDao.getInt("max_room_members", DEFAULT_MAX_ROOM_MEMBERS);
    }

    private void handleRegister(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        JsonNode b = Json.tree(body(req));
        String username = nstr(b, "username");
        String email = nstr(b, "email");
        String password = nstr(b, "password");
        String displayName = nstr(b, "display_name");
        String dob = nstr(b, "date_of_birth");

        if (email == null || !email.matches(EMAIL_RE) || email.length() > 255) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_email"));
            return;
        }
        if (password == null || password.length() < 6 || password.length() > 72) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_password"));
            return;
        }
        if (dob != null && !dob.matches(DOB_RE)) {
            dob = null;
        }
        if (displayName == null || displayName.isBlank()) {
            displayName = email.substring(0, email.indexOf('@'));
        }
        if (displayName.length() > 100) {
            displayName = displayName.substring(0, 100);
        }
        if (username != null && username.isBlank()) {
            username = null;
        }
        if (username != null && !username.matches(USERNAME_RE)) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_username"));
            return;
        }

        String lowerEmail = email.toLowerCase(Locale.ROOT);
        Optional<User> existing = dao.findByEmail(lowerEmail);
        String hash = BCrypt.withDefaults().hashToString(12, password.toCharArray());

        if (existing.isPresent()) {
            if (existing.get().emailVerified()) {
                write(ctx, HttpResponseStatus.CONFLICT, err("email_taken"));
                return;
            }
            String uname = resolveUsername(username, lowerEmail);
            if (!uname.equals(existing.get().username()) && dao.usernameExists(uname)) {
                write(ctx, HttpResponseStatus.CONFLICT, err("username_taken"));
                return;
            }
            dao.updateUnverified(existing.get(), uname, hash, displayName, dob);
            if (!sendOtp(ctx, lowerEmail, "register")) {
                return;
            }
            write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true, "otp_sent", true)));
            return;
        }

        String uname = resolveUsername(username, lowerEmail);
        if (dao.usernameExists(uname)) {
            write(ctx, HttpResponseStatus.CONFLICT, err("username_taken"));
            return;
        }
        dao.insertUser(uname, lowerEmail, hash, displayName, dob);
        if (!sendOtp(ctx, lowerEmail, "register")) {
            return;
        }
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true, "otp_sent", true)));
    }

    private void handleResendOtp(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        JsonNode b = Json.tree(body(req));
        String email = cleanEmail(nstr(b, "email"));
        if (email == null) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_email"));
            return;
        }
        Optional<User> u = dao.findByEmail(email);
        if (u.isEmpty() || u.get().emailVerified()) {
            write(ctx, HttpResponseStatus.NOT_FOUND, err("not_found"));
            return;
        }
        if (!sendOtp(ctx, email, "register")) {
            return;
        }
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true, "otp_sent", true)));
    }

    private void handleVerifyOtp(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        JsonNode b = Json.tree(body(req));
        String email = cleanEmail(nstr(b, "email"));
        String code = nstr(b, "code");
        String purpose = nstr(b, "purpose");
        if (email == null || code == null || !code.matches("^\\d{6}$")) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_body"));
            return;
        }
        if (purpose == null) {
            purpose = "register";
        }
        if (!purpose.equals("register") && !purpose.equals("forgot_password")) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_body"));
            return;
        }
        boolean consume = purpose.equals("register");
        if (!checkOtp(email, code, purpose, consume)) {
            write(ctx, HttpResponseStatus.UNAUTHORIZED, err("invalid_otp"));
            return;
        }
        if (purpose.equals("register")) {
            Optional<User> u = dao.findByEmail(email);
            if (u.isEmpty()) {
                write(ctx, HttpResponseStatus.NOT_FOUND, err("not_found"));
                return;
            }
            dao.markEmailVerified(u.get().id());
            socialDao.ensurePublicId(u.get().id());
        }
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true, "purpose", purpose)));
    }

    private void handleForgotPassword(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        JsonNode b = Json.tree(body(req));
        String email = cleanEmail(nstr(b, "email"));
        if (email == null) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_email"));
            return;
        }
        Optional<User> u = dao.findByEmail(email);
        if (u.isEmpty() || !u.get().emailVerified()) {
            write(ctx, HttpResponseStatus.NOT_FOUND, err("not_found"));
            return;
        }
        if (!sendOtp(ctx, email, "forgot_password")) {
            return;
        }
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true, "otp_sent", true)));
    }

    private void handleResetPassword(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        JsonNode b = Json.tree(body(req));
        String email = cleanEmail(nstr(b, "email"));
        String code = nstr(b, "code");
        String newPassword = nstr(b, "new_password");
        if (email == null || code == null || !code.matches("^\\d{6}$")
                || newPassword == null || newPassword.length() < 6 || newPassword.length() > 72) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_body"));
            return;
        }
        if (!checkOtp(email, code, "forgot_password", true)) {
            write(ctx, HttpResponseStatus.UNAUTHORIZED, err("invalid_otp"));
            return;
        }
        Optional<User> u = dao.findByEmail(email);
        if (u.isEmpty() || !u.get().emailVerified()) {
            write(ctx, HttpResponseStatus.NOT_FOUND, err("not_found"));
            return;
        }
        String hash = BCrypt.withDefaults().hashToString(12, newPassword.toCharArray());
        dao.updatePassword(u.get().id(), hash);
        dao.revokeSessions(u.get().id());
        peerSessions.revokeUser(u.get().id());
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true)));
    }

    /** POST /api/logout — thu hồi toàn bộ phiên của người dùng hiện tại (đăng xuất mọi thiết bị). */
    private void handleLogout(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) {
            return;
        }
        dao.revokeSessions(me.id());
        // Thu hồi luôn mọi chìa phiên Peer Core của người dùng (RAM).
        peerSessions.revokeUser(me.id());
        if (systemLogDao != null) {
            systemLogDao.log("LOGOUT", me.id(), remoteIp(ctx), null);
        }
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true)));
    }

    private void handleLogin(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        JsonNode b = Json.tree(body(req));
        String login = nstr(b, "username");
        if (login == null) {
            login = nstr(b, "email");
        }
        String password = nstr(b, "password");
        if (login == null || password == null) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_body"));
            return;
        }
        String loginName = login.trim();
        String failKey = remoteIp(ctx) + "|" + loginName.toLowerCase(Locale.ROOT);
        long now = System.currentTimeMillis();
        LoginFail cur = loginFails.get(failKey);
        if (cur != null && now - cur.windowStart < LOGIN_WINDOW_MS
                && cur.count >= MAX_LOGIN_ATTEMPTS) {
            write(ctx, HttpResponseStatus.TOO_MANY_REQUESTS, err("too_many_attempts"));
            return;
        }
        if (cur != null && now - cur.windowStart >= LOGIN_WINDOW_MS) {
            loginFails.remove(failKey);
        }
        Optional<User> opt = dao.findByLogin(loginName);
        if (opt.isEmpty()
                || !BCrypt.verifyer().verify(password.toCharArray(), opt.get().passHash()).verified) {
            LoginFail f = loginFails.get(failKey);
            if (f == null || now - f.windowStart >= LOGIN_WINDOW_MS) {
                f = new LoginFail();
                f.windowStart = now;
                f.count = 0;
                loginFails.put(failKey, f);
            }
            f.count++;
            write(ctx, HttpResponseStatus.UNAUTHORIZED, err("invalid_credentials"));
            return;
        }
        loginFails.remove(failKey);
        User u = opt.get();
        if (!u.emailVerified()) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("email_not_verified"));
            return;
        }
        if (dao.isLocked(u.id())) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("account_locked"));
            return;
        }
        String deviceInfo = req.headers().get(HttpHeaderNames.USER_AGENT);
        String token = dao.createSession(u.id(), sessionTtlDays, deviceInfo);
        if (systemLogDao != null) {
            systemLogDao.log("LOGIN", u.id(), remoteIp(ctx), null);
        }
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("token", token, "user", userJson(u))));
    }

    private void handleMe(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        String token = bearer(req);
        if (token == null) {
            write(ctx, HttpResponseStatus.UNAUTHORIZED, err("missing_token"));
            return;
        }
        Optional<Profile> opt = dao.findProfileByToken(token);
        if (opt.isEmpty()) {
            write(ctx, HttpResponseStatus.UNAUTHORIZED, err("invalid_token"));
            return;
        }
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("user", profileJson(opt.get()))));
    }

    private void handleChangePassword(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        String token = bearer(req);
        User u = requireUser(ctx, token);
        if (u == null) {
            return;
        }
        JsonNode b = Json.tree(body(req));
        String current = nstr(b, "current_password");
        String next = nstr(b, "new_password");
        if (current == null || next == null || next.length() < 6 || next.length() > 72) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_body"));
            return;
        }
        if (!BCrypt.verifyer().verify(current.toCharArray(), u.passHash()).verified) {
            write(ctx, HttpResponseStatus.UNAUTHORIZED, err("invalid_credentials"));
            return;
        }
        if (BCrypt.verifyer().verify(next.toCharArray(), u.passHash()).verified) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("password_same"));
            return;
        }
        String hash = BCrypt.withDefaults().hashToString(12, next.toCharArray());
        dao.updatePassword(u.id(), hash);
        dao.revokeSessionsExcept(u.id(), token);
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true)));
    }

    private void handleUpdateProfile(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        String token = bearer(req);
        User u = requireUser(ctx, token);
        if (u == null) {
            return;
        }
        JsonNode b = Json.tree(body(req));
        String displayName = nstr(b, "display_name");
        String bio = nstr(b, "bio");
        String phone = nstr(b, "phone");
        String dob = nstr(b, "date_of_birth");
        if (displayName != null && (displayName.isBlank() || displayName.length() > 100)) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_display_name"));
            return;
        }
        if (bio != null && bio.length() > 150) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_bio"));
            return;
        }
        if (phone != null && phone.length() > 20) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_phone"));
            return;
        }
        if (dob != null && dob.isBlank()) {
            dob = null;
        }
        if (dob != null && (dob.length() > 10 || !dob.matches(DOB_RE))) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_birthdate"));
            return;
        }
        Boolean phonePublic = null;
        JsonNode pp = b.get("phone_public");
        if (pp != null && !pp.isNull()) {
            if (!pp.isBoolean()) {
                write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_body"));
                return;
            }
            phonePublic = pp.asBoolean();
        }
        String avatar = null;
        JsonNode av = b.get("avatar");
        if (av != null && !av.isNull()) {
            String v = av.asText();
            if (v.isEmpty()) {
                avatar = "";
            } else if (v.length() > MAX_AVATAR_LEN || !v.startsWith(DATA_IMAGE_PREFIX)) {
                write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_avatar"));
                return;
            } else {
                avatar = v;
            }
        }
        String cover = null;
        JsonNode cv = b.get("cover");
        if (cv != null && !cv.isNull()) {
            String v = cv.asText();
            if (v.isEmpty()) {
                cover = "";
            } else if (v.length() > MAX_COVER_LEN || !v.startsWith(DATA_IMAGE_PREFIX)) {
                write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_cover"));
                return;
            } else {
                cover = v;
            }
        }
        dao.updateProfile(u.id(), displayName, bio, phone, dob, phonePublic, avatar, cover);
        Optional<Profile> p = dao.findProfileByToken(token);
        Map<String, Object> updatedUser = null;
        if (p.isPresent()) {
            updatedUser = profileJson(p.get());
        }
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of(
                "ok", true,
                "user", updatedUser
        )));
    }

    private void handleChangeEmailRequest(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        String token = bearer(req);
        User u = requireUser(ctx, token);
        if (u == null) {
            return;
        }
        JsonNode b = Json.tree(body(req));
        String newEmail = cleanEmail(nstr(b, "new_email"));
        String currentPassword = nstr(b, "current_password");
        if (newEmail == null || currentPassword == null) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_body"));
            return;
        }
        if (newEmail.equalsIgnoreCase(u.email())) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("email_same"));
            return;
        }
        if (dao.emailExists(newEmail)) {
            write(ctx, HttpResponseStatus.CONFLICT, err("email_taken"));
            return;
        }
        if (!BCrypt.verifyer().verify(currentPassword.toCharArray(), u.passHash()).verified) {
            write(ctx, HttpResponseStatus.UNAUTHORIZED, err("invalid_credentials"));
            return;
        }
        if (mailer == null) {
            write(ctx, HttpResponseStatus.INTERNAL_SERVER_ERROR, err("mail_not_configured"));
            return;
        }
        if (!sendOtp(ctx, u.email().toLowerCase(Locale.ROOT), "change_email_old")) {
            return;
        }
        if (!sendOtp(ctx, newEmail, "change_email_new")) {
            return;
        }
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true, "otp_sent", true)));
    }

    private void handleChangeEmailConfirm(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        String token = bearer(req);
        User u = requireUser(ctx, token);
        if (u == null) {
            return;
        }
        JsonNode b = Json.tree(body(req));
        String newEmail = cleanEmail(nstr(b, "new_email"));
        String codeOld = nstr(b, "code_old");
        String codeNew = nstr(b, "code_new");
        if (newEmail == null || codeOld == null || !codeOld.matches("^\\d{6}$")
                || codeNew == null || !codeNew.matches("^\\d{6}$")) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_body"));
            return;
        }
        if (dao.emailExists(newEmail)) {
            write(ctx, HttpResponseStatus.CONFLICT, err("email_taken"));
            return;
        }
        if (!checkOtp(u.email().toLowerCase(Locale.ROOT), codeOld, "change_email_old", true)) {
            write(ctx, HttpResponseStatus.UNAUTHORIZED, err("invalid_otp"));
            return;
        }
        if (!checkOtp(newEmail, codeNew, "change_email_new", true)) {
            write(ctx, HttpResponseStatus.UNAUTHORIZED, err("invalid_otp"));
            return;
        }
        dao.updateEmail(u.id(), newEmail);
        dao.revokeSessionsExcept(u.id(), token);
        Optional<Profile> p = dao.findProfileByToken(token);
        Map<String, Object> updatedUser = null;
        if (p.isPresent()) {
            updatedUser = profileJson(p.get());
        }
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of(
                "ok", true,
                "user", updatedUser
        )));
    }

    private User requireUser(ChannelHandlerContext ctx, String token) throws SQLException {
        if (token == null) {
            write(ctx, HttpResponseStatus.UNAUTHORIZED, err("missing_token"));
            return null;
        }
        Optional<User> opt = dao.findUserByToken(token);
        if (opt.isPresent()) {
            return opt.get();
        }
        // Chấp nhận chìa phiên Peer Core (RAM) cấp qua /api/peer/exchange.
        Long peerUserId = peerSessions.validate(token);
        if (peerUserId == null) {
            write(ctx, HttpResponseStatus.UNAUTHORIZED, err("invalid_token"));
            return null;
        }
        Optional<User> peerUser = dao.findById(peerUserId);
        if (peerUser.isEmpty()) {
            write(ctx, HttpResponseStatus.UNAUTHORIZED, err("invalid_token"));
            return null;
        }
        return peerUser.get();
    }

    /** Xác thực người gọi là admin/moderator (đã đăng nhập, không bị khoá). */
    private User requireAdmin(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) {
            return null;
        }
        String role = me.role();
        if (!"admin".equals(role) && !"moderator".equals(role)) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("forbidden"));
            return null;
        }
        if (dao.isLocked(me.id())) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("account_locked"));
            return null;
        }
        return me;
    }

    private void handleAdminUsers(ChannelHandlerContext ctx, FullHttpRequest req, String query) throws SQLException {
        if (requireAdmin(ctx, req) == null) {
            return;
        }
        String q = param(query, "q", "");
        int limit = intParam(query, "limit", 100);
        int offset = intParam(query, "offset", 0);
        java.util.List<com.workchat.tracker.model.AdminUser> rows = dao.listForAdmin(q, limit, offset);
        java.util.List<Map<String, Object>> out = new java.util.ArrayList<>();
        for (com.workchat.tracker.model.AdminUser a : rows) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", a.id());
            m.put("username", a.username());
            m.put("email", a.email());
            m.put("display_name", a.displayName());
            m.put("role", a.role());
            m.put("locked", a.locked());
            m.put("email_verified", a.emailVerified());
            m.put("last_seen_at", a.lastSeenAt());
            out.add(m);
        }
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("users", out)));
    }

    private void handleAdminLock(ChannelHandlerContext ctx, FullHttpRequest req, String path) throws SQLException {
        User admin = requireAdmin(ctx, req);
        if (admin == null) {
            return;
        }
        boolean lock = path.endsWith("/lock");
        String mid = path.substring("/api/admin/users/".length(), path.lastIndexOf('/'));
        long targetId;
        try {
            targetId = Long.parseLong(mid);
        } catch (NumberFormatException e) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_id"));
            return;
        }
        if (targetId == admin.id()) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("cannot_lock_self"));
            return;
        }
        if (!dao.setLocked(targetId, lock)) {
            write(ctx, HttpResponseStatus.NOT_FOUND, err("not_found"));
            return;
        }
        if (lock) {
            dao.revokeSessions(targetId);
            peerSessions.revokeUser(targetId);
        }
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true, "locked", lock)));
    }

    private void handleAdminPeers(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        if (requireAdmin(ctx, req) == null) {
            return;
        }
        java.util.List<Map<String, Object>> out = new java.util.ArrayList<>();
        long now = System.currentTimeMillis();
        for (Long uid : registry.alivePeerIds()) {
            ClientRegistry.PeerAddress pa = registry.peer(uid);
            Optional<User> u = dao.findById(uid);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", uid);
            m.put("username", pa != null ? pa.username() : "");
            m.put("display_name", u.map(User::displayName).orElse(""));
            m.put("email", u.map(User::email).orElse(""));
            long seen = registry.lastSeenAt(uid);
            m.put("online_since", seen);
            m.put("online_secs", seen > 0 ? (now - seen) / 1000 : 0);
            boolean p2p = pa != null && pa.udpPublicPort() > 0;
            m.put("connection", p2p ? "p2p" : "server");
            out.add(m);
        }
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("peers", out, "count", out.size())));
    }

    private void handleAdminLogs(ChannelHandlerContext ctx, FullHttpRequest req, String query) throws SQLException {
        if (requireAdmin(ctx, req) == null) {
            return;
        }
        String type = param(query, "type", "all");
        int limit = intParam(query, "limit", 100);
        if (systemLogDao == null) {
            write(ctx, HttpResponseStatus.OK, Json.write(Map.of("logs", java.util.List.of())));
            return;
        }
        write(ctx, HttpResponseStatus.OK,
                Json.write(Map.of("logs", systemLogDao.list(type, limit))));
    }

    private void handleAdminOverview(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        if (requireAdmin(ctx, req) == null) {
            return;
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("total_users", dao.countUsers());
        body.put("online_peers", registry.alivePeerCount());
        body.put("sessions", registry.onlineCount());
        body.put("p2p_peers", registry.p2pPeerCount());
        body.put("pending_reports", reportsDao == null ? 0L : reportsDao.countByStatus("pending"));
        write(ctx, HttpResponseStatus.OK, Json.write(body));
    }

    private void adminConfig(ChannelHandlerContext ctx, HttpMethod m, FullHttpRequest req) throws SQLException {
        if (m == HttpMethod.GET) {
            if (requireAdmin(ctx, req) == null) {
                return;
            }
            write(ctx, HttpResponseStatus.OK, Json.write(Map.of("config", configDao.listAll())));
        } else if (m == HttpMethod.POST) {
            handleAdminConfigSet(ctx, req);
        } else {
            write(ctx, HttpResponseStatus.METHOD_NOT_ALLOWED, err("method_not_allowed"));
        }
    }

    private void handleAdminConfigSet(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        if (requireAdmin(ctx, req) == null) {
            return;
        }
        JsonNode b = Json.tree(body(req));
        String key = nstr(b, "key");
        String value = nstr(b, "value");
        if (key == null || value == null || !ALLOWED_CONFIG_KEYS.contains(key)) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_config"));
            return;
        }
        String trimmed = value.trim();
        if (!trimmed.matches("^\\d{1,9}$")) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_config_value"));
            return;
        }
        int rawVal = Integer.parseInt(trimmed);
        int clamped = clampConfig(key, rawVal);
        String savedVal = String.valueOf(clamped);
        configDao.set(key, savedVal, adminIdOf(req));
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true, "key", key, "value", savedVal)));
    }

    private void handleAdminSetRole(ChannelHandlerContext ctx, FullHttpRequest req, String path) throws SQLException {
        User admin = requireAdmin(ctx, req);
        if (admin == null) {
            return;
        }
        String mid = path.substring("/api/admin/users/".length(), path.lastIndexOf('/'));
        long targetId;
        try {
            targetId = Long.parseLong(mid);
        } catch (NumberFormatException e) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_id"));
            return;
        }
        JsonNode b = Json.tree(body(req));
        String role = nstr(b, "role");
        if (role == null || (!role.equals("user") && !role.equals("moderator") && !role.equals("admin"))) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_role"));
            return;
        }
        if (targetId == admin.id()) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("cannot_change_own_role"));
            return;
        }
        if (!dao.setRole(targetId, role)) {
            write(ctx, HttpResponseStatus.NOT_FOUND, err("not_found"));
            return;
        }
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true, "role", role)));
    }

    private void handleAdminReports(ChannelHandlerContext ctx, FullHttpRequest req, String query) throws SQLException {
        if (requireAdmin(ctx, req) == null) {
            return;
        }
        String status = param(query, "status", "all");
        int limit = intParam(query, "limit", 100);
        if (reportsDao == null) {
            write(ctx, HttpResponseStatus.OK, Json.write(Map.of("reports", java.util.List.of())));
            return;
        }
        write(ctx, HttpResponseStatus.OK,
                Json.write(Map.of("reports", reportsDao.list(status, limit))));
    }

    private void handleAdminReportStatus(ChannelHandlerContext ctx, FullHttpRequest req, String path) throws SQLException {
        User admin = requireAdmin(ctx, req);
        if (admin == null) {
            return;
        }
        String mid = path.substring("/api/admin/reports/".length(), path.lastIndexOf('/'));
        long id;
        try {
            id = Long.parseLong(mid);
        } catch (NumberFormatException e) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_id"));
            return;
        }
        JsonNode b = Json.tree(body(req));
        String status = nstr(b, "status");
        if (status == null || (!status.equals("resolved") && !status.equals("dismissed") && !status.equals("pending"))) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_status"));
            return;
        }
        if (reportsDao == null || !reportsDao.setStatus(id, status, admin.id())) {
            write(ctx, HttpResponseStatus.NOT_FOUND, err("not_found"));
            return;
        }
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true, "status", status)));
    }

    private void adminBroadcasts(ChannelHandlerContext ctx, HttpMethod m, FullHttpRequest req, String query) throws SQLException {
        if (m == HttpMethod.GET) {
            if (requireAdmin(ctx, req) == null) {
                return;
            }
            int limit = intParam(query, "limit", 50);
            if (broadcastDao == null) {
                write(ctx, HttpResponseStatus.OK, Json.write(Map.of("broadcasts", java.util.List.of())));
                return;
            }
            write(ctx, HttpResponseStatus.OK,
                    Json.write(Map.of("broadcasts", broadcastDao.list(limit))));
        } else if (m == HttpMethod.POST) {
            handleAdminBroadcastSend(ctx, req);
        } else {
            write(ctx, HttpResponseStatus.METHOD_NOT_ALLOWED, err("method_not_allowed"));
        }
    }

    private void handleAdminBroadcastSend(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        User admin = requireAdmin(ctx, req);
        if (admin == null) {
            return;
        }
        JsonNode b = Json.tree(body(req));
        String title = nstr(b, "title");
        String content = nstr(b, "content");
        if (title == null || title.isBlank() || content == null || content.isBlank()) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_body"));
            return;
        }
        if (title.length() > 255 || content.length() > 4000) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("too_long"));
            return;
        }
        long id = broadcastDao == null ? 0L : broadcastDao.insert(title.trim(), content.trim(), admin.id());
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("type", "system_notice");
        payload.put("id", id);
        payload.put("title", title.trim());
        payload.put("content", content.trim());
        payload.put("sent_at", System.currentTimeMillis());
        int reached = registry.sendToAll(payload);
        if (systemLogDao != null) {
            systemLogDao.log("LOOKUP", admin.id(), remoteIp(ctx), "broadcast#" + id);
        }
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true, "id", id, "reached", reached)));
    }

    private Long adminIdOf(FullHttpRequest req) {
        try {
            return dao.findUserByToken(bearer(req)).map(User::id).orElse(null);
        } catch (SQLException e) {
            return null;
        }
    }

    // ---------- kết bạn + mã mời phòng (Phần 1) ----------

    private void handleUserSearch(ChannelHandlerContext ctx, FullHttpRequest req, String query) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) {
            return;
        }
        String q = param(query, "q", "").trim();
        if (q.isEmpty()) {
            write(ctx, HttpResponseStatus.OK, Json.write(Map.of("users", List.of())));
            return;
        }
        List<SocialDao.PublicUser> list = socialDao.searchUsers(q, 20);
        List<Map<String, Object>> items = new ArrayList<>();
        for (SocialDao.PublicUser u : list) {
            SocialDao.Relation rel = u.id() == me.id()
                    ? SocialDao.Relation.SELF
                    : socialDao.relation(me.id(), u.id());
            Optional<Long> rid = (rel == SocialDao.Relation.PENDING_SENT || rel == SocialDao.Relation.PENDING_RECEIVED)
                    ? socialDao.pendingRequestId(me.id(), u.id())
                    : Optional.empty();
            boolean online = rel == SocialDao.Relation.SELF || registry.isUserOnline(u.id(), u.username());
            items.add(profileUserJson(u, rel, rid, online));
        }
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("users", items)));
    }

    private void handleUserByPublicId(ChannelHandlerContext ctx, FullHttpRequest req, String query) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) {
            return;
        }
        if (!rateAllow("pub:" + remoteIp(ctx), 30, 60_000L)) {
            write(ctx, HttpResponseStatus.TOO_MANY_REQUESTS, err("rate_limited"));
            return;
        }
        String publicId = param(query, "public_id", "").trim();
        if (publicId.startsWith("/u/")) publicId = publicId.substring(3);
        else if (publicId.startsWith("u/")) publicId = publicId.substring(2);
        else if (publicId.startsWith("@")) publicId = publicId.substring(1);
        if (publicId.length() < 3 || publicId.length() > 64) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_public_id"));
            return;
        }
        Optional<SocialDao.PublicUser> p = socialDao.findUserByPublicId(publicId);
        if (p.isEmpty()) {
            write(ctx, HttpResponseStatus.NOT_FOUND, err("user_not_found"));
            return;
        }
        SocialDao.PublicUser u = p.get();
        SocialDao.Relation rel = u.id() == me.id()
                ? SocialDao.Relation.SELF
                : socialDao.relation(me.id(), u.id());
        Optional<Long> rid = (rel == SocialDao.Relation.PENDING_SENT || rel == SocialDao.Relation.PENDING_RECEIVED)
                ? socialDao.pendingRequestId(me.id(), u.id())
                : Optional.empty();
        boolean online = rel == SocialDao.Relation.SELF || registry.isUserOnline(u.id(), u.username());
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("user", profileUserJson(u, rel, rid, online))));
    }

    private void handleFriendList(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) {
            return;
        }
        List<Map<String, Object>> items = new ArrayList<>();
        for (SocialDao.PublicUser u : socialDao.listFriends(me.id())) {
            items.add(publicUserJson(u, SocialDao.Relation.FRIEND));
        }
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("friends", items)));
    }

    private void handleFriendRequests(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) {
            return;
        }
        List<Map<String, Object>> items = new ArrayList<>();
        for (SocialDao.FriendRequestRow r : socialDao.listRequests(me.id())) {
            Map<String, Object> from = new LinkedHashMap<>();
            from.put("public_id", r.publicId());
            from.put("display_name", r.fromDisplayName() == null ? r.fromUsername() : r.fromDisplayName());
            from.put("avatar", r.fromAvatar() == null ? "" : r.fromAvatar());
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("request_id", r.id());
            item.put("from", from);
            item.put("created_at", r.createdAtMs());
            items.add(item);
        }
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("requests", items)));
    }

    private void handleFriendSent(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) {
            return;
        }
        List<Map<String, Object>> items = new ArrayList<>();
        for (SocialDao.SentRequestRow r : socialDao.listSentRequests(me.id())) {
            Map<String, Object> to = new LinkedHashMap<>();
            to.put("id", r.toUserId());
            to.put("public_id", r.publicId());
            to.put("username", r.toUsername());
            to.put("display_name", r.toDisplayName() == null ? r.toUsername() : r.toDisplayName());
            to.put("avatar", r.toAvatar() == null ? "" : r.toAvatar());
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("request_id", r.id());
            item.put("to", to);
            item.put("created_at", r.createdAtMs());
            items.add(item);
        }
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("requests", items)));
    }

    private void handleFriendSuggestions(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) {
            return;
        }
        List<Map<String, Object>> items = new ArrayList<>();
        for (SocialDao.SuggestionRow s : socialDao.listSuggestions(me.id())) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", s.id());
            item.put("public_id", s.publicId());
            item.put("username", s.username());
            item.put("display_name", s.displayName());
            item.put("avatar", s.avatar());
            item.put("mutual_count", s.mutualCount());
            item.put("shared_rooms", s.sharedRooms());
            items.add(item);
        }
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("suggestions", items)));
    }

    private void handleFriendRequestCreate(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) {
            return;
        }
        JsonNode b = Json.tree(body(req));
        String publicId = nstr(b, "public_id");
        if (publicId != null) {
            publicId = publicId.trim();
            if (publicId.startsWith("/u/")) publicId = publicId.substring(3);
            else if (publicId.startsWith("u/")) publicId = publicId.substring(2);
            else if (publicId.startsWith("@")) publicId = publicId.substring(1);
        }
        if (publicId == null || publicId.length() < 3 || publicId.length() > 64) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_public_id"));
            return;
        }
        Optional<SocialDao.PublicUser> p = socialDao.findUserByPublicId(publicId);
        if (p.isEmpty()) {
            write(ctx, HttpResponseStatus.NOT_FOUND, err("user_not_found"));
            return;
        }
        SocialDao.PublicUser target = p.get();
        if (target.id() == me.id()) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("self_request"));
            return;
        }
        SocialDao.RequestOutcome o = socialDao.requestFriend(me.id(), target.id());
        switch (o) {
            case SENT -> {
                Map<String, Object> resp = new LinkedHashMap<>();
                resp.put("ok", true);
                resp.put("outcome", "sent");
                Optional<Long> reqIdOpt = socialDao.pendingRequestId(me.id(), target.id());
                reqIdOpt.ifPresent(id -> resp.put("request_id", id));

                // Realtime notification to target
                Map<String, Object> notif = new LinkedHashMap<>();
                notif.put("type", "friend_request_received");
                reqIdOpt.ifPresent(id -> notif.put("request_id", id));
                Map<String, Object> from = new LinkedHashMap<>();
                String myPid = socialDao.ensurePublicId(me.id());
                Optional<SocialDao.PublicUser> myPub = socialDao.findUserById(me.id());
                from.put("public_id", myPid);
                from.put("username", me.username());
                from.put("display_name", me.displayName() == null ? me.username() : me.displayName());
                from.put("avatar", myPub.map(SocialDao.PublicUser::avatar).orElse(""));
                notif.put("from", from);
                registry.sendTo(target.username(), notif);

                write(ctx, HttpResponseStatus.OK, Json.write(resp));
            }
            case ACCEPTED_AUTOMATICALLY -> {
                long roomId = roomDao.createOrGetDirectRoom(me.id(), target.id());
                broadcastFriendAccepted(me, target.id(), roomId);
                write(ctx, HttpResponseStatus.OK, Json.write(Map.of(
                        "ok", true, "outcome", "accepted",
                        "room", roomJson(me.id(), roomId),
                        "friend", publicUserJson(target, SocialDao.Relation.FRIEND))));
            }
            case ERR_ALREADY_FRIEND -> write(ctx, HttpResponseStatus.CONFLICT, err("already_friends"));
            case ERR_PENDING -> write(ctx, HttpResponseStatus.CONFLICT, err("already_pending"));
            default -> write(ctx, HttpResponseStatus.BAD_REQUEST, err("bad_request"));
        }
    }

    private void handleFriendPathAction(ChannelHandlerContext ctx, FullHttpRequest req, String path) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) {
            return;
        }
        String[] seg = path.split("/");
        String action = seg[4];
        if ("unfriend".equals(action)) {
            long targetId = -1;
            try {
                targetId = Long.parseLong(seg[3]);
            } catch (NumberFormatException e) {
                Optional<SocialDao.PublicUser> pu = socialDao.findUserByPublicId(seg[3]);
                if (pu.isPresent()) {
                    targetId = pu.get().id();
                }
            }
            if (targetId <= 0) {
                write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_target_id"));
                return;
            }
            boolean done = socialDao.unfriend(me.id(), targetId);
            write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true, "unfriended", done)));
            return;
        }

        long requestId;
        try {
            requestId = Long.parseLong(seg[3]);
        } catch (NumberFormatException e) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_request_id"));
            return;
        }
        if ("accept".equals(action)) {
            SocialDao.AcceptResult res = socialDao.acceptRequest(requestId, me.id());
            if (res.outcome() == SocialDao.RespondOutcome.ACCEPTED) {
                broadcastFriendAccepted(me, res.peerId(), res.roomId());
                write(ctx, HttpResponseStatus.OK, Json.write(acceptedPayload(me, res)));
                return;
            }
            if (res.outcome() == SocialDao.RespondOutcome.ALREADY_RESPONDED) {
                write(ctx, HttpResponseStatus.CONFLICT, err("already_responded"));
                return;
            }
            write(ctx, HttpResponseStatus.NOT_FOUND, err("request_not_found"));
            return;
        }
        SocialDao.RespondOutcome o = "reject".equals(action)
                ? socialDao.rejectRequest(requestId, me.id())
                : socialDao.cancelRequest(requestId, me.id());
        switch (o) {
            case REJECTED -> write(ctx, HttpResponseStatus.OK,
                    Json.write(Map.of("ok", true, "outcome", "rejected")));
            case ALREADY_RESPONDED -> write(ctx, HttpResponseStatus.CONFLICT, err("already_responded"));
            default -> write(ctx, HttpResponseStatus.NOT_FOUND, err("request_not_found"));
        }
    }

    /** Payload trả về ngay cho bên bấm Đồng ý: phòng + thông tin công khai của bạn mới. */
    private Map<String, Object> acceptedPayload(User me, SocialDao.AcceptResult res) throws SQLException {
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("ok", true);
        resp.put("outcome", "accepted");
        resp.put("room", roomJson(me.id(), res.roomId()));
        socialDao.findUserById(res.peerId())
                .ifPresent(p -> resp.put("friend", publicUserJson(p, SocialDao.Relation.FRIEND)));
        return resp;
    }

    /**
     * Phát sự kiện kết bạn tới CẢ HAI phía nếu online: mỗi bên nhận phòng 1-1 (theo góc nhìn
     * của mình) + thông tin công khai tối thiểu của người kia. Không kèm email/username.
     */
    private void broadcastFriendAccepted(User me, long peerId, long roomId) throws SQLException {
        Optional<SocialDao.PublicUser> peerOpt = socialDao.findUserById(peerId);
        Optional<SocialDao.PublicUser> meOpt = socialDao.findUserById(me.id());
        if (peerOpt.isEmpty() || meOpt.isEmpty()) {
            return;
        }
        SocialDao.PublicUser peer = peerOpt.get();
        SocialDao.PublicUser mePu = meOpt.get();

        Map<String, Object> toMe = new LinkedHashMap<>();
        toMe.put("type", "friend_accepted");
        toMe.put("room", roomJson(me.id(), roomId));
        toMe.put("friend", publicUserJson(peer, SocialDao.Relation.FRIEND));
        registry.sendTo(me.username(), toMe);

        Map<String, Object> toPeer = new LinkedHashMap<>();
        toPeer.put("type", "friend_accepted");
        toPeer.put("room", roomJson(peerId, roomId));
        toPeer.put("friend", publicUserJson(mePu, SocialDao.Relation.FRIEND));
        registry.sendTo(peer.username(), toPeer);
    }

    private void handleFriendRequestRespond(ChannelHandlerContext ctx, FullHttpRequest req, boolean accept)
            throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) {
            return;
        }
        JsonNode b = Json.tree(body(req));
        Long requestId = longNode(b, "request_id");
        if (requestId == null || requestId < 1) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_request_id"));
            return;
        }
        if (accept) {
            SocialDao.AcceptResult res = socialDao.acceptRequest(requestId, me.id());
            if (res.outcome() == SocialDao.RespondOutcome.ACCEPTED) {
                broadcastFriendAccepted(me, res.peerId(), res.roomId());
                write(ctx, HttpResponseStatus.OK, Json.write(acceptedPayload(me, res)));
                return;
            }
            if (res.outcome() == SocialDao.RespondOutcome.ALREADY_RESPONDED) {
                write(ctx, HttpResponseStatus.CONFLICT, err("already_responded"));
                return;
            }
            write(ctx, HttpResponseStatus.NOT_FOUND, err("request_not_found"));
            return;
        }
        SocialDao.RespondOutcome o = socialDao.rejectRequest(requestId, me.id());
        switch (o) {
            case REJECTED -> write(ctx, HttpResponseStatus.OK,
                    Json.write(Map.of("ok", true, "outcome", "rejected")));
            case ALREADY_RESPONDED -> write(ctx, HttpResponseStatus.CONFLICT, err("already_responded"));
            default -> write(ctx, HttpResponseStatus.NOT_FOUND, err("request_not_found"));
        }
    }

    private void handleRoomJoin(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) {
            return;
        }
        if (!rateAllow("join:" + remoteIp(ctx), 20, 60_000L)) {
            write(ctx, HttpResponseStatus.TOO_MANY_REQUESTS, err("rate_limited"));
            return;
        }
        JsonNode b = Json.tree(body(req));
        String code = nstr(b, "code");
        if (code == null || code.length() < 6 || code.length() > 32 || !code.matches("^[0-9A-Za-z]+$")) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_invite_code"));
            return;
        }
        SocialDao.JoinResult r = socialDao.joinRoomByInvite(code, me.id());
        switch (r.outcome()) {
            case JOINED -> write(ctx, HttpResponseStatus.OK, Json.write(Map.of(
                    "ok", true, "room", roomJson(me, r.roomId()))));
            case ALREADY_MEMBER -> write(ctx, HttpResponseStatus.OK, Json.write(Map.of(
                    "ok", true, "already_member", true, "room", roomJson(me, r.roomId()))));
            case ROOM_FULL -> write(ctx, HttpResponseStatus.BAD_REQUEST, err("room_full"));
            case ROOM_NOT_FOUND -> write(ctx, HttpResponseStatus.NOT_FOUND, err("room_not_found"));
            case INVITE_EXPIRED -> write(ctx, HttpResponseStatus.GONE, err("invite_expired"));
            default -> write(ctx, HttpResponseStatus.NOT_FOUND, err("invite_not_found"));
        }
    }

    private void handleRoomInvite(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) {
            return;
        }
        JsonNode b = Json.tree(body(req));
        Long roomId = longNode(b, "room_id");
        if (roomId == null || roomId < 1) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_room"));
            return;
        }
        if (!isMember(roomId, me.id())) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("not_member"));
            return;
        }
        int ttl = 7;
        JsonNode ttlNode = b == null ? null : b.get("ttl_days");
        if (ttlNode != null && !ttlNode.isNull() && ttlNode.isNumber()) {
            int v = ttlNode.asInt();
            if (v >= 1 && v <= 30) {
                ttl = v;
            }
        }
        String code = socialDao.createInviteCode(roomId, me.id(), ttl);
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of(
                "ok", true, "room_id", roomId, "code", code)));
    }

    private void handleRoomMemberAdd(ChannelHandlerContext ctx, FullHttpRequest req, String path) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) {
            return;
        }
        String idStr = path.substring("/api/rooms/".length(), path.indexOf("/member/add"));
        long roomId;
        try {
            roomId = Long.parseLong(idStr);
        } catch (NumberFormatException e) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("bad_room"));
            return;
        }
        if (!isMember(roomId, me.id())) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("not_member"));
            return;
        }
        JsonNode b = Json.tree(body(req));
        Long userId = longNode(b, "user_id");
        if (userId == null || userId < 1 || userId == me.id()) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_user"));
            return;
        }
        if (roomDao.isUserBlocked(roomId, userId)) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("forbidden_member_blocked"));
            return;
        }
        RoomDao.RoomSettings settings = roomDao.getRoomSettings(roomId);
        String myRole = roomDao.getMemberRole(roomId, me.id());
        boolean isPrivileged = "owner".equalsIgnoreCase(myRole) || "admin".equalsIgnoreCase(myRole);
        if (settings.requireJoinApproval() && !isPrivileged) {
            long reqId = roomDao.createJoinRequest(roomId, userId, me.id(), "invite");
            broadcastJoinRequestCreated(roomId, reqId, userId, me.id());
            broadcastRoomUpdate(roomId);
            write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true, "pending_approval", true)));
            return;
        }
        SocialDao.JoinResult r = socialDao.inviteFriendToRoom(me.id(), roomId, userId);
        switch (r.outcome()) {
            case JOINED -> {
                dao.findById(userId).ifPresent(u -> {
                    try {
                        String targetName = u.displayName() != null && !u.displayName().isBlank() ? u.displayName() : u.username();
                        roomDao.insertSystemMessage(roomId, me.id(), me.displayName() + " đã thêm " + targetName + " vào nhóm");
                        Map<String, Object> toNew = new LinkedHashMap<>();
                        toNew.put("type", "room_added");
                        toNew.put("room", roomJson(userId, roomId));
                        registry.sendTo(u.username(), toNew);
                    } catch (Exception ignored) {}
                });
                broadcastRoomUpdate(roomId);
                write(ctx, HttpResponseStatus.OK, Json.write(Map.of(
                        "ok", true, "room", roomJson(me, r.roomId()))));
            }
            case ALREADY_MEMBER -> write(ctx, HttpResponseStatus.OK, Json.write(Map.of(
                    "ok", true, "already_member", true, "room", roomJson(me, r.roomId()))));
            case ROOM_FULL -> write(ctx, HttpResponseStatus.BAD_REQUEST, err("room_full"));
            case NOT_FRIEND -> write(ctx, HttpResponseStatus.FORBIDDEN, err("not_friend"));
            default -> write(ctx, HttpResponseStatus.NOT_FOUND, err("room_not_found"));
        }
    }

    private void broadcastRoomUpdate(long roomId) {
        try {
            List<RoomDao.MemberRow> members = roomDao.members(roomId);
            for (RoomDao.MemberRow m : members) {
                dao.findById(m.userId()).ifPresent(u -> {
                    try {
                        Map<String, Object> toMember = new LinkedHashMap<>();
                        toMember.put("type", "room_updated");
                        toMember.put("room", roomJson(m.userId(), roomId));
                        registry.sendTo(u.username(), toMember);
                    } catch (Exception ignored) {}
                });
            }
        } catch (Exception ignored) {}
    }

    private void handleRoomUpdate(ChannelHandlerContext ctx, FullHttpRequest req, String path) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) return;
        String idStr = path.substring("/api/rooms/".length());
        long roomId;
        try {
            roomId = Long.parseLong(idStr);
        } catch (NumberFormatException e) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("bad_room"));
            return;
        }
        if (!isMember(roomId, me.id())) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("not_member"));
            return;
        }
        RoomDao.RoomSettings settings = roomDao.getRoomSettings(roomId);
        String role = roomDao.getMemberRole(roomId, me.id());
        JsonNode b = Json.tree(body(req));
        String name = b.has("name") && !b.get("name").isNull() ? b.get("name").asText().trim() : null;
        String avatar = b.has("avatar") ? (b.get("avatar").isNull() ? "" : b.get("avatar").asText()) : null;
        String theme = b.has("theme") && !b.get("theme").isNull() ? b.get("theme").asText() : null;
        String emoji = b.has("emoji") && !b.get("emoji").isNull() ? b.get("emoji").asText() : null;
        String bg = b.has("bg") ? (b.get("bg").isNull() ? "" : b.get("bg").asText()) : null;

        if ((name != null || avatar != null) && "member".equalsIgnoreCase(role) && !settings.allowMemberEditInfo()) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("forbidden_member_edit_info"));
            return;
        }

        roomDao.updateRoom(roomId, name, avatar, theme, emoji, bg);
        if (name != null && !name.isBlank()) {
            roomDao.insertSystemMessage(roomId, me.id(), me.displayName() + " đã đổi tên nhóm thành \"" + name + "\"");
        } else if (avatar != null) {
            roomDao.insertSystemMessage(roomId, me.id(), me.displayName() + " đã cập nhật ảnh nhóm");
        }
        broadcastRoomUpdate(roomId);
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true, "room", roomJson(me, roomId))));
    }

    private void handleRoomMemberRole(ChannelHandlerContext ctx, FullHttpRequest req, String path) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) return;
        String idStr = path.substring("/api/rooms/".length(), path.indexOf("/member/role"));
        long roomId = Long.parseLong(idStr);
        if (!isMember(roomId, me.id())) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("not_member"));
            return;
        }
        JsonNode b = Json.tree(body(req));
        Long targetUserId = longNode(b, "user_id");
        String role = nstr(b, "role");
        if (targetUserId == null) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("missing_user"));
            return;
        }
        doSetMemberRole(ctx, me, roomId, targetUserId, role);
    }

    private void handleRoomMemberRolePath(ChannelHandlerContext ctx, FullHttpRequest req, String path) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) return;
        String[] parts = path.split("/");
        long roomId = Long.parseLong(parts[3]);
        long targetUserId = Long.parseLong(parts[5]);
        if (!isMember(roomId, me.id())) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("not_member"));
            return;
        }
        JsonNode b = Json.tree(body(req));
        String role = nstr(b, "role");
        doSetMemberRole(ctx, me, roomId, targetUserId, role);
    }

    private void doSetMemberRole(ChannelHandlerContext ctx, User me, long roomId, long targetUserId, String role) throws SQLException {
        String myRole = roomDao.getMemberRole(roomId, me.id());
        if (!"owner".equalsIgnoreCase(myRole)) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("forbidden_not_owner"));
            return;
        }
        if (targetUserId == me.id()) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("cannot_change_own_role"));
            return;
        }
        String targetRole = roomDao.getMemberRole(roomId, targetUserId);
        if ("owner".equalsIgnoreCase(targetRole)) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("forbidden_cannot_modify_owner"));
            return;
        }
        String newRole = "admin".equalsIgnoreCase(role) || "leader".equalsIgnoreCase(role) ? "admin" : "member";
        roomDao.updateMemberRole(roomId, targetUserId, newRole);
        dao.findById(targetUserId).ifPresent(u -> {
            try {
                String targetName = u.displayName() != null && !u.displayName().isBlank() ? u.displayName() : u.username();
                if ("admin".equals(newRole)) {
                    roomDao.insertSystemMessage(roomId, me.id(), me.displayName() + " đã bổ nhiệm " + targetName + " làm phó nhóm");
                } else {
                    roomDao.insertSystemMessage(roomId, me.id(), me.displayName() + " đã gỡ quyền phó nhóm của " + targetName);
                }
            } catch (Exception ignored) {}
        });
        broadcastRoomUpdate(roomId);
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true, "room", roomJson(me, roomId))));
    }

    private void handleRoomMemberRemove(ChannelHandlerContext ctx, FullHttpRequest req, String path) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) return;
        String idStr = path.substring("/api/rooms/".length(), path.indexOf("/member/remove"));
        long roomId = Long.parseLong(idStr);
        if (!isMember(roomId, me.id())) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("not_member"));
            return;
        }
        JsonNode b = Json.tree(body(req));
        Long targetUserId = longNode(b, "user_id");
        if (targetUserId == null) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("missing_user"));
            return;
        }
        doRemoveMemberWithPermissions(ctx, me, roomId, targetUserId);
    }

    private void handleRoomMemberDelete(ChannelHandlerContext ctx, FullHttpRequest req, String path) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) return;
        String[] parts = path.split("/");
        long roomId = Long.parseLong(parts[3]);
        long targetUserId = Long.parseLong(parts[5]);
        if (!isMember(roomId, me.id())) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("not_member"));
            return;
        }
        doRemoveMemberWithPermissions(ctx, me, roomId, targetUserId);
    }

    private void doRemoveMemberWithPermissions(ChannelHandlerContext ctx, User me, long roomId, long targetUserId) throws SQLException {
        String myRole = roomDao.getMemberRole(roomId, me.id());
        String targetRole = roomDao.getMemberRole(roomId, targetUserId);
        if ("member".equalsIgnoreCase(myRole)) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("forbidden_not_admin"));
            return;
        }
        if ("owner".equalsIgnoreCase(targetRole)) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("forbidden_cannot_modify_owner"));
            return;
        }
        if ("admin".equalsIgnoreCase(myRole) && "admin".equalsIgnoreCase(targetRole)) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("forbidden_cannot_modify_admin"));
            return;
        }
        roomDao.removeMember(roomId, targetUserId);
        dao.findById(targetUserId).ifPresent(u -> {
            try {
                String targetName = u.displayName() != null && !u.displayName().isBlank() ? u.displayName() : u.username();
                roomDao.insertSystemMessage(roomId, me.id(), me.displayName() + " đã xóa " + targetName + " khỏi nhóm");
                registry.sendTo(u.username(), Map.of("type", "room_removed", "roomId", roomId));
            } catch (Exception ignored) {}
        });
        broadcastRoomUpdate(roomId);
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true)));
    }

    private void handleRoomLeave(ChannelHandlerContext ctx, FullHttpRequest req, String path) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) return;
        String idStr = path.substring("/api/rooms/".length(), path.indexOf("/leave"));
        long roomId = Long.parseLong(idStr);
        if (!isMember(roomId, me.id())) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("not_member"));
            return;
        }
        String myRole = roomDao.getMemberRole(roomId, me.id());
        List<RoomDao.MemberRow> members = roomDao.members(roomId);
        if ("owner".equalsIgnoreCase(myRole)) {
            long otherCount = members.stream().filter(m -> m.userId() != me.id()).count();
            if (otherCount > 0) {
                write(ctx, HttpResponseStatus.BAD_REQUEST, err("must_transfer_owner"));
                return;
            } else {
                roomDao.dissolveRoom(roomId);
                write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true, "dissolved", true)));
                return;
            }
        }
        roomDao.removeMember(roomId, me.id());
        roomDao.insertSystemMessage(roomId, me.id(), me.displayName() + " đã rời khỏi nhóm");
        broadcastRoomUpdate(roomId);
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true)));
    }

    private void handleRoomSettingsPatch(ChannelHandlerContext ctx, FullHttpRequest req, String path) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) return;
        String idStr = path.substring("/api/rooms/".length(), path.indexOf("/settings"));
        long roomId = Long.parseLong(idStr);
        if (!isMember(roomId, me.id())) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("not_member"));
            return;
        }
        String myRole = roomDao.getMemberRole(roomId, me.id());
        if (!"owner".equalsIgnoreCase(myRole) && !"admin".equalsIgnoreCase(myRole)) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("forbidden_not_admin"));
            return;
        }
        JsonNode b = Json.tree(body(req));
        if (b.has("action") && "regenerate_link".equals(b.get("action").asText())) {
            String token = roomDao.regenerateJoinToken(roomId);
            broadcastRoomUpdate(roomId);
            write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true, "token", token)));
            return;
        }
        Map<String, Object> patch = new LinkedHashMap<>();
        if (b.has("settings") && b.get("settings").isObject()) {
            b = b.get("settings");
        }
        for (var it = b.fields(); it.hasNext(); ) {
            var e = it.next();
            if (e.getValue().isBoolean()) {
                patch.put(e.getKey(), e.getValue().asBoolean());
            } else if (e.getValue().isTextual()) {
                patch.put(e.getKey(), e.getValue().asText());
            }
        }
        roomDao.updateRoomSettings(roomId, patch);
        roomDao.insertSystemMessage(roomId, me.id(), me.displayName() + " đã cập nhật cài đặt nhóm");
        broadcastRoomUpdate(roomId);
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true, "settings", roomDao.getRoomSettings(roomId).toMap())));
    }

    private void handleRoomTransferOwner(ChannelHandlerContext ctx, FullHttpRequest req, String path) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) return;
        String idStr = path.substring("/api/rooms/".length(), path.indexOf("/transfer-owner"));
        long roomId = Long.parseLong(idStr);
        if (!isMember(roomId, me.id())) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("not_member"));
            return;
        }
        String myRole = roomDao.getMemberRole(roomId, me.id());
        if (!"owner".equalsIgnoreCase(myRole)) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("forbidden_not_owner"));
            return;
        }
        JsonNode b = Json.tree(body(req));
        Long newOwnerId = longNode(b, "new_owner_id");
        if (newOwnerId == null || newOwnerId == me.id()) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_new_owner"));
            return;
        }
        boolean ok = roomDao.transferOwner(roomId, me.id(), newOwnerId);
        if (!ok) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("transfer_failed"));
            return;
        }
        dao.findById(newOwnerId).ifPresent(u -> {
            try {
                String targetName = u.displayName() != null && !u.displayName().isBlank() ? u.displayName() : u.username();
                roomDao.insertSystemMessage(roomId, me.id(), me.displayName() + " đã chuyển quyền trưởng nhóm cho " + targetName);
            } catch (Exception ignored) {}
        });
        broadcastRoomUpdate(roomId);
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true, "room", roomJson(me, roomId))));
    }

    private void handleRoomDissolve(ChannelHandlerContext ctx, FullHttpRequest req, String path) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) return;
        String idStr = path.substring("/api/rooms/".length(), path.indexOf("/dissolve"));
        long roomId = Long.parseLong(idStr);
        if (!isMember(roomId, me.id())) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("not_member"));
            return;
        }
        String myRole = roomDao.getMemberRole(roomId, me.id());
        if (!"owner".equalsIgnoreCase(myRole)) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("forbidden_not_owner"));
            return;
        }
        List<RoomDao.MemberRow> members = roomDao.members(roomId);
        roomDao.dissolveRoom(roomId);
        for (RoomDao.MemberRow m : members) {
            dao.findById(m.userId()).ifPresent(u -> {
                try {
                    registry.sendTo(u.username(), Map.of("type", "room_dissolved", "roomId", roomId));
                    registry.sendTo(u.username(), Map.of("type", "room_removed", "roomId", roomId));
                } catch (Exception ignored) {}
            });
        }
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true)));
    }

    private void handleRoomBlocksList(ChannelHandlerContext ctx, FullHttpRequest req, String path) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) return;
        String idStr = path.substring("/api/rooms/".length(), path.indexOf("/blocks"));
        long roomId = Long.parseLong(idStr);
        if (!isMember(roomId, me.id())) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("not_member"));
            return;
        }
        String myRole = roomDao.getMemberRole(roomId, me.id());
        if (!"owner".equalsIgnoreCase(myRole) && !"admin".equalsIgnoreCase(myRole)) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("forbidden_not_admin"));
            return;
        }
        List<RoomDao.BlockRow> blocks = roomDao.listBlocks(roomId);
        List<Map<String, Object>> list = blocks.stream().map(RoomDao.BlockRow::toMap).toList();
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true, "blocks", list)));
    }

    private void handleRoomBlockAdd(ChannelHandlerContext ctx, FullHttpRequest req, String path) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) return;
        String[] parts = path.split("/");
        long roomId = Long.parseLong(parts[3]);
        long targetUserId = Long.parseLong(parts[5]);
        if (!isMember(roomId, me.id())) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("not_member"));
            return;
        }
        String myRole = roomDao.getMemberRole(roomId, me.id());
        if (!"owner".equalsIgnoreCase(myRole) && !"admin".equalsIgnoreCase(myRole)) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("forbidden_not_admin"));
            return;
        }
        String targetRole = roomDao.getMemberRole(roomId, targetUserId);
        if ("owner".equalsIgnoreCase(targetRole)) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("forbidden_cannot_modify_owner"));
            return;
        }
        if ("admin".equalsIgnoreCase(myRole) && "admin".equalsIgnoreCase(targetRole)) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("forbidden_cannot_modify_admin"));
            return;
        }
        JsonNode b = Json.tree(body(req));
        String reason = nstr(b, "reason");
        roomDao.blockMember(roomId, targetUserId, me.id(), reason);
        dao.findById(targetUserId).ifPresent(u -> {
            try {
                String targetName = u.displayName() != null && !u.displayName().isBlank() ? u.displayName() : u.username();
                roomDao.insertSystemMessage(roomId, me.id(), me.displayName() + " đã chặn " + targetName + " khỏi nhóm");
                registry.sendTo(u.username(), Map.of("type", "room_removed", "roomId", roomId));
            } catch (Exception ignored) {}
        });
        broadcastRoomUpdate(roomId);
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true)));
    }

    private void handleRoomBlockRemove(ChannelHandlerContext ctx, FullHttpRequest req, String path) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) return;
        String[] parts = path.split("/");
        long roomId = Long.parseLong(parts[3]);
        long targetUserId = Long.parseLong(parts[5]);
        if (!isMember(roomId, me.id())) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("not_member"));
            return;
        }
        String myRole = roomDao.getMemberRole(roomId, me.id());
        if (!"owner".equalsIgnoreCase(myRole) && !"admin".equalsIgnoreCase(myRole)) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("forbidden_not_admin"));
            return;
        }
        roomDao.unblockMember(roomId, targetUserId);
        dao.findById(targetUserId).ifPresent(u -> {
            try {
                String targetName = u.displayName() != null && !u.displayName().isBlank() ? u.displayName() : u.username();
                roomDao.insertSystemMessage(roomId, me.id(), me.displayName() + " đã bỏ chặn " + targetName);
            } catch (Exception ignored) {}
        });
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true)));
    }

    private void handleJoinRequestsList(ChannelHandlerContext ctx, FullHttpRequest req, String path) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) return;
        String idStr = path.substring("/api/rooms/".length(), path.indexOf("/join-requests"));
        long roomId = Long.parseLong(idStr);
        if (!isMember(roomId, me.id())) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("not_member"));
            return;
        }
        String myRole = roomDao.getMemberRole(roomId, me.id());
        if (!"owner".equalsIgnoreCase(myRole) && !"admin".equalsIgnoreCase(myRole)) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("forbidden_not_admin"));
            return;
        }
        List<RoomDao.JoinRequestRow> reqs = roomDao.listPendingJoinRequests(roomId);
        List<Map<String, Object>> list = reqs.stream().map(RoomDao.JoinRequestRow::toMap).toList();
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true, "requests", list)));
    }

    private void handleJoinRequestDecision(ChannelHandlerContext ctx, FullHttpRequest req, String path) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) return;
        String[] parts = path.split("/");
        long roomId = Long.parseLong(parts[3]);
        long reqId = Long.parseLong(parts[5]);
        String action = parts[6];
        if (!isMember(roomId, me.id())) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("not_member"));
            return;
        }
        String myRole = roomDao.getMemberRole(roomId, me.id());
        if (!"owner".equalsIgnoreCase(myRole) && !"admin".equalsIgnoreCase(myRole)) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("forbidden_not_admin"));
            return;
        }
        Optional<RoomDao.JoinRequestRow> jrOpt = roomDao.findJoinRequest(reqId);
        if (jrOpt.isEmpty() || !"pending".equalsIgnoreCase(jrOpt.get().status())) {
            write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true, "already_decided", true,
                    "decided_by", jrOpt.map(r -> r.decidedBy() != null ? r.decidedBy() : 0).orElse(0L))));
            return;
        }
        RoomDao.JoinRequestRow jr = jrOpt.get();
        if ("approve".equalsIgnoreCase(action)) {
            if (roomDao.isUserBlocked(roomId, jr.userId())) {
                write(ctx, HttpResponseStatus.FORBIDDEN, err("forbidden_member_blocked"));
                return;
            }
            boolean resolved = roomDao.resolveJoinRequest(reqId, "approved", me.id());
            if (resolved) {
                roomDao.addOrRestoreMember(roomId, jr.userId(), "member");
                dao.findById(jr.userId()).ifPresent(u -> {
                    try {
                        String targetName = u.displayName() != null && !u.displayName().isBlank() ? u.displayName() : u.username();
                        roomDao.insertSystemMessage(roomId, me.id(), targetName + " đã tham gia nhóm (được duyệt bởi " + me.displayName() + ")");
                        Map<String, Object> toNew = new LinkedHashMap<>();
                        toNew.put("type", "room_added");
                        toNew.put("room", roomJson(jr.userId(), roomId));
                        registry.sendTo(u.username(), toNew);
                    } catch (Exception ignored) {}
                });
                broadcastRoomUpdate(roomId);
            }
            write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true, "status", "approved")));
        } else {
            roomDao.resolveJoinRequest(reqId, "rejected", me.id());
            broadcastRoomUpdate(roomId);
            write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true, "status", "rejected")));
        }
    }

    private void handleJoinRequestsApproveAll(ChannelHandlerContext ctx, FullHttpRequest req, String path) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) return;
        String idStr = path.substring("/api/rooms/".length(), path.indexOf("/join-requests/approve-all"));
        long roomId = Long.parseLong(idStr);
        if (!isMember(roomId, me.id())) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("not_member"));
            return;
        }
        String myRole = roomDao.getMemberRole(roomId, me.id());
        if (!"owner".equalsIgnoreCase(myRole) && !"admin".equalsIgnoreCase(myRole)) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("forbidden_not_admin"));
            return;
        }
        List<RoomDao.JoinRequestRow> reqs = roomDao.listPendingJoinRequests(roomId);
        int approvedCount = 0;
        for (RoomDao.JoinRequestRow jr : reqs) {
            if (roomDao.isUserBlocked(roomId, jr.userId())) continue;
            boolean resolved = roomDao.resolveJoinRequest(jr.id(), "approved", me.id());
            if (resolved) {
                approvedCount++;
                roomDao.addOrRestoreMember(roomId, jr.userId(), "member");
                dao.findById(jr.userId()).ifPresent(u -> {
                    try {
                        String targetName = u.displayName() != null && !u.displayName().isBlank() ? u.displayName() : u.username();
                        roomDao.insertSystemMessage(roomId, me.id(), targetName + " đã tham gia nhóm (được duyệt bởi " + me.displayName() + ")");
                        Map<String, Object> toNew = new LinkedHashMap<>();
                        toNew.put("type", "room_added");
                        toNew.put("room", roomJson(jr.userId(), roomId));
                        registry.sendTo(u.username(), toNew);
                    } catch (Exception ignored) {}
                });
            }
        }
        if (approvedCount > 0) {
            broadcastRoomUpdate(roomId);
        }
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true, "approved_count", approvedCount)));
    }

    private void broadcastJoinRequestCreated(long roomId, long reqId, long candidateId, Long invitedBy) {
        try {
            List<RoomDao.MemberRow> members = roomDao.members(roomId);
            for (RoomDao.MemberRow m : members) {
                if ("owner".equalsIgnoreCase(m.role()) || "admin".equalsIgnoreCase(m.role())) {
                    dao.findById(m.userId()).ifPresent(u -> {
                        try {
                            Map<String, Object> msg = new LinkedHashMap<>();
                            msg.put("type", "join_request_created");
                            msg.put("roomId", roomId);
                            msg.put("requestId", reqId);
                            msg.put("candidateId", candidateId);
                            msg.put("count", roomDao.countPendingJoinRequests(roomId));
                            registry.sendTo(u.username(), msg);
                        } catch (Exception ignored) {}
                    });
                }
            }
        } catch (Exception ignored) {}
    }

    private boolean isMember(long roomId, long userId) throws SQLException {
        return roomDao.members(roomId).stream().anyMatch(m -> m.userId() == userId);
    }

    private Map<String, Object> publicUserJson(SocialDao.PublicUser u, SocialDao.Relation rel) {
        return publicUserJson(u, rel, Optional.empty());
    }

    private Map<String, Object> publicUserJson(SocialDao.PublicUser u, SocialDao.Relation rel, Optional<Long> requestId) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", u.id());
        m.put("public_id", u.publicId());
        m.put("display_name", u.displayName() == null ? u.username() : u.displayName());
        m.put("avatar", u.avatar() == null ? "" : u.avatar());
        m.put("cover", u.cover() == null ? "" : u.cover());
        m.put("bio", u.bio() == null ? "" : u.bio());
        m.put("online", registry.isUserOnline(u.id(), u.username()));
        m.put("last_seen_at", u.lastSeenAtMs());
        m.put("relation", rel.name().toLowerCase(Locale.ROOT));
        requestId.ifPresent(id -> m.put("request_id", id));
        return m;
    }

    /** Hồ sơ công khai tối giản: chỉ tên, avatar, ngày tham gia, trạng thái online, quan hệ, requestId. */
    private Map<String, Object> profileUserJson(SocialDao.PublicUser u, SocialDao.Relation rel, Optional<Long> requestId,
                                                boolean online) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", u.id());
        m.put("public_id", u.publicId());
        m.put("display_name", u.displayName() == null ? u.username() : u.displayName());
        m.put("avatar", u.avatar() == null ? "" : u.avatar());
        m.put("cover", u.cover() == null ? "" : u.cover());
        m.put("bio", u.bio() == null ? "" : u.bio());
        m.put("created_at", u.createdAtMs());
        m.put("online", online);
        m.put("last_seen_at", u.lastSeenAtMs());
        m.put("relation", rel.name().toLowerCase(Locale.ROOT));
        requestId.ifPresent(id -> m.put("request_id", id));
        return m;
    }

    private void handleRooms(ChannelHandlerContext ctx, HttpMethod m, FullHttpRequest req) throws SQLException {
        if (m == HttpMethod.GET) {
            handleRoomList(ctx, req);
        } else if (m == HttpMethod.POST) {
            handleRoomCreate(ctx, req);
        } else {
            write(ctx, HttpResponseStatus.METHOD_NOT_ALLOWED, err("method_not_allowed"));
        }
    }

    private void handleRoomCreate(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) {
            return;
        }
        JsonNode b = Json.tree(body(req));
        JsonNode memberArr = b == null ? null : b.get("member_ids");
        if (memberArr == null || !memberArr.isArray() || memberArr.isEmpty()) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("missing_members"));
            return;
        }

        List<Long> memberIds = new ArrayList<>();
        for (JsonNode n : memberArr) {
            if (n.isNumber()) {
                long v = n.asLong();
                if (v > 0 && v != me.id()) {
                    memberIds.add(v);
                }
            }
        }
        if (memberIds.isEmpty()) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("missing_members"));
            return;
        }

        String name = nstr(b, "name");
        if (name != null) {
            name = name.trim();
            if (name.length() > 100) {
                name = name.substring(0, 100);
            }
            if (name.isEmpty()) {
                name = "Phòng mới";
            }
        }
        String avatar = nstr(b, "avatar");
        if (avatar != null) {
            avatar = avatar.trim();
            if (avatar.isEmpty() || "null".equals(avatar)) {
                avatar = null;
            }
        }
        if (avatar != null && (!avatar.startsWith(DATA_IMAGE_PREFIX) || avatar.length() > MAX_AVATAR_LEN)) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_avatar"));
            return;
        }

        java.util.Set<Long> existing = roomDao.existingUserIds(memberIds);
        if (existing.size() != memberIds.size()) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_member"));
            return;
        }
        // LUỒNG 2d/1f: chỉ được thêm NGƯỜI ĐÃ KẾT BẠN vào phòng (không tự do thêm người lạ).
        for (long uid : memberIds) {
            if (!socialDao.areFriends(me.id(), uid)) {
                write(ctx, HttpResponseStatus.FORBIDDEN, err("not_friend"));
                return;
            }
        }

        // Giới hạn thành viên mỗi phòng (gồm cả người tạo) — đọc từ cấu hình admin.
        int maxMembers = maxRoomMembers();
        if (memberIds.size() + 1 > maxMembers) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("too_many_members"));
            return;
        }

        // POST /api/rooms luôn là tạo phòng nhóm mới, kể cả chỉ có người tạo và một bạn.
        // Phòng chat riêng được tạo qua createOrGetDirectRoom ở luồng mở chat cá nhân.
        long roomId = roomDao.createGroupRoom(
                name == null ? "Phòng mới" : name, avatar, me.id(), memberIds, maxMembers);
        signaling.signalRoom(roomId);
        for (long uid : memberIds) {
            dao.findById(uid).ifPresent(memberUser -> {
                try {
                    Map<String, Object> toMember = new LinkedHashMap<>();
                    toMember.put("type", "room_added");
                    toMember.put("room", roomJson(uid, roomId));
                    registry.sendTo(memberUser.username(), toMember);
                } catch (Exception ignored) {
                }
            });
        }
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true, "room", roomJson(me, roomId))));
    }

    /**
     * POST /api/rooms/direct — mở/tạo phòng chat CÁ NHÂN (1-1) với một người bạn.
     * Tách biệt hoàn toàn khỏi phòng nhóm: dùng bảng rooms với is_direct = 1 (idempotent theo cặp).
     * Không gộp lịch sử/tin nhắn của phòng nhóm vào đây.
     */
    private void handleRoomDirect(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) {
            return;
        }
        JsonNode b = Json.tree(body(req));
        Long userId = longNode(b, "user_id");
        if (userId == null || userId < 1 || userId == me.id()) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_member"));
            return;
        }
        // Chỉ mở chat cá nhân với người đã kết bạn (khớp luồng danh bạ chỉ gồm bạn bè).
        if (!socialDao.areFriends(me.id(), userId)) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("not_friend"));
            return;
        }
        long roomId = roomDao.createOrGetDirectRoom(me.id(), userId);
        signaling.signalRoom(roomId);
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true, "room", roomJson(me, roomId))));
    }

    private void handlePeerRegister(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) {
            return;
        }
        JsonNode b = Json.tree(body(req));
        String ip = nstr(b, "ip");
        JsonNode portNode = b == null ? null : b.get("port");
        if (ip == null || ip.isBlank() || portNode == null || !portNode.isNumber()) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_peer"));
            return;
        }
        int port = portNode.asInt();
        if (port < 1 || port > 65535) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_peer"));
            return;
        }
        String pubKey = nstr(b, "pubkey");
        if (pubKey == null) {
            pubKey = "";
        }
        int udpPort = b != null && b.get("udpPort") != null && b.get("udpPort").isNumber() ? b.get("udpPort").asInt() : 0;
        if (udpPort < 0 || udpPort > 65535) {
            udpPort = 0;
        }
        String udpPublicIp = nstr(b, "udpPublicIp");
        int udpPublicPort = b != null && b.get("udpPublicPort") != null && b.get("udpPublicPort").isNumber()
                ? b.get("udpPublicPort").asInt() : 0;
        if (udpPublicPort < 0 || udpPublicPort > 65535) {
            udpPublicPort = 0;
        }
        String secret = registry.setPeer(me.id(), me.username(), ip.trim(), port, pubKey.trim(),
                udpPort, udpPublicIp, udpPublicPort);
        signaling.broadcastPresence(me.id(), me.username(), true);
        signaling.signalUserRooms(me.id());
        Map<String, Object> hb = new java.util.HashMap<>();
        hb.put("port", heartbeat != null ? heartbeat.port() : 0);
        hb.put("intervalMs", heartbeat != null ? heartbeat.intervalMs() : 3000L);
        hb.put("secret", secret);
        Map<String, Object> resp = new java.util.HashMap<>();
        resp.put("ok", true);
        resp.put("heartbeat", hb);
        write(ctx, HttpResponseStatus.OK, Json.write(resp));
    }

    /**
     * POST /api/peer/ticket — cấp vé một lần (60s) cho Peer Core của chính người dùng.
     * Trình duyệt (đã đăng nhập) gọi endpoint này kèm nonce do Peer Core sinh ra
     * (từ frame hello_res) rồi bàn giao vé qua WebSocket nội bộ.
     */
    private void handlePeerTicket(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) {
            return;
        }
        if (!rateAllow("peer_ticket:" + me.id(), 20, 60_000L)) {
            write(ctx, HttpResponseStatus.TOO_MANY_REQUESTS, err("rate_limited"));
            return;
        }
        JsonNode b = Json.tree(body(req));
        String nonce = nstr(b, "nonce");
        if (nonce == null || nonce.isBlank() || nonce.length() > 256) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_nonce"));
            return;
        }
        String ticket = peerTickets.issue(me.id(), nonce.trim());
        Map<String, Object> resp = new java.util.HashMap<>();
        resp.put("ticket", ticket);
        resp.put("expires_in", PeerTicketStore.TTL_MS / 1000);
        write(ctx, HttpResponseStatus.OK, Json.write(resp));
    }

    /**
     * POST /api/peer/exchange — Peer Core đổi vé một lần kèm nonce lấy chìa phiên.
     * Không cần auth: vé + nonce chính là bằng chứng. Vé bị tiêu ngay khi đổi
     * (remove nguyên tử). Trả về chìa phiên 256-bit (chỉ nằm trong RAM hai phía).
     */
    private void handlePeerExchange(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        if (!rateAllow("peer_exchange:" + remoteIp(ctx), 30, 60_000L)) {
            write(ctx, HttpResponseStatus.TOO_MANY_REQUESTS, err("rate_limited"));
            return;
        }
        JsonNode b = Json.tree(body(req));
        String ticket = nstr(b, "ticket");
        String nonce = nstr(b, "nonce");
        PeerTicketStore.ExchangeResult r = peerTickets.exchange(ticket, nonce);
        if (r == null) {
            write(ctx, HttpResponseStatus.UNAUTHORIZED, err("invalid_ticket"));
            return;
        }
        Optional<User> opt = dao.findById(r.userId());
        if (opt.isEmpty()) {
            write(ctx, HttpResponseStatus.UNAUTHORIZED, err("invalid_ticket"));
            return;
        }
        User me = opt.get();
        PeerSessionStore.PeerSession session = peerSessions.issue(me.id());
        String publicId = socialDao.ensurePublicId(me.id());
        Map<String, Object> user = new java.util.HashMap<>();
        user.put("id", me.id());
        user.put("username", me.username());
        user.put("public_id", publicId == null ? "" : publicId);
        Map<String, Object> resp = new java.util.HashMap<>();
        resp.put("ok", true);
        resp.put("token", session.key());
        resp.put("expires_at", session.expiresAtEpochSeconds());
        resp.put("user", user);
        write(ctx, HttpResponseStatus.OK, Json.write(resp));
    }

    /** GET /api/peer/heartbeat/state — số liệu hàng đợi UDP + peer trực tuyến (chẩn đoán). */
    private void handleHeartbeatState(ChannelHandlerContext ctx) {
        Map<String, Object> out = heartbeat != null ? heartbeat.stats() : Map.of("enabled", false);
        write(ctx, HttpResponseStatus.OK, Json.write(out));
    }

    // ---------- Nhắn tin ngoại tuyến E2E: đăng ký khóa công khai ----------

    /** POST /api/keys — đăng ký/ghi đè public key RSA của chính mình (body: base64 DER X.509). */
    private void handleKeyRegister(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) {
            return;
        }
        if (!rateAllow("keys:" + me.id(), 10, 60_000L)) {
            write(ctx, HttpResponseStatus.TOO_MANY_REQUESTS, err("rate_limited"));
            return;
        }
        JsonNode b = Json.tree(body(req));
        String pkB64 = nstr(b, "public_key");
        if (pkB64 == null || pkB64.isBlank() || pkB64.length() > 4096) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_public_key"));
            return;
        }
        byte[] der;
        PublicKey pk;
        try {
            der = CryptoBox.unb64(pkB64);
            pk = CryptoBox.publicKeyFromDer(der);
        } catch (Exception e) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_public_key"));
            return;
        }
        String fingerprint = CryptoBox.fingerprintSha256(pk);
        boolean changed = keyDao.upsertPublicKey(me.id(), der, fingerprint);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("fingerprint", fingerprint);
        out.put("changed", changed);
        out.put("algo", E2E_ALGO);
        write(ctx, HttpResponseStatus.OK, Json.write(out));
    }

    /** GET /api/users/{id}/pubkey — lấy public key RSA để bọc phong bì cho người nhận. */
    private void handleUserPubkey(ChannelHandlerContext ctx, FullHttpRequest req, String path) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) {
            return;
        }
        long userId;
        try {
            userId = Long.parseLong(path.substring("/api/users/".length(), path.indexOf("/pubkey")));
        } catch (NumberFormatException e) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_user"));
            return;
        }
        Optional<KeyDao.UserKey> k = keyDao.findPublicKey(userId);
        if (k.isEmpty()) {
            write(ctx, HttpResponseStatus.NOT_FOUND, err("key_not_found"));
            return;
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("user_id", userId);
        out.put("public_key", CryptoBox.b64(k.get().der()));
        out.put("fingerprint", k.get().fingerprint());
        out.put("algo", E2E_ALGO);
        write(ctx, HttpResponseStatus.OK, Json.write(out));
    }

    // ---------- Nhắn tin ngoại tuyến E2E: hộp thư store-and-forward ----------

    /** POST /api/offline/store — lưu phong bì đã mã hóa cho các thành viên phòng. */
    /**
     * POST /api/events/light — Peer Core đẩy sự kiện nhẹ (typing/seen) khi kênh WS của nó đứt
     * nhưng HTTP còn. Tracker định tuyến theo phòng tới các thành viên đang online (phiên WS),
     * KHÔNG cần PeerLink. Chỉ nhận typing/seen + trường phi nội dung để bảo toàn E2E.
     */
    private void handleLightEvent(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) {
            return;
        }
        if (!rateAllow("light:" + me.id(), 120, 60_000L)) {
            write(ctx, HttpResponseStatus.TOO_MANY_REQUESTS, err("rate_limited"));
            return;
        }
        JsonNode b;
        try {
            b = Json.tree(body(req));
        } catch (Exception e) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("bad_json"));
            return;
        }
        Long roomId = longNode(b, "room_id");
        if (roomId == null || roomId < 1) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("bad_room"));
            return;
        }
        JsonNode ev = b.get("event");
        if (ev == null || !ev.isObject()) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("bad_event"));
            return;
        }
        String type = nstr(ev, "type");
        if (!"typing".equals(type) && !"seen".equals(type)) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_type"));
            return;
        }
        if (!isMember(roomId, me.id())) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("not_member"));
            return;
        }
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("type", type);
        String mid = nstr(ev, "messageId");
        if (mid != null) {
            event.put("messageId", mid);
        }
        Long ts = longNode(ev, "ts");
        if (ts != null) {
            event.put("ts", ts);
        }
        int delivered = signaling.routeLightEvent(roomId, me.id(), me.username(), event);
        if (delivered < 0) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("not_member"));
            return;
        }
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("delivered", delivered)));
    }

    private void handleOfflineStore(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) {
            return;
        }
        if (!rateAllow("offstore:" + me.id(), 60, 60_000L)) {
            write(ctx, HttpResponseStatus.TOO_MANY_REQUESTS, err("rate_limited"));
            return;
        }
        JsonNode b;
        try {
            b = Json.tree(body(req));
        } catch (Exception e) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("bad_json"));
            return;
        }
        Long roomId = longNode(b, "room_id");
        if (roomId == null || roomId < 1) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("bad_room"));
            return;
        }
        if (!isMember(roomId, me.id())) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("not_member"));
            return;
        }
        RoomDao.RoomSettings settings = roomDao.getRoomSettings(roomId);
        if (!settings.allowMemberSend()) {
            String role = roomDao.getMemberRole(roomId, me.id());
            if ("member".equalsIgnoreCase(role)) {
                write(ctx, HttpResponseStatus.FORBIDDEN, err("forbidden_member_send"));
                return;
            }
        }
        String clientMsgId = nstr(b, "client_msg_id");
        if (clientMsgId == null || clientMsgId.length() < 8 || clientMsgId.length() > 64
                || !clientMsgId.matches("^[0-9A-Za-z_:-]+$")) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_client_msg_id"));
            return;
        }
        String type = nstr(b, "type");
        if (type == null || type.isBlank()) {
            type = "text";
        }
        if (!OFFLINE_TYPES.contains(type)) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_type"));
            return;
        }
        String contentType = nstr(b, "content_type");
        if (contentType == null || contentType.isBlank()) {
            contentType = "text";
        }
        if (!OFFLINE_CONTENT_TYPES.contains(contentType)) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_content_type"));
            return;
        }
        String replyTo = nstr(b, "reply_to_client_id");
        if (replyTo != null && roomDao.messageByClientId(roomId, replyTo).isEmpty()) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("bad_reply"));
            return;
        }
        Long sentAt = longNode(b, "sent_at");
        if (sentAt != null && sentAt <= 0) {
            sentAt = null;
        }
        JsonNode envs = b.get("envelopes");
        if (envs == null || !envs.isArray() || envs.isEmpty()) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("empty_envelopes"));
            return;
        }
        Set<Long> memberIds = new LinkedHashSet<>();
        for (RoomDao.MemberRow r : roomDao.members(roomId)) {
            memberIds.add(r.userId());
        }
        List<OfflineDao.StoreEnvelope> list = new ArrayList<>();
        Set<Long> seenRecipients = new LinkedHashSet<>();
        for (JsonNode e : envs) {
            Long rid = e == null ? null : longNode(e, "recipient_id");
            if (rid == null || rid == me.id() || !memberIds.contains(rid) || !seenRecipients.add(rid)) {
                write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_recipient"));
                return;
            }
            String algo = nstr(e, "algo");
            if (algo == null || algo.isBlank() || algo.length() > 32) {
                algo = E2E_ALGO;
            }
            byte[] iv;
            byte[] wrapped;
            byte[] sig;
            byte[] ct;
            try {
                iv = CryptoBox.unb64(requireEnv(e, "iv"));
                wrapped = CryptoBox.unb64(requireEnv(e, "wrapped_key"));
                sig = CryptoBox.unb64(requireEnv(e, "signature"));
                ct = CryptoBox.unb64(requireEnv(e, "ciphertext"));
            } catch (Exception ex) {
                write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_envelope"));
                return;
            }
            if (iv.length < 8 || iv.length > 16 || wrapped.length > 1024 || sig.length > 1024) {
                write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_envelope"));
                return;
            }
            if (ct.length < 1 || ct.length > offlineConfig.maxTextBytes()) {
                write(ctx, HttpResponseStatus.BAD_REQUEST, err("ciphertext_too_long"));
                return;
            }
            list.add(new OfflineDao.StoreEnvelope(rid, algo, iv, wrapped, sig, ct));
        }
        for (OfflineDao.StoreEnvelope e : list) {
            if (offlineDao.countPending(e.recipientId()) >= offlineConfig.mailboxLimit()) {
                write(ctx, HttpResponseStatus.TOO_MANY_REQUESTS, err("mailbox_full"));
                return;
            }
        }
        Optional<Long> ownerRoom = roomDao.roomOfClientId(clientMsgId);
        // So sánh theo GIÁ TRỊ: roomId là Long (boxed) nên "!=" sẽ so tham chiếu và luôn
        // báo trùng với mọi client_msg_id đã tồn tại (room > 127). Dùng longValue().
        if (ownerRoom.isPresent() && ownerRoom.get().longValue() != roomId.longValue()) {
            write(ctx, HttpResponseStatus.CONFLICT, err("client_msg_id_conflict"));
            return;
        }
        boolean duplicate = ownerRoom.isPresent();
        roomDao.ensureMessageMeta(roomId, me.id(), clientMsgId, type, replyTo, null, sentAt);
        int stored = offlineDao.store(roomId, me.id(), clientMsgId, contentType, sentAt,
                offlineConfig.ttlDays(), list);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("stored", stored);
        out.put("duplicate", duplicate);
        write(ctx, HttpResponseStatus.OK, Json.write(out));
    }

    private static String requireEnv(JsonNode e, String field) {
        JsonNode v = e.get(field);
        return v == null || v.isNull() ? null : v.asText();
    }

    /** POST /api/offline/pull — kéo phong bì chưa giao cho chính mình (cursor = id tăng dần). */
    private void handleOfflinePull(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) {
            return;
        }
        if (!rateAllow("offpull:" + me.id(), 120, 60_000L)) {
            write(ctx, HttpResponseStatus.TOO_MANY_REQUESTS, err("rate_limited"));
            return;
        }
        JsonNode b;
        try {
            b = Json.tree(body(req));
        } catch (Exception e) {
            b = null;
        }
        long after = 0;
        if (b != null) {
            Long a = longNode(b, "after");
            if (a != null && a > 0) {
                after = a;
            }
        }
        int limit = offlineConfig.pullLimit();
        List<OfflineDao.EnvelopeRow> rows = offlineDao.pull(me.id(), after, limit);
        List<Map<String, Object>> items = new ArrayList<>();
        for (OfflineDao.EnvelopeRow r : rows) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", r.id());
            m.put("client_msg_id", r.clientMsgId());
            m.put("room_id", r.roomId());
            m.put("sender_id", r.senderId());
            m.put("content_type", r.contentType());
            m.put("algo", r.algo());
            m.put("iv", CryptoBox.b64(r.iv()));
            m.put("wrapped_key", CryptoBox.b64(r.wrappedKey()));
            m.put("signature", CryptoBox.b64(r.signature()));
            m.put("ciphertext", CryptoBox.b64(r.ciphertext()));
            m.put("sent_at", r.sentAtMs());
            items.add(m);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("messages", items);
        out.put("has_more", rows.size() == limit);
        // mailbox_hint: số phong bì còn lại trong hộp thư sau lần kéo này (gợi ý còn phải kéo tiếp).
        out.put("mailbox_hint", offlineDao.countPending(me.id()));
        write(ctx, HttpResponseStatus.OK, Json.write(out));
    }

    /** POST /api/offline/ack — xác nhận đã nhận: xóa phong bì khỏi hộp thư server. */
    private void handleOfflineAck(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) {
            return;
        }
        JsonNode b;
        try {
            b = Json.tree(body(req));
        } catch (Exception e) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("bad_json"));
            return;
        }
        JsonNode idsNode = b.get("ids");
        if (idsNode == null || !idsNode.isArray()) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_ids"));
            return;
        }
        List<Long> ids = new ArrayList<>();
        for (JsonNode n : idsNode) {
            if (n.isNumber() && n.asLong() > 0) {
                ids.add(n.asLong());
            }
            if (ids.size() > MAX_PULL_IDS) {
                break;
            }
        }
        int deleted = offlineDao.ack(me.id(), ids);
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true, "deleted", deleted)));
    }

    private void handleRoomList(ChannelHandlerContext ctx, FullHttpRequest req) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) {
            return;
        }
        List<Map<String, Object>> rooms = new ArrayList<>();
        List<RoomDao.RoomRow> mine = roomDao.roomsOf(me.id());
        Map<RoomDao.RoomRow, Long> lastMs = new java.util.HashMap<>();
        for (RoomDao.RoomRow r : mine) {
            lastMs.put(r, roomDao.lastMessageAtMs(r.id()).orElse(r.createdAtMs()));
        }
        java.util.Comparator<Map.Entry<RoomDao.RoomRow, Long>> desc =
                java.util.Map.Entry.<RoomDao.RoomRow, Long>comparingByValue().reversed();
        java.util.List<Map.Entry<RoomDao.RoomRow, Long>> sorted = new ArrayList<>(lastMs.entrySet());
        sorted.sort(desc);
        for (Map.Entry<RoomDao.RoomRow, Long> e : sorted) {
            rooms.add(roomJson(me, e.getKey().id()));
        }
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("rooms", rooms)));
    }

    private void handleRoomDetail(ChannelHandlerContext ctx, FullHttpRequest req, String path) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) {
            return;
        }
        String idStr = path.substring("/api/rooms/".length());
        long roomId;
        try {
            roomId = Long.parseLong(idStr);
        } catch (NumberFormatException e) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("bad_room"));
            return;
        }
        Optional<RoomDao.RoomRow> row = roomDao.findRoom(roomId);
        if (row.isEmpty()) {
            write(ctx, HttpResponseStatus.NOT_FOUND, err("room_not_found"));
            return;
        }
        boolean isMember = roomDao.members(roomId).stream().anyMatch(m -> m.userId() == me.id());
        if (!isMember) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("not_member"));
            return;
        }
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("room", roomJson(me, row.get().id()))));
    }

    private Map<String, Object> roomJson(User me, long roomId) throws SQLException {
        return roomJson(me.id(), roomId);
    }

    private Map<String, Object> roomJson(long viewerId, long roomId) throws SQLException {
        RoomDao.RoomRow r = roomDao.findRoom(roomId).orElseThrow();
        List<RoomDao.MemberRow> members = roomDao.members(roomId);
        long lastMs = roomDao.lastMessageAtMs(roomId).orElse(r.createdAtMs());

        String name = r.name();
        String avatar = r.avatarUrl();
        if (r.isDirect()) {
            RoomDao.MemberRow other = members.stream().filter(m -> m.userId() != viewerId).findFirst().orElse(null);
            if (other != null) {
                if (name == null || name.isEmpty()) {
                    name = other.displayName();
                }
                if (avatar == null || avatar.isEmpty()) {
                    avatar = other.avatarUrl();
                }
            }
        }

        List<Map<String, Object>> memberJson = new ArrayList<>();
        for (RoomDao.MemberRow m : members) {
            Map<String, Object> mm = new LinkedHashMap<>();
            mm.put("id", m.userId());
            mm.put("public_id", m.publicId());
            mm.put("username", m.username());
            mm.put("display_name", m.displayName());
            mm.put("avatar", m.avatarUrl() == null ? "" : m.avatarUrl());
            mm.put("role", m.role());
            mm.put("online", registry.isUserOnline(m.userId(), m.username()));
            mm.put("last_seen_at", m.lastSeenAtMs());
            mm.put("last_read_message_id", m.lastReadMessageId() == null ? "" : m.lastReadMessageId());
            memberJson.add(mm);
        }

        Map<String, Object> room = new LinkedHashMap<>();
        room.put("id", r.id());
        room.put("is_direct", r.isDirect());
        room.put("name", name == null ? "" : name);
        room.put("avatar", avatar == null ? "" : avatar);
        room.put("background", r.backgroundUrl() == null ? "" : r.backgroundUrl());
        room.put("theme_color", r.themeColor() == null ? "" : r.themeColor());
        room.put("default_reaction_emoji", r.defaultReactionEmoji() == null ? "👍" : r.defaultReactionEmoji());
        room.put("created_at", r.createdAtMs());
        room.put("created_by", r.createdBy());
        room.put("last_at", lastMs);
        room.put("members", memberJson);
        RoomDao.RoomSettings settings = roomDao.getRoomSettings(roomId);
        room.put("settings", settings.toMap());
        boolean isPrivileged = members.stream()
                .anyMatch(m -> m.userId() == viewerId && ("owner".equalsIgnoreCase(m.role()) || "admin".equalsIgnoreCase(m.role())));
        if (isPrivileged) {
            room.put("pending_join_requests_count", roomDao.countPendingJoinRequests(roomId));
        } else {
            room.put("pending_join_requests_count", 0);
        }
        return room;
    }

    private record RoomCtx(User me, long roomId) {
    }

    /** Token hợp lệ + phòng tồn tại + mình là thành viên. Trả null nếu đã ghi response lỗi. */
    private RoomCtx requireRoomMember(ChannelHandlerContext ctx, FullHttpRequest req, String path) throws SQLException {
        long roomId;
        try {
            String rest = path.substring("/api/rooms/".length());
            int slash = rest.indexOf('/');
            roomId = Long.parseLong(slash < 0 ? rest : rest.substring(0, slash));
        } catch (NumberFormatException e) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("bad_room"));
            return null;
        }
        return requireRoomMemberId(ctx, req, roomId);
    }

    private RoomCtx requireRoomMemberId(ChannelHandlerContext ctx, FullHttpRequest req, long roomId) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) {
            return null;
        }
        if (roomDao.findRoom(roomId).isEmpty()) {
            write(ctx, HttpResponseStatus.NOT_FOUND, err("room_not_found"));
            return null;
        }
        if (roomDao.members(roomId).stream().noneMatch(m -> m.userId() == me.id())) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("not_member"));
            return null;
        }
        return new RoomCtx(me, roomId);
    }

    /** POST /api/rooms/{id}/messages — lưu tin nhắn. Idempotent theo client_msg_id. */
    private void handleMessageSend(ChannelHandlerContext ctx, FullHttpRequest req, String path) throws SQLException {
        RoomCtx rc = requireRoomMember(ctx, req, path);
        if (rc == null) {
            return;
        }
        RoomDao.RoomSettings settings = roomDao.getRoomSettings(rc.roomId());
        if (!settings.allowMemberSend()) {
            String role = roomDao.getMemberRole(rc.roomId(), rc.me().id());
            if ("member".equalsIgnoreCase(role)) {
                write(ctx, HttpResponseStatus.FORBIDDEN, err("forbidden_member_send"));
                return;
            }
        }
        if (!rateAllow("msg:" + rc.me().id(), 60, 60_000L)) {
            write(ctx, HttpResponseStatus.TOO_MANY_REQUESTS, err("rate_limited"));
            return;
        }
        JsonNode b;
        try {
            b = Json.tree(body(req));
        } catch (Exception e) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("bad_json"));
            return;
        }
        String clientMsgId = nstr(b, "client_msg_id");
        String text = nstr(b, "text");
        String replyTo = nstr(b, "reply_to_client_id");
        String type = nstr(b, "type");

        if (clientMsgId == null || clientMsgId.length() < 8 || clientMsgId.length() > 64
                || !clientMsgId.matches("^[0-9A-Za-z_:-]+$")) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_client_msg_id"));
            return;
        }
        // B0: cưỡng chế E2E phía server — KHÔNG nhận nội dung văn bản nào. Nội dung
        // thật nằm trong phong bì gửi qua /api/offline/store; bảng message_meta chỉ
        // lưu metadata (content luôn NULL). Mọi client gửi text đều bị từ chối.
        if (text != null && !text.isBlank()) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("plaintext_not_allowed"));
            return;
        }
        text = null;
        if (type == null || type.isBlank()) {
            type = "text";
        }
        if (!type.matches("text|image|video|file|voice")) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_type"));
            return;
        }
        if (replyTo != null && roomDao.messageByClientId(rc.roomId(), replyTo).isEmpty()) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("bad_reply"));
            return;
        }

        // Idempotent: khoá đã tồn tại trong PHÒNG NÀY → trả bản hiện tại, nhưng
        // vẫn đi qua INSERT..ON DUPLICATE KEY để nội dung được cập nhật nếu client
        // gửi lại sau retry (và không bao giờ tạo dòng trùng). Dùng khoá của phòng
        // khác là lỗi client (unique toàn cục) → 409.
        Optional<Long> ownerRoom = roomDao.roomOfClientId(clientMsgId);
        if (ownerRoom.isPresent() && ownerRoom.get() != rc.roomId()) {
            write(ctx, HttpResponseStatus.CONFLICT, err("client_msg_id_conflict"));
            return;
        }
        boolean duplicate = ownerRoom.isPresent();
        RoomDao.MessageRow saved = roomDao.insertMessage(rc.roomId(), rc.me().id(), clientMsgId, type, replyTo, text, null);
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("message", messageJson(saved), "duplicate", duplicate)));
    }

    /** GET /api/rooms/{id}/messages?before=&limit= — lịch sử phân trang lùi, trả tăng dần theo thời gian. */
    private void handleMessageList(ChannelHandlerContext ctx, FullHttpRequest req, String path, String query) throws SQLException {
        RoomCtx rc = requireRoomMember(ctx, req, path);
        if (rc == null) {
            return;
        }
        Long before = null;
        String beforeRaw = param(query, "before", "");
        if (!beforeRaw.isBlank()) {
            try {
                before = Long.parseLong(beforeRaw);
            } catch (NumberFormatException e) {
                write(ctx, HttpResponseStatus.BAD_REQUEST, err("bad_cursor"));
                return;
            }
        }
        int limit = 50;
        String limitRaw = param(query, "limit", "");
        if (!limitRaw.isBlank()) {
            try {
                limit = Integer.parseInt(limitRaw);
            } catch (NumberFormatException e) {
                write(ctx, HttpResponseStatus.BAD_REQUEST, err("bad_limit"));
                return;
            }
        }
        limit = Math.max(1, Math.min(200, limit));

        List<RoomDao.MessageRow> rows = roomDao.messagesBefore(rc.roomId(), rc.me().id(), before, limit);
        Map<String, List<Map<String, Object>>> reactions = reactionsByMsg(rows, rc.me().id());
        List<Map<String, Object>> items = new ArrayList<>();
        List<RoomDao.ReaderRow> readers = rows.isEmpty() ? List.of() : roomDao.readersOf(rc.roomId());
        Map<String, Long> rowIds = rows.isEmpty() ? Map.of() : roomDao.rowIdsByClientId(rc.roomId(), idsOf(rows));
        for (RoomDao.MessageRow m : rows) {
            items.add(messageJson(m, reactions.get(m.clientMsgId()), seenByOf(readers, rowIds, m)));
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("messages", items);
        out.put("has_more", rows.size() == limit);
        write(ctx, HttpResponseStatus.OK, Json.write(out));
    }

    /** Gom reaction theo client_msg_id với cờ mine tính cho viewerId. */
    private static List<String> idsOf(List<RoomDao.MessageRow> rows) {
        List<String> ids = new ArrayList<>(rows.size());
        for (RoomDao.MessageRow m : rows) {
            ids.add(m.clientMsgId());
        }
        return ids;
    }

    private Map<String, List<Map<String, Object>>> reactionsByMsg(List<RoomDao.MessageRow> rows, long viewerId) throws SQLException {
        Map<String, List<Map<String, Object>>> out = new LinkedHashMap<>();
        if (rows.isEmpty()) {
            return out;
        }
        List<String> ids = new ArrayList<>();
        for (RoomDao.MessageRow m : rows) {
            ids.add(m.clientMsgId());
            out.put(m.clientMsgId(), new ArrayList<>());
        }
        for (RoomDao.ReactionRow r : roomDao.reactionsFor(ids)) {
            out.computeIfAbsent(r.clientMsgId(), k -> new ArrayList<>()).add(reactionJson(r, viewerId));
        }
        return out;
    }

    private List<Map<String, Object>> reactionsOf(long roomId, String clientMsgId, long viewerId) throws SQLException {
        List<Map<String, Object>> out = new ArrayList<>();
        for (RoomDao.ReactionRow r : roomDao.reactionsFor(List.of(clientMsgId))) {
            out.add(reactionJson(r, viewerId));
        }
        return out;
    }

    private static Map<String, Object> reactionJson(RoomDao.ReactionRow r, long viewerId) {
        String name = r.name() == null ? r.username() : r.name();
        Map<String, Object> j = new LinkedHashMap<>();
        j.put("user_id", r.userId());
        j.put("emoji", r.emoji());
        j.put("name", name);
        j.put("username", r.username() == null ? "" : r.username());
        j.put("initials", initialsOf(name));
        j.put("mine", r.userId() == viewerId);
        return j;
    }

    private static String initialsOf(String name) {
        if (name == null || name.isBlank()) {
            return "??";
        }
        String[] parts = name.trim().split("\\s+");
        StringBuilder sb = new StringBuilder();
        if (parts.length > 0 && !parts[0].isEmpty()) {
            sb.append(Character.toUpperCase(parts[0].charAt(0)));
        }
        if (parts.length > 1 && !parts[1].isEmpty()) {
            sb.append(Character.toUpperCase(parts[1].charAt(0)));
        }
        String res = sb.toString();
        return res.isEmpty() ? "??" : res;
    }

    private static Map<String, Object> messageJson(RoomDao.MessageRow m) {
        return messageJson(m, List.of(), List.of());
    }

    private static Map<String, Object> messageJson(RoomDao.MessageRow m, List<Map<String, Object>> reactions) {
        return messageJson(m, reactions, List.of());
    }

    private static Map<String, Object> messageJson(RoomDao.MessageRow m, List<Map<String, Object>> reactions, List<Map<String, Object>> seenBy) {
        Map<String, Object> j = new LinkedHashMap<>();
        j.put("id", m.id());
        j.put("client_msg_id", m.clientMsgId());
        j.put("room_id", m.roomId());
        j.put("sender_id", m.senderId());
        j.put("sender_username", m.senderUsername() == null ? "" : m.senderUsername());
        j.put("sender_name", m.senderName() == null ? "" : m.senderName());
        j.put("sender_avatar", m.senderAvatar() == null ? "" : m.senderAvatar());
        j.put("type", m.type());
        j.put("content", m.content() == null ? "" : m.content());
        j.put("reply_to_client_id", m.replyToClientId() == null ? "" : m.replyToClientId());
        j.put("forwarded_from_client_id", m.forwardedFromClientId() == null ? "" : m.forwardedFromClientId());
        j.put("is_edited", m.isEdited());
        j.put("is_recalled_all", m.isRecalledAll());
        j.put("sent_at", m.sentAtMs());
        j.put("edited_at", m.editedAtMs());
        j.put("reactions", reactions == null ? List.of() : reactions);
        j.put("seen_by", seenBy == null ? List.of() : seenBy);
        return j;
    }

    /** Danh sách member đã đọc tới (hoặc qua) tin m — loại trừ người gửi. */
    private List<Map<String, Object>> seenByOf(List<RoomDao.ReaderRow> readers, Map<String, Long> rowIds, RoomDao.MessageRow m) {
        List<Map<String, Object>> out = new ArrayList<>();
        Long myRow = rowIds.get(m.clientMsgId());
        if (myRow == null) {
            return out;
        }
        for (RoomDao.ReaderRow r : readers) {
            Long rRow = rowIds.get(r.lastReadClientId());
            if (rRow == null || r.userId() == m.senderId()) {
                continue;
            }
            if (rRow >= myRow) {
                String name = r.name() == null ? r.username() : r.name();
                Map<String, Object> j = new LinkedHashMap<>();
                j.put("user_id", r.userId());
                j.put("name", name);
                j.put("username", r.username() == null ? "" : r.username());
                j.put("initials", initialsOf(name));
                out.add(j);
            }
        }
        return out;
    }

    /** POST/DELETE /api/rooms/{id}/messages/{cid}/(edit|recall|reaction) — thu hồi/sửa/reaction. */
    private void handleMessageAction(ChannelHandlerContext ctx, HttpMethod m, FullHttpRequest req, String path) throws SQLException {
        String[] p = path.split("/");
        long roomId;
        try {
            roomId = Long.parseLong(p[3]);
        } catch (NumberFormatException e) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("bad_room"));
            return;
        }
        String cid;
        try {
            cid = java.net.URLDecoder.decode(p[5], java.nio.charset.StandardCharsets.UTF_8);
        } catch (Exception e) {
            cid = p[5];
        }
        String action = p[6];
        RoomCtx rc = requireRoomMemberId(ctx, req, roomId);
        if (rc == null) {
            return;
        }
        if (!rateAllow("msgact:" + rc.me().id(), 120, 60_000L)) {
            write(ctx, HttpResponseStatus.TOO_MANY_REQUESTS, err("rate_limited"));
            return;
        }
        Optional<RoomDao.MessageRow> found = roomDao.messageByClientId(roomId, cid);
        if (found.isEmpty()) {
            if ("recall".equals(action)) {
                roomDao.ensureMessageMeta(roomId, rc.me().id(), cid, "file", null, null, null);
                found = roomDao.messageByClientId(roomId, cid);
            } else if ("reaction".equals(action)) {
                roomDao.ensureMessageMeta(roomId, rc.me().id(), cid, "text", null, null, null);
                found = roomDao.messageByClientId(roomId, cid);
            } else {
                write(ctx, HttpResponseStatus.NOT_FOUND, err("message_not_found"));
                return;
            }
        }
        if (found.isEmpty()) {
            write(ctx, HttpResponseStatus.NOT_FOUND, err("message_not_found"));
            return;
        }
        RoomDao.MessageRow msg = found.get();

        switch (action) {
            case "edit": {
                // B2: sửa tin theo E2E. Server CHỈ giữ metadata (is_edited + edited_at);
                // nội dung mới do Peer Core gửi qua mesh (đã mã hoá) và cập nhật lịch sử
                // cục bộ. Không nhận plaintext từ client.
                if (m != HttpMethod.POST) {
                    write(ctx, HttpResponseStatus.METHOD_NOT_ALLOWED, err("method_not_allowed"));
                    return;
                }
                if (msg.senderId() != rc.me().id()) {
                    write(ctx, HttpResponseStatus.FORBIDDEN, err("not_sender"));
                    return;
                }
                if (msg.isRecalledAll()) {
                    write(ctx, HttpResponseStatus.BAD_REQUEST, err("recalled"));
                    return;
                }
                roomDao.markEdited(roomId, cid);
                RoomDao.MessageRow updated = roomDao.messageByClientId(roomId, cid).orElse(msg);
                write(ctx, HttpResponseStatus.OK, Json.write(Map.of(
                        "message", messageJson(updated, reactionsOf(roomId, cid, rc.me().id())))));
                return;
            }
            case "recall": {
                if (m != HttpMethod.POST) {
                    write(ctx, HttpResponseStatus.METHOD_NOT_ALLOWED, err("method_not_allowed"));
                    return;
                }
                if (msg.senderId() != rc.me().id()) {
                    write(ctx, HttpResponseStatus.FORBIDDEN, err("not_sender"));
                    return;
                }
                roomDao.recallMessage(roomId, cid);
                roomDao.clearReactions(cid);
                offlineDao.deleteByClientMsgId(cid);
                String senderName = rc.me().displayName() != null && !rc.me().displayName().isBlank() ? rc.me().displayName() : rc.me().username();
                Map<String, Object> recallEvt = new LinkedHashMap<>();
                recallEvt.put("type", "recall");
                recallEvt.put("clientId", cid);
                try {
                    signaling.routeLightEvent(roomId, rc.me().id(), senderName, recallEvt);
                } catch (Exception ignored) {}
                RoomDao.MessageRow updated = roomDao.messageByClientId(roomId, cid).orElse(msg);
                write(ctx, HttpResponseStatus.OK, Json.write(Map.of("message", messageJson(updated, reactionsOf(roomId, cid, rc.me().id())))));
                return;
            }
            case "reaction": {
                if (m == HttpMethod.POST) {
                    if (msg.isRecalledAll()) {
                        write(ctx, HttpResponseStatus.BAD_REQUEST, err("recalled"));
                        return;
                    }
                    JsonNode b = Json.tree(body(req));
                    String emoji = nstr(b, "emoji");
                    if (emoji == null || emoji.isBlank() || emoji.length() > 10) {
                        write(ctx, HttpResponseStatus.BAD_REQUEST, err("bad_emoji"));
                        return;
                    }
                    roomDao.upsertReaction(cid, rc.me().id(), emoji);
                    String senderName = rc.me().displayName() != null && !rc.me().displayName().isBlank() ? rc.me().displayName() : rc.me().username();
                    Map<String, Object> reactEvt = new LinkedHashMap<>();
                    reactEvt.put("type", "reaction");
                    reactEvt.put("clientId", cid);
                    reactEvt.put("emoji", emoji);
                    reactEvt.put("remove", false);
                    try {
                        signaling.routeLightEvent(roomId, rc.me().id(), senderName, reactEvt);
                    } catch (Exception ignored) {}
                } else if (m == HttpMethod.DELETE) {
                    roomDao.removeReaction(cid, rc.me().id());
                    String senderName = rc.me().displayName() != null && !rc.me().displayName().isBlank() ? rc.me().displayName() : rc.me().username();
                    Map<String, Object> reactEvt = new LinkedHashMap<>();
                    reactEvt.put("type", "reaction");
                    reactEvt.put("clientId", cid);
                    reactEvt.put("emoji", "");
                    reactEvt.put("remove", true);
                    try {
                        signaling.routeLightEvent(roomId, rc.me().id(), senderName, reactEvt);
                    } catch (Exception ignored) {}
                } else {
                    write(ctx, HttpResponseStatus.METHOD_NOT_ALLOWED, err("method_not_allowed"));
                    return;
                }
                write(ctx, HttpResponseStatus.OK, Json.write(Map.of("message", messageJson(msg, reactionsOf(roomId, cid, rc.me().id())))));
                return;
            }
            default:
                write(ctx, HttpResponseStatus.NOT_FOUND, err("not_found"));
        }
    }

    /** DELETE /api/rooms/{id}/messages/{cid} — xoá chỉ ở phía tôi (ẩn khỏi lịch sử riêng). */
    private void handleMessageDelete(ChannelHandlerContext ctx, FullHttpRequest req, String path) throws SQLException {
        String[] p = path.split("/");
        long roomId;
        try {
            roomId = Long.parseLong(p[3]);
        } catch (NumberFormatException e) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("bad_room"));
            return;
        }
        String cid;
        try {
            cid = java.net.URLDecoder.decode(p[5], java.nio.charset.StandardCharsets.UTF_8);
        } catch (Exception e) {
            cid = p[5];
        }
        RoomCtx rc = requireRoomMemberId(ctx, req, roomId);
        if (rc == null) {
            return;
        }
        if (roomDao.messageByClientId(roomId, cid).isEmpty()) {
            write(ctx, HttpResponseStatus.NOT_FOUND, err("message_not_found"));
            return;
        }
        roomDao.hideForUser(roomId, cid, rc.me().id());
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true)));
    }

    /** POST /api/rooms/{id}/read — đánh dấu đã đọc tới client_msg_id (chỉ tiến, không lùi). */
    private void handleRoomRead(ChannelHandlerContext ctx, FullHttpRequest req, String path) throws SQLException {
        String[] p = path.split("/");
        long roomId;
        try {
            roomId = Long.parseLong(p[3]);
        } catch (NumberFormatException e) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("bad_room"));
            return;
        }
        RoomCtx rc = requireRoomMemberId(ctx, req, roomId);
        if (rc == null) {
            return;
        }
        JsonNode b = Json.tree(body(req));
        String cid = nstr(b, "client_msg_id");
        if (cid == null || !cid.matches("^[0-9A-Za-z_-]{8,64}$")) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("bad_message_id"));
            return;
        }
        if (roomDao.messageByClientId(roomId, cid).isEmpty()) {
            write(ctx, HttpResponseStatus.NOT_FOUND, err("message_not_found"));
            return;
        }
        roomDao.markRead(roomId, rc.me().id(), cid);
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true, "last_read_message_id", cid)));
    }

    /**
     * POST /api/rooms/{id}/messages/forward — chia sẻ tin sang phòng đích theo E2E.
     *
     * <p>Server chỉ tạo metadata cho tin mới trong phòng đích (client_msg_id mới +
     * forwarded_from_client_id trỏ về tin gốc), nội dung luôn NULL. Client chịu trách
     * nhiệm sinh client_msg_id mới và gửi nội dung qua mesh (đã mã hoá đầu-cuối).
     */
    private void handleMessageForward(ChannelHandlerContext ctx, FullHttpRequest req, String path) throws SQLException {
        RoomCtx rc = requireRoomMember(ctx, req, path);
        if (rc == null) {
            return;
        }
        if (!rateAllow("msgfwd:" + rc.me().id(), 60, 60_000L)) {
            write(ctx, HttpResponseStatus.TOO_MANY_REQUESTS, err("rate_limited"));
            return;
        }
        JsonNode b;
        try {
            b = Json.tree(body(req));
        } catch (Exception e) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("bad_json"));
            return;
        }
        String newCid = nstr(b, "client_msg_id");
        String srcCid = nstr(b, "forwarded_from_client_id");
        String type = nstr(b, "type");
        if (newCid == null || !newCid.matches("^[0-9A-Za-z_:-]{8,64}$")) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_client_msg_id"));
            return;
        }
        if (srcCid == null || !srcCid.matches("^[0-9A-Za-z_:-]{8,64}$")) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("bad_source"));
            return;
        }
        if (type == null || type.isBlank()) {
            type = "text";
        }
        if (!type.matches("text|image|video|file|voice")) {
            write(ctx, HttpResponseStatus.BAD_REQUEST, err("invalid_type"));
            return;
        }
        // Tin gốc phải tồn tại và người gửi phải là thành viên phòng chứa tin gốc.
        Optional<Long> srcRoom = roomDao.roomOfClientId(srcCid);
        if (srcRoom.isEmpty() || !roomDao.isMember(srcRoom.get(), rc.me().id())) {
            write(ctx, HttpResponseStatus.FORBIDDEN, err("bad_source"));
            return;
        }
        // Khoá mới không được trùng phòng khác (client_msg_id unique toàn cục).
        Optional<Long> owner = roomDao.roomOfClientId(newCid);
        if (owner.isPresent() && owner.get() != rc.roomId()) {
            write(ctx, HttpResponseStatus.CONFLICT, err("client_msg_id_conflict"));
            return;
        }
        roomDao.ensureMessageMeta(rc.roomId(), rc.me().id(), newCid, type, null, srcCid, null);
        RoomDao.MessageRow saved = roomDao.messageByClientId(rc.roomId(), newCid)
                .orElseThrow(() -> new SQLException("forward insert failed"));
        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("message", messageJson(saved))));
    }

    /** Sinh mã OTP mới (hủy mã cũ), lưu hash SHA-256 và gửi email thật. Trả false nếu thất bại (đã ghi response). */
    private boolean sendOtp(ChannelHandlerContext ctx, String email, String purpose) throws SQLException {
        String cooldownKey = email.toLowerCase(Locale.ROOT) + "|" + purpose;
        long now = System.currentTimeMillis();
        Long last = otpCooldowns.get(cooldownKey);
        if (last != null && now - last < OTP_COOLDOWN_MS) {
            write(ctx, HttpResponseStatus.TOO_MANY_REQUESTS, err("resend_cooldown"));
            return false;
        }
        otpCooldowns.put(cooldownKey, now);
        String code = String.format("%06d", RNG.nextInt(1_000_000));
        if (devMode) {
            System.out.println("[otp-debug] " + email + " purpose=" + purpose + " code=" + code);
        }
        otpDao.revokeActive(email, purpose);
        otpDao.insert(email, purpose, OtpDao.sha256Hex(code), otpTtlMinutes);
        if (mailer == null) {
            System.err.println("[tracker-mail] CẢNH BÁO: Mailer chưa cấu hình (thiếu MAIL_USERNAME/MAIL_PASSWORD). Mã OTP cho " + email + " là: " + code);
            return true;
        }
        try {
            mailer.sendOtpCode(email, code, otpTtlMinutes);
            System.out.println("[tracker-mail] Đã gửi mã OTP đến " + email + " (purpose=" + purpose + ")");
            return true;
        } catch (MessagingException e) {
            System.err.println("[tracker-mail] Lỗi gửi email qua Google SMTP tới " + email + ": " + e.getMessage());
            e.printStackTrace();
            write(ctx, HttpResponseStatus.INTERNAL_SERVER_ERROR, err("mail_failed"));
            return false;
        }
    }

    /** Kiểm tra OTP còn hiệu lực. `consume=false` chỉ xác nhận, không tiêu mã (dùng cho verify-purpose forgot trước khi reset). */
    private boolean checkOtp(String email, String code, String purpose, boolean consume) throws SQLException {
        Optional<OtpDao.OtpRow> row = otpDao.findActive(email, purpose);
        if (row.isEmpty()) {
            return false;
        }
        byte[] expect = OtpDao.sha256Hex(code.trim()).getBytes(StandardCharsets.US_ASCII);
        byte[] actual = row.get().codeHash().getBytes(StandardCharsets.US_ASCII);
        boolean ok = MessageDigest.isEqual(expect, actual);
        if (ok) {
            if (consume) {
                otpDao.markConsumed(row.get().id());
            }
            return true;
        }
        otpDao.incrementAttempt(row.get().id());
        if (row.get().attemptCount() + 1 >= MAX_OTP_ATTEMPTS) {
            otpDao.markConsumed(row.get().id());
        }
        return false;
    }

    private static String resolveUsername(String requested, String email) throws SQLException {
        String name = requested;
        if (name == null) {
            String local = email.substring(0, email.indexOf('@'));
            String cleaned = local.replaceAll("[^a-z0-9_.\\-]", "");
            if (cleaned.length() < 3) {
                cleaned = "user" + cleaned;
            }
            if (cleaned.length() > 32) {
                cleaned = cleaned.substring(0, 32);
            }
            name = cleaned;
            return name;
        }
        return name;
    }

    private static String cleanEmail(String email) {
        if (email == null || !email.matches(EMAIL_RE)) {
            return null;
        }
        return email.toLowerCase(Locale.ROOT);
    }

    private static Map<String, Object> userJson(User u) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", u.id());
        m.put("username", u.username());
        m.put("email", u.email());
        m.put("display_name", u.displayName());
        m.put("role", u.role());
        m.put("email_verified", u.emailVerified());
        return m;
    }

    private Map<String, Object> profileJson(Profile p) throws SQLException {
        String publicId = socialDao.ensurePublicId(p.id());
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", p.id());
        m.put("public_id", publicId);
        m.put("profile_url", "/u/" + publicId);
        m.put("username", p.username());
        m.put("email", p.email());
        m.put("display_name", p.displayName());
        m.put("role", p.role());
        m.put("email_verified", p.emailVerified());
        m.put("bio", p.bio() == null ? "" : p.bio());
        m.put("phone", p.phone() == null ? "" : p.phone());
        m.put("birthdate", p.dateOfBirth() == null ? "" : p.dateOfBirth());
        m.put("joined", p.createdAt() == null ? "" : p.createdAt());
        m.put("phone_public", p.showPhone());
        m.put("avatar", p.avatar() == null ? "" : p.avatar());
        m.put("cover", p.cover() == null ? "" : p.cover());
        return m;
    }

    private static String body(FullHttpRequest req) {
        return req.content().toString(StandardCharsets.UTF_8);
    }

    private static String remoteIp(ChannelHandlerContext ctx) {
        try {
            InetSocketAddress a = (InetSocketAddress) ctx.channel().remoteAddress();
            return a != null && a.getAddress() != null ? a.getAddress().getHostAddress() : "0";
        } catch (Exception e) {
            return "0";
        }
    }

    private static String bearer(FullHttpRequest req) {
        String h = req.headers().get(HttpHeaderNames.AUTHORIZATION);
        if (h != null && h.startsWith("Bearer ")) {
            return h.substring(7).trim();
        }
        return null;
    }

    private static String param(String query, String key, String dflt) {
        for (String pair : query.split("&")) {
            if (pair.isBlank()) {
                continue;
            }
            int eq = pair.indexOf('=');
            String k = eq < 0 ? pair : pair.substring(0, eq);
            if (k.equals(key)) {
                String v = eq < 0 ? "" : pair.substring(eq + 1);
                try {
                    return java.net.URLDecoder.decode(v, StandardCharsets.UTF_8);
                } catch (Exception e) {
                    return dflt;
                }
            }
        }
        return dflt;
    }

    private static int intParam(String query, String key, int dflt) {
        try {
            return Integer.parseInt(param(query, key, String.valueOf(dflt)));
        } catch (NumberFormatException e) {
            return dflt;
        }
    }

    private static String nstr(JsonNode b, String k) {
        JsonNode v = b.get(k);
        return v == null || v.isNull() ? null : v.asText();
    }

    private static Long longNode(JsonNode b, String k) {
        if (b == null) {
            return null;
        }
        JsonNode v = b.get(k);
        if (v == null || v.isNull()) {
            return null;
        }
        if (v.isNumber()) {
            return v.asLong();
        }
        try {
            return Long.parseLong(v.asText());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static String err(String code) {
        return Json.write(Map.of("error", code));
    }

    // CORS: mặc định "*" cho phát triển; CORS_ALLOW_ORIGIN có thể là MỘT origin hoặc DANH
    // SÁCH ngăn cách dấu phẩy. Khi là danh sách, chỉ phản chiếu (echo) đúng Origin khớp
    // trong allowlist — nhờ đó nhiều máy/ZeroTier dùng chung một Tracker vẫn an toàn.
    private static volatile String corsAllowOriginStatic = "*";
    private static final AttributeKey<String> REQ_ORIGIN = AttributeKey.valueOf("workchatReqOrigin");

    /** Origin trả về cho CORS: "*" hoặc origin khớp allowlist (echo lại chính xác). */
    private static String resolveCorsOrigin(ChannelHandlerContext ctx) {
        String cfg = corsAllowOriginStatic;
        if (cfg == null || cfg.isBlank() || "*".equals(cfg)) {
            return "*";
        }
        String[] allow = cfg.split(",");
        String reqOrigin = ctx.channel().attr(REQ_ORIGIN).get();
        if (reqOrigin != null && !reqOrigin.isBlank()) {
            for (String o : allow) {
                if (o.trim().equalsIgnoreCase(reqOrigin.trim())) {
                    return reqOrigin.trim();
                }
            }
        }
        return allow[0].trim();
    }

    /**
     * Blob tệp đã mã hóa E2E. Người gửi tạo blob → PUT từng khối → finish; người nhận GET một
     * khối (hoặc metadata). Đọc chỉ cần đăng nhập: blobId 128-bit là "vé" không đoán được và
     * nội dung luôn là byte mã hóa, nên Tracker không thể đọc tệp.
     */
    private void handleBlob(ChannelHandlerContext ctx, HttpMethod m, FullHttpRequest req,
                            String path, String query) throws SQLException {
        User me = requireUser(ctx, bearer(req));
        if (me == null) {
            return;
        }
        try {
            if (path.equals("/api/blob")) {
                if (m != HttpMethod.POST) {
                    write(ctx, HttpResponseStatus.METHOD_NOT_ALLOWED, err("method_not_allowed"));
                    return;
                }
                Map<String, Object> body = Json.readMap(req.content().toString(StandardCharsets.UTF_8));
                long size = body.get("size") instanceof Number n ? n.longValue() : 0L;
                int blocks = body.get("blocks") instanceof Number b ? b.intValue() : 0;
                long maxBlobBytes = (long) maxFileMbBlob() * 1024 * 1024;
                long quotaBytes = (long) userBlobQuotaMb() * 1024 * 1024;
                long ttlMs = (long) blobTtlDays() * 24 * 60 * 60 * 1000L;
                BlobStore.Meta meta = blobs.create(me.id(), size, blocks, maxBlobBytes, quotaBytes, ttlMs);
                Map<String, Object> out = new LinkedHashMap<>();
                out.put("ok", true);
                out.put("blob_id", meta.id());
                out.put("expires_at", meta.expiresAt());
                write(ctx, HttpResponseStatus.OK, Json.write(out));
                return;
            }
            String rest = path.substring("/api/blob/".length());
            String[] parts = rest.split("/");
            String id = parts.length > 0 ? parts[0] : "";
            if (parts.length == 1) {
                if (m == HttpMethod.DELETE) {
                    boolean done = blobs.delete(me.id(), id);
                    if (done) {
                        write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true)));
                    } else {
                        write(ctx, HttpResponseStatus.NOT_FOUND, err("not_found"));
                    }
                    return;
                }
                if (m != HttpMethod.GET) {
                    write(ctx, HttpResponseStatus.METHOD_NOT_ALLOWED, err("method_not_allowed"));
                    return;
                }
                BlobStore.Meta meta = blobs.meta(id);
                if (meta == null || !meta.complete()) {
                    write(ctx, HttpResponseStatus.NOT_FOUND, err("not_found"));
                    return;
                }
                String block = param(query, "block", null);
                if (block != null) {
                    byte[] data;
                    try {
                        data = blobs.block(id, Integer.parseInt(block));
                    } catch (NumberFormatException e) {
                        data = null;
                    }
                    if (data == null) {
                        write(ctx, HttpResponseStatus.NOT_FOUND, err("not_found"));
                    } else {
                        writeBytes(ctx, HttpResponseStatus.OK, data);
                    }
                    return;
                }
                Map<String, Object> out = new LinkedHashMap<>();
                out.put("ok", true);
                out.put("blob_id", meta.id());
                out.put("size", meta.size());
                out.put("blocks", meta.blocks());
                out.put("expires_at", meta.expiresAt());
                write(ctx, HttpResponseStatus.OK, Json.write(out));
                return;
            }
            if (parts.length == 3 && "block".equals(parts[1])) {
                if (m != HttpMethod.PUT) {
                    write(ctx, HttpResponseStatus.METHOD_NOT_ALLOWED, err("method_not_allowed"));
                    return;
                }
                byte[] data = io.netty.buffer.ByteBufUtil.getBytes(req.content());
                int n = Integer.parseInt(parts[2]);
                blobs.putBlock(me.id(), id, n, data);
                write(ctx, HttpResponseStatus.OK, Json.write(Map.of("ok", true)));
                return;
            }
            if (parts.length == 2 && "finish".equals(parts[1])) {
                if (m != HttpMethod.POST) {
                    write(ctx, HttpResponseStatus.METHOD_NOT_ALLOWED, err("method_not_allowed"));
                    return;
                }
                BlobStore.Meta meta = blobs.finish(me.id(), id);
                Map<String, Object> out = new LinkedHashMap<>();
                out.put("ok", true);
                out.put("blob_id", meta.id());
                out.put("size", meta.size());
                write(ctx, HttpResponseStatus.OK, Json.write(out));
                return;
            }
            write(ctx, HttpResponseStatus.NOT_FOUND, err("not_found"));
        } catch (IllegalStateException | NumberFormatException e) {
            String code = e.getMessage() == null ? "bad_request" : e.getMessage();
            HttpResponseStatus st = switch (code) {
                case "too_many" -> HttpResponseStatus.TOO_MANY_REQUESTS;
                case "forbidden" -> HttpResponseStatus.FORBIDDEN;
                case "not_found" -> HttpResponseStatus.NOT_FOUND;
                case "bad_size" -> HttpResponseStatus.REQUEST_ENTITY_TOO_LARGE;
                case "quota_exceeded" -> HttpResponseStatus.REQUEST_ENTITY_TOO_LARGE;
                default -> HttpResponseStatus.BAD_REQUEST;
            };
            if ("quota_exceeded".equals(code)) {
                write(ctx, st, Json.write(Map.of("ok", false, "error", "quota_exceeded",
                        "message", "Đã vượt hạn mức lưu trữ (" + userBlobQuotaMb() + " MB)")));
                return;
            }
            write(ctx, st, err(code));
        } catch (Exception e) {
            write(ctx, HttpResponseStatus.INTERNAL_SERVER_ERROR, err("blob_failed"));
        }
    }

    private static void writeBytes(ChannelHandlerContext ctx, HttpResponseStatus status, byte[] body) {
        FullHttpResponse res = new DefaultFullHttpResponse(
                HttpVersion.HTTP_1_1, status, Unpooled.copiedBuffer(body));
        res.headers().set(HttpHeaderNames.CONTENT_TYPE, "application/octet-stream");
        res.headers().setInt(HttpHeaderNames.CONTENT_LENGTH, body.length);
        res.headers().set(HttpHeaderNames.CACHE_CONTROL, "no-store");
        String allow = resolveCorsOrigin(ctx);
        res.headers().set(HttpHeaderNames.ACCESS_CONTROL_ALLOW_ORIGIN, allow);
        if (!"*".equals(allow)) {
            res.headers().set(HttpHeaderNames.VARY, "Origin");
        }
        ctx.writeAndFlush(res);
    }

    private static void write(ChannelHandlerContext ctx, HttpResponseStatus status, String json) {
        FullHttpResponse res = new DefaultFullHttpResponse(
                HttpVersion.HTTP_1_1, status, Unpooled.copiedBuffer(json, StandardCharsets.UTF_8));
        res.headers().set(HttpHeaderNames.CONTENT_TYPE, "application/json; charset=utf-8");
        res.headers().setInt(HttpHeaderNames.CONTENT_LENGTH, res.content().readableBytes());
        String allow = resolveCorsOrigin(ctx);
        res.headers().set(HttpHeaderNames.ACCESS_CONTROL_ALLOW_ORIGIN, allow);
        if (!"*".equals(allow)) {
            res.headers().set(HttpHeaderNames.VARY, "Origin");
        }
        res.headers().set(HttpHeaderNames.ACCESS_CONTROL_ALLOW_METHODS, "GET,POST,PUT,DELETE,OPTIONS");
        res.headers().set(HttpHeaderNames.ACCESS_CONTROL_ALLOW_HEADERS, "Content-Type,Authorization");
        ctx.writeAndFlush(res);
    }
}
