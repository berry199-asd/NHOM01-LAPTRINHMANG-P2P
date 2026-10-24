package com.workchat.tracker.udp;

import com.workchat.tracker.ws.ClientRegistry;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.BiConsumer;

/**
 * Heartbeat UDP của Tracker.
 *
 * <p>Luồng nhận chỉ giải mã nhẹ rồi {@code offer} payload vào một hàng đợi có giới hạn;
 * việc cập nhật trạng thái do một pool worker làm bất đồng bộ, nhờ đó khi hàng trăm gói
 * heartbeat dồn dập mỗi giây thì không bị rơi gói do nghẽn xử lý. Một sweeper định kỳ
 * loại các peer quá hạn (không còn heartbeat) khỏi danh sách trực tuyến.
 */
public final class HeartbeatService {
    private static final int QUEUE_CAPACITY = 8192;

    private final ClientRegistry registry;
    private final int port;
    private final int workerCount;
    private final long intervalMs;
    private final long ttlMs;
    private final BiConsumer<Long, String> onStale;

    private final BlockingQueue<String> queue = new LinkedBlockingQueue<>(QUEUE_CAPACITY);
    private final AtomicLong received = new AtomicLong();
    private final AtomicLong processed = new AtomicLong();
    private final AtomicLong dropped = new AtomicLong();
    private final AtomicLong invalid = new AtomicLong();
    private final AtomicInteger queueDepth = new AtomicInteger();

    private final ScheduledExecutorService sweeper = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "hb-sweep");
        t.setDaemon(true);
        return t;
    });

    private volatile DatagramSocket socket;
    private volatile boolean stopped;
    private int boundPort;

    public HeartbeatService(ClientRegistry registry, int port, long intervalMs, long ttlMs,
                            int workerCount, BiConsumer<Long, String> onStale) {
        this.registry = registry;
        this.port = port;
        this.intervalMs = intervalMs;
        this.ttlMs = ttlMs;
        this.workerCount = Math.max(1, workerCount);
        this.onStale = onStale;
    }

    public void start() throws Exception {
        registry.setPeerTtlMs(ttlMs);
        DatagramSocket s = new DatagramSocket(null);
        s.setReuseAddress(true);
        s.bind(new InetSocketAddress("0.0.0.0", port));
        this.socket = s;
        this.boundPort = s.getLocalPort();

        Thread recv = new Thread(this::receiveLoop, "hb-recv");
        recv.setDaemon(true);
        recv.start();

        for (int i = 0; i < workerCount; i++) {
            Thread w = new Thread(this::workLoop, "hb-worker-" + i);
            w.setDaemon(true);
            w.start();
        }

        sweeper.scheduleWithFixedDelay(this::sweep, 1000, 1000, TimeUnit.MILLISECONDS);
        System.out.println("[tracker] heartbeat UDP listening on 0.0.0.0:" + boundPort
                + " (interval=" + intervalMs + "ms, ttl=" + ttlMs + "ms, workers=" + workerCount + ")");
    }

    private void receiveLoop() {
        byte[] buf = new byte[512];
        while (!stopped) {
            try {
                DatagramPacket p = new DatagramPacket(buf, buf.length);
                socket.receive(p);
                received.incrementAndGet();
                String payload = new String(p.getData(), p.getOffset(), p.getLength(), StandardCharsets.UTF_8).trim();
                queueDepth.set(queue.size());
                // Bất đồng bộ: chỉ xếp hàng, không xử lý tại luồng nhận để không rơi gói khi bùng nổ.
                if (!queue.offer(payload)) {
                    dropped.incrementAndGet();
                }
            } catch (Exception e) {
                // socket đóng hoặc lỗi tạm thời — tiếp tục vòng lặp
            }
        }
    }

    private void workLoop() {
        while (!stopped) {
            try {
                String payload = queue.poll(1, TimeUnit.SECONDS);
                if (payload == null) {
                    continue;
                }
                queueDepth.set(queue.size());
                int i = payload.indexOf(':');
                if (i <= 0) {
                    invalid.incrementAndGet();
                    continue;
                }
                long userId;
                try {
                    userId = Long.parseLong(payload.substring(0, i));
                } catch (NumberFormatException e) {
                    invalid.incrementAndGet();
                    continue;
                }
                String secret = payload.substring(i + 1);
                if (registry.touchPeer(userId, secret)) {
                    processed.incrementAndGet();
                } else {
                    invalid.incrementAndGet();
                }
            } catch (InterruptedException e) {
                return;
            }
        }
    }

    private void sweep() {
        try {
            for (Long uid : registry.stalePeerIds()) {
                String username = registry.usernameOf(uid);
                // Gọi callback TRƯỚC khi clearPeer để còn đọc được lastSeenAt/username.
                if (onStale != null) {
                    onStale.accept(uid, username);
                }
                registry.clearPeer(uid);
            }
        } catch (Exception ignored) {
            // sweeper không được chết
        }
    }

    public Map<String, Object> stats() {
        Map<String, Object> s = new HashMap<>();
        s.put("port", boundPort);
        s.put("intervalMs", intervalMs);
        s.put("ttlMs", ttlMs);
        s.put("workers", workerCount);
        s.put("queueCapacity", QUEUE_CAPACITY);
        s.put("queueDepth", queueDepth.get());
        s.put("received", received.get());
        s.put("processed", processed.get());
        s.put("dropped", dropped.get());
        s.put("invalid", invalid.get());
        s.put("peersRegistered", registry.peerCount());
        s.put("peersAlive", registry.alivePeerCount());
        return s;
    }

    public int port() {
        return boundPort;
    }

    public long intervalMs() {
        return intervalMs;
    }

    public void stop() {
        stopped = true;
        try {
            if (socket != null) {
                socket.close();
            }
        } catch (Exception ignored) {
        }
        sweeper.shutdownNow();
    }
}
