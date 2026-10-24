package com.workchat.peer;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Gửi heartbeat UDP định kỳ tới Tracker (control-plane) để báo node còn sống.
 * Payload nhỏ dạng {@code userId:secret}; secret do Tracker cấp lúc đăng ký để
 * Tracker loại bỏ gói giả mạo.
 */
public final class UdpHeartbeat {
    private final String host;
    private final int port;
    private final long userId;
    private final String secret;
    private final long intervalMs;
    private final AtomicLong sent = new AtomicLong();

    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "udp-hb");
        t.setDaemon(true);
        return t;
    });

    private volatile DatagramSocket socket;
    private volatile boolean stopped;

    public UdpHeartbeat(String host, int port, long userId, String secret, long intervalMs) {
        this.host = host;
        this.port = port;
        this.userId = userId;
        this.secret = secret;
        this.intervalMs = Math.max(500, intervalMs);
    }

    public void start() {
        try {
            this.socket = new DatagramSocket();
        } catch (Exception e) {
            return;
        }
        scheduler.scheduleAtFixedRate(this::beat, 0, intervalMs, TimeUnit.MILLISECONDS);
    }

    private void beat() {
        DatagramSocket s = socket;
        if (stopped || s == null || s.isClosed()) {
            return;
        }
        try {
            byte[] payload = (userId + ":" + secret).getBytes(StandardCharsets.UTF_8);
            s.send(new DatagramPacket(payload, payload.length, InetAddress.getByName(host), port));
            sent.incrementAndGet();
        } catch (Exception ignored) {
            // nhịp sau thử lại
        }
    }

    public long sent() {
        return sent.get();
    }

    public void stop() {
        stopped = true;
        scheduler.shutdownNow();
        try {
            if (socket != null) {
                socket.close();
            }
        } catch (Exception ignored) {
        }
    }
}
