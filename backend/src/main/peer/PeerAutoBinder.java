package com.workchat.peer;

import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * Điều phối vòng đời bind/unbind của Peer Core (M3).
 *
 * <p>Peer Core khởi động ở trạng thái UNBOUND (chỉ UI WS + mesh/UDP nền). Khi trình
 * duyệt gửi {@code bind {ticket}}, binder đổi vé lấy chìa phiên, gán danh tính cho
 * {@link PeerCore}, rồi mở đăng ký endpoint + WS signaling + heartbeat. Khi mất mạng,
 * WS tự nối lại và đăng ký lại bằng chìa phiên đang giữ. Khi chìa hết hạn hoặc bị
 * Tracker từ chối (401), binder đưa Peer Core về UNBOUND, khoá E2E và báo UI
 * {@code session_expired}.
 *
 * <p>Chìa phiên chỉ nằm trong RAM (không ghi đĩa, không log) và bị xoá khi unbind.
 */
public final class PeerAutoBinder {
    /** Callback thông báo UI khi phiên hết hạn (nếu có kênh UI). */
    public interface SuspendListener {
        void onSessionExpired();
    }

    /** Đổi vé/nonce lấy chìa phiên; tách ra để kiểm thử thuần không cần mạng. */
    public interface TicketExchanger {
        /** Sinh nonce mới cho lần bind kế tiếp (gọi khi hello). */
        String rotateNonce();

        /** Đổi vé + nonce hiện hành lấy chìa phiên. */
        PeerBindService.Session exchange(String ticket) throws PeerBindService.BindException;
    }

    private final PeerCore core;
    private final TicketExchanger exchanger;
    private final String server;
    private final String wsUrl;
    private final String listenIp;
    private final int listenPort;
    private final int uiPort;

    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "peer-binder");
        t.setDaemon(true);
        return t;
    });

    private volatile SessionKeyTicketProvider tickets;
    private volatile PeerRegistrationService registration;
    private volatile WsSignaling sig;
    private volatile PeerBindService.Session session;
    private volatile String boundPublicId = "";
    private volatile ScheduledFuture<?> expiryTask;
    private volatile ScheduledFuture<?> retryTask;
    private volatile SuspendListener listener;

    public PeerAutoBinder(PeerCore core, String server, String wsUrl, String listenIp, int listenPort, int uiPort) {
        this(core, new PeerBindService(server), server, wsUrl, listenIp, listenPort, uiPort);
    }

    /** Constructor dùng cho kiểm thử: bơm sẵn bộ đổi vé (không gọi mạng thật). */
    PeerAutoBinder(PeerCore core, TicketExchanger exchanger, String server, String wsUrl, String listenIp,
                   int listenPort, int uiPort) {
        this.core = core;
        this.exchanger = exchanger;
        this.server = server;
        this.wsUrl = wsUrl;
        this.listenIp = listenIp;
        this.listenPort = listenPort;
        this.uiPort = uiPort;
    }

    public void setSuspendListener(SuspendListener listener) {
        this.listener = listener;
    }

    /** Frame {@code hello_res} cho trình duyệt: trạng thái + nonce mới + cổng UI. */
    public Map<String, Object> hello() {
        String nonce = exchanger.rotateNonce();
        Map<String, Object> out = new java.util.LinkedHashMap<>();
        out.put("type", "hello_res");
        boolean bound = core.isBound() && session != null;
        out.put("state", bound ? "bound" : "unbound");
        out.put("nonce", nonce);
        out.put("port", uiPort);
        out.put("apiPort", core.apiPort());
        out.put("e2e", core.e2eState());
        if (bound) {
            out.put("boundUserId", session.userId());
            out.put("boundUsername", session.username());
            out.put("boundPublicId", boundPublicId);
        }
        return out;
    }

    public String state() {
        return (core.isBound() && session != null) ? "bound" : "unbound";
    }

    public long boundUserId() {
        PeerBindService.Session s = session;
        return s == null ? 0 : s.userId();
    }

    public String boundPublicId() {
        return boundPublicId;
    }

    /**
     * Xử lý {@code bind {ticket}}: đổi vé, gán danh tính, mở dịch vụ đã bind.
     * Trả frame trả lời UI ({@code bound} hoặc {@code bind_error}).
     */
    public synchronized Map<String, Object> bind(String ticket) {
        if (core.isBound() && session != null) {
            // Đã bind: đổi vé để biết người yêu cầu. Cùng tài khoản → thành công;
            // khác tài khoản → trả thông tin tài khoản đang gắn để UI xử lý (giải phóng).
            try {
                PeerBindService.Session s = exchanger.exchange(ticket);
                if (s.userId() == session.userId()) {
                    return boundFrame();
                }
                return otherAccountFrame(session);
            } catch (PeerBindService.BindException e) {
                if (e.unauthorized()) {
                    return Map.of("type", "bind_error", "error", "invalid_ticket");
                }
                return Map.of("type", "bind_error", "error", "exchange_error");
            }
        }
        PeerBindService.Session s;
        try {
            s = exchanger.exchange(ticket);
        } catch (PeerBindService.BindException e) {
            String err = e.unauthorized() ? "invalid_ticket" : "exchange_error";
            return Map.of("type", "bind_error", "error", err);
        }
        activate(s);
        return boundFrame();
    }

    /** Trả lỗi kèm danh tính tài khoản đang gắn để FE phân biệt "khác tài khoản" và cho gỡ. */
    private Map<String, Object> otherAccountFrame(PeerBindService.Session cur) {
        Map<String, Object> out = new java.util.LinkedHashMap<>();
        out.put("type", "bind_error");
        out.put("error", "other_account");
        out.put("boundUserId", cur.userId());
        out.put("boundUsername", cur.username());
        out.put("apiPort", core.apiPort());
        return out;
    }

    private Map<String, Object> boundFrame() {
        PeerBindService.Session s = session;
        Map<String, Object> out = new java.util.LinkedHashMap<>();
        out.put("type", "bound");
        out.put("publicId", s == null ? "" : boundPublicId);
        out.put("userId", s == null ? 0 : s.userId());
        out.put("username", s == null ? "" : s.username());
        out.put("e2e", core.e2eState());
        out.put("apiPort", core.apiPort());
        return out;
    }

    /** Gán danh tính + mở các dịch vụ phụ thuộc phiên (đăng ký, WS signaling, heartbeat). */
    private void activate(PeerBindService.Session s) {
        core.bindIdentity(new PeerCore.Identity(s.userId(), s.username()));
        core.attachToken(s.sessionKey());
        this.session = s;
        this.boundPublicId = s.publicId() == null ? "" : s.publicId();

        SessionKeyTicketProvider tp = new SessionKeyTicketProvider(s.sessionKey());
        this.tickets = tp;

        PeerRegistrationService reg = new PeerRegistrationService(core, s.userId(), server, listenIp, listenPort, tp);
        reg.setOnUnauthorized(this::sessionExpired);
        reg.setOnServerReachable(core::onServerReachable);
        this.registration = reg;
        registerWithRetry(reg);

        WsSignaling ws = new WsSignaling(core, wsUrl, s.sessionKey());
        ws.setOnReconnected(reg::reRegisterQuietly);
        ws.setOnConnectivity(core::onSignalingConnectivity);
        ws.setOnUnauthorized(this::sessionExpired);
        this.sig = ws;
        core.attachSignaling(ws);
        ws.start();

        scheduleExpiry(s);
        System.out.println("[peer] bound: " + s.username() + " (id=" + s.userId() + ")");
    }

    private void registerWithRetry(PeerRegistrationService reg) {
        try {
            reg.registerOrThrow();
        } catch (Exception e) {
            System.err.println("[peer] đăng ký ban đầu thất bại, sẽ thử lại: " + e.getMessage());
            cancelRetry();
            retryTask = scheduler.scheduleWithFixedDelay(() -> {
                if (registration != reg || !core.isBound()) {
                    cancelRetry();
                    return;
                }
                try {
                    reg.registerOrThrow();
                    cancelRetry();
                    System.out.println("[peer] đăng ký lại thành công");
                } catch (Exception ex) {
                    // tiếp tục thử
                }
            }, 3000, 3000, TimeUnit.MILLISECONDS);
        }
    }

    private void scheduleExpiry(PeerBindService.Session s) {
        cancelExpiry();
        if (s.expiresAt() <= 0) {
            return;
        }
        long delayMs = s.expiresAt() * 1000L - System.currentTimeMillis();
        if (delayMs <= 0) {
            sessionExpired();
            return;
        }
        expiryTask = scheduler.schedule(this::sessionExpired, delayMs, TimeUnit.MILLISECONDS);
    }

    /** Đưa về UNBOUND và báo UI phiên hết hạn (chìa hết hạn/bị thu hồi). */
    public void sessionExpired() {
        synchronized (this) {
            boolean wasBound = core.isBound() || session != null;
            stopServices();
            core.clearIdentity();
            if (wasBound) {
                SuspendListener l = listener;
                if (l != null) {
                    try {
                        l.onSessionExpired();
                    } catch (Exception ignored) {
                        // không chặn
                    }
                }
            }
        }
    }

    /** Người dùng đăng xuất/chủ động gỡ: dừng dịch vụ, khoá E2E, về UNBOUND (không báo hết hạn). */
    public synchronized void unbind() {
        stopServices();
        core.clearIdentity();
    }

    private void stopServices() {
        cancelExpiry();
        cancelRetry();
        WsSignaling ws = sig;
        if (ws != null) {
            ws.stop();
            sig = null;
        }
        PeerRegistrationService reg = registration;
        if (reg != null) {
            reg.stop();
            registration = null;
        }
        core.revokeSession();
        this.session = null;
        this.tickets = null;
        this.boundPublicId = "";
    }

    public void shutdown() {
        synchronized (this) {
            stopServices();
            core.clearIdentity();
        }
        scheduler.shutdownNow();
    }

    private void cancelExpiry() {
        ScheduledFuture<?> t = expiryTask;
        if (t != null) {
            t.cancel(false);
            expiryTask = null;
        }
    }

    private void cancelRetry() {
        ScheduledFuture<?> t = retryTask;
        if (t != null) {
            t.cancel(false);
            retryTask = null;
        }
    }
}
