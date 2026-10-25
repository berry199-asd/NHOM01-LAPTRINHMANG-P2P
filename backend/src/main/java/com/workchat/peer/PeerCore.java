package com.workchat.peer;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.fasterxml.jackson.databind.JsonNode;
import com.workchat.peer.net.LocalNetworks;
import com.workchat.peer.net.PunchSchedule;
import com.workchat.peer.net.StunClient;
import com.workchat.peer.offline.E2eKeystore;
import com.workchat.peer.offline.OfflineStore;
import com.workchat.peer.protocol.CryptoBox;
import com.workchat.tracker.common.Json;
import io.netty.bootstrap.Bootstrap;
import io.netty.channel.Channel;
import io.netty.channel.ChannelInitializer;
import io.netty.channel.ChannelOption;
import io.netty.channel.EventLoopGroup;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.SocketChannel;
import io.netty.channel.socket.nio.NioSocketChannel;
import io.netty.channel.WriteBufferWaterMark;
import io.netty.handler.codec.LengthFieldBasedFrameDecoder;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;

import javax.crypto.SecretKey;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicBoolean;

/** Điểm dữ liệu (data-plane): mesh TCP trực tiếp giữa các peer, nội dung KHÔNG qua server 9090. */
public final class PeerCore {
    /** Byte mở đầu khối nhị phân file transfer trên kênh AES (JSON luôn bắt đầu bằng '{'). */
    public static final byte FILE_TAG = 0x01;
    /** Kích thước mỗi khối khi chia file (trong khoảng yêu cầu 32KB–64KB). */
    public static final int FILE_CHUNK_SIZE = 32 * 1024;

    public record Identity(long userId, String username) {
    }

    public record PeerEntry(long userId, String username, String ip, int port, String pubKey,
                            int udpPort, String udpPublicIp, int udpPublicPort) {
    }

    /**
     * Kết quả gửi một khung sự kiện (dùng cho chẩn đoán LỖI B — khung cuộc gọi có tới được ai không).
     * {@code state}: {@code "sent"} (đã ghi vào ≥1 PeerLink READY hoặc Relay nhận),
     * {@code "pending"} (chỉ xếp hàng chờ handshake, CHƯA thực sự gửi), {@code "no_route"}
     * (không có link/relay nào). {@code via}: {@code "direct"|"relay"} khi đã gửi.
     */
    public record EventSendResult(String state, String via, int peers, int pending) {
        public static final EventSendResult NO_ROUTE = new EventSendResult("no_route", null, 0, 0);
    }

    /**
     * Chẩn đoán kết nối tới một peer (cho API cục bộ {@code GET /links}). Chỉ chứa thông tin
     * kết nối (địa chỉ, thời điểm, kết quả, lý do thất bại dạng mã) — KHÔNG chứa khóa/token/nội dung.
     */
    public static final class LinkDiag {
        public volatile String lastAddress;
        public volatile long lastAttemptAt;
        public volatile String lastResult; // connecting | connected | ok | failed | dead
        public volatile String lastFailReason; // connection_refused | timeout | hello_verify_failed | tofu_mismatch | no_address | peer_not_alive | closed_by_peer
        public volatile boolean everReady;
    }

    /**
     * Danh tính Peer Core. null khi UNBOUND (chưa bind với Tracker); được gán khi bind.
     * Trước M3 là final; nay đổi thành volatile để hỗ trợ khởi động UNBOUND.
     */
    private volatile Identity identity;
    private final String serverUrl;
    private final int listenPort;
    private final String listenIp;
    /** Token/chìa phiên — cần khi đăng ký lại endpoint sau khi dò lại STUN lúc chạy. */
    private volatile String authToken;

    /** Khóa định danh Ed25519 BỀN VỮNG của peer này (TOFU) — ký transcript bắt tay chống MITM. */
    private volatile KeyPair identityKey;
    /** Ghim khóa định danh Ed25519 của các peer khác (TOFU) để phát hiện thay đổi. */
    private volatile com.workchat.peer.offline.TofuPinStore tofuPins;

    private final Map<Long, Map<Long, PeerEntry>> roomPeers = new ConcurrentHashMap<>();
    private final Map<Long, PeerLink> linksByUserId = new ConcurrentHashMap<>();
    /** Chẩn đoán link theo userId — phục vụ API cục bộ GET /links (không chứa bí mật). */
    private final Map<Long, LinkDiag> linkDiag = new ConcurrentHashMap<>();
    /** Khóa công khai định danh đã được Tracker xác thực (từ signaling), key = userId. */
    private final Map<Long, String> idPubByUser = new ConcurrentHashMap<>();
    private final List<Map<String, Object>> received = new ArrayList<>();
    private final List<Map<String, Object>> seenEvents = new ArrayList<>();

    private final EventLoopGroup meshGroup = new NioEventLoopGroup(1);
    private final AtomicReference<Bootstrap> outbound = new AtomicReference<>();
    private final java.util.List<Channel> uiClients = new java.util.concurrent.CopyOnWriteArrayList<>();
    private volatile WsSignaling signaling;
    private HttpServer apiServer;
    private volatile int apiPort;

    // ---- Nhắn tin ngoại tuyến E2E (Hướng A: lịch sử cục bộ, server chỉ là hộp thư) ----
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();
    private volatile OfflineStore offlineStore;
    private volatile Path keystorePath;
    /** Cặp khóa E2E đã mở khóa; null khi chưa unlock. */
    private volatile E2eKeystore.Material e2e;
    private volatile int unlockFailCount = 0;
    private volatile long unlockLockedUntil = 0L;
    /** Cache public key E2E của người khác (userId → DER). */
    private final Map<Long, PublicKey> peerE2eKeys = new ConcurrentHashMap<>();

    /** Data-plane UDP: socket, cổng cục bộ và địa chỉ công khai do STUN dò được. */
    private volatile DatagramSocket udpSocket;
    private volatile int udpPort;
    private volatile String udpPublicIp = "";
    private volatile int udpPublicPort;
    /** Danh sách máy chủ STUN (host:port) thử lần lượt cho tới khi dò được địa chỉ công khai. */
    private volatile java.util.List<String> stunServers = java.util.List.of();
    /** Gói STUN đang chờ: receive loop là nơi đọc socket duy nhất nên nó hoàn tất future này. */
    private volatile byte[] pendingStunTxn;
    private volatile java.util.concurrent.CompletableFuture<StunClient.Mapped> pendingStunFuture;
    private final java.util.concurrent.atomic.AtomicLong udpReceived = new java.util.concurrent.atomic.AtomicLong();
    private final java.util.concurrent.atomic.AtomicLong udpSent = new java.util.concurrent.atomic.AtomicLong();
    private final java.util.concurrent.atomic.AtomicLong udpDataSent = new java.util.concurrent.atomic.AtomicLong();
    private final java.util.concurrent.atomic.AtomicLong udpDataRecv = new java.util.concurrent.atomic.AtomicLong();
    private final java.util.concurrent.atomic.AtomicLong relaySent = new java.util.concurrent.atomic.AtomicLong();
    private final java.util.concurrent.atomic.AtomicLong relayRecv = new java.util.concurrent.atomic.AtomicLong();
    /** Khối file qua Relay được cắt nhỏ thành từng mảnh base64 để tránh vượt giới hạn frame WS. */
    private static final int RELAY_FRAG = 6000;
    private final java.util.concurrent.atomic.AtomicLong relayFragSeq = new java.util.concurrent.atomic.AtomicLong();
    private final java.util.concurrent.ConcurrentHashMap<String, RelayFrag> relayFrags = new java.util.concurrent.ConcurrentHashMap<>();

    private static final class RelayFrag {
        final String[] parts;
        int got;

        RelayFrag(int n) {
            parts = new String[n];
        }
    }
    /** Bắt buộc dùng Relay (bỏ qua kênh trực tiếp) — dùng cho test failover. */
    private volatile boolean relayOnly;
    /** Bắt buộc chỉ dùng kênh trực tiếp (không Relay) — dùng để kiểm tra LAN/công khai. */
    private volatile boolean forceDirectOnly;
    /** Transport gần nhất đã dùng cho mỗi peer (theo username), để chỉ log "conn via" khi đổi. */
    private final Map<String, String> lastTransport = new ConcurrentHashMap<>();
    /** Cache dải mạng cục bộ (để phân loại lan/zerotier/public) — quét lại tối đa mỗi 10 giây. */
    private volatile List<LocalNetworks.Iface> localIfaces = List.of();
    private volatile long localIfacesAt;
    /** Số phong bì còn lại trong hộp thư server sau lần kéo gần nhất (mailbox_hint). */
    private volatile int mailboxHint;
    /** Tracker (mặt phẳng điều khiển) có kết nối được không — để UI hiện trạng thái mất mạng. */
    private volatile boolean serverReachable;
    /**
     * Thời điểm (ms epoch) cuối cùng có BẤT KỲ tương tác Tracker nào thành công: HTTP nhận phản hồi
     * (đăng ký/heartbeat/store/pull/keys/…), hoặc WS xác thực/pong. 0 = chưa từng.
     */
    private volatile long lastTrackerOkAt;
    /**
     * Sau bao lâu (ms) không có tương tác Tracker nào thành công VÀ WS không mở thì mới coi là mất
     * kết nối. Tránh báo đỏ oan khi chỉ kênh WS thời gian thực đứt trong lúc HTTP vẫn thông. Chọn
     * 10 s để banner đỏ bật/tắt nhanh (≤ ~10 s) mà vẫn đủ trễ, không nhấp nháy khi Tracker chỉ chậm.
     */
    static final long TRACKER_DEAD_MS = 10_000L;
    /** Canh nhịp kiểm tra lại kết nối Tracker (ms) — chỉ đẩy frame khi cờ đổi. */
    private static final long TRACKER_WATCH_MS = 1_000L;
    private volatile boolean trackerWatchStarted;
    private ScheduledExecutorService udpScheduler;

    /** Số lần thử lại tối đa trước khi báo UI hiện nút "Gửi lại" (tin vẫn giữ trong outbox). */
    static final int MAX_SEND_ATTEMPTS = 6;

    /** Sau khi "cạn lượt", chờ bao lâu (ms) mà Tracker vẫn kết nối được thì tự thử lại (không cần người dùng bấm). */
    static final long REARM_AFTER_MS = 10_000L;

    /**
     * Kết quả gửi một tin: số peer nhận qua mesh, đã có ACK đồng bộ (hộp thư) chưa, và đã
     * xếp phong bì E2E vào outbox để gửi hộp thư ở luồng nền chưa. {@code queued=true} nghĩa
     * là tin CHẮC CHẮN còn đường tới hộp thư Tracker (sẽ thành "Đã gửi" khi Tracker nhận).
     */
    public record SendResult(String clientId, int meshCount, boolean acked, boolean queued) {
    }

    /** Một tin đi chưa được ACK, theo dõi để thử lại theo backoff (chỉ trong RAM). */
    private static final class PendingSend {
        final String clientId;
        final long roomId;
        final Map<String, Object> meshFrame;
        int attempts;
        volatile long nextAt;
        volatile boolean exhausted;
        /** Thời điểm cạn số lần thử (để tự thử lại sau một khoảng khi mạng đã ổn). */
        volatile long exhaustedAt;

        PendingSend(String clientId, long roomId, Map<String, Object> meshFrame) {
            this.clientId = clientId;
            this.roomId = roomId;
            this.meshFrame = meshFrame;
        }
    }

    /** Các tin đi đang chờ ACK, khoá theo clientId. */
    private final Map<String, PendingSend> pendingSends = new ConcurrentHashMap<>();
    private volatile ScheduledExecutorService retryScheduler;
    /**
     * Executor nền cho các tác vụ CHẶN (HTTP tới Tracker) phát sinh từ lệnh UI. Chạy ở luồng
     * riêng để KHÔNG chặn vòng sự kiện WebSocket UI — nhờ đó Peer Core vẫn trả `pong` và
     * `send_state` đúng lúc, tránh UI báo "Mất kết nối" oan khi Tracker chậm/mất mạng.
     */
    private volatile ScheduledExecutorService asyncScheduler;

    /** Đếm nhịp {@link #retryTick()} (1 giây/lần) để định kỳ kéo hộp thư khi Tracker kết nối được. */
    private volatile int retryTicks;
    /**
     * Cứ bao nhiêu nhịp retryTick thì kéo hộp thư một lần — để tin đến không cần reload UI.
     * retryTick chạy 1 nhịp/giây nên 2 = ~2 giây. Hạ xuống 1 nếu muốn phản hồi tức thì (đánh
     * đổi: tăng số lần gọi Tracker). Đặt ≥ 2 để cân bằng giữa độ trễ và tải cho Tracker.
     */
    private static final int PULL_EVERY_TICKS = 2;

    /** Kiểu gói data-plane UDP. */
    static final byte UDP_PUNCH = 0x01;
    static final byte UDP_PUNCH_ACK = 0x02;
    static final byte UDP_KEEPALIVE = 0x03;
    /** Dữ liệu ứng dụng (frame JSON) đã mã hóa AES bằng khóa phiên của kênh TCP. */
    static final byte UDP_DATA = 0x10;
    /** Kích thước tối đa ciphertext một gói UDP (tránh phân mảnh IP). */
    static final int UDP_DATA_MAX = 1200;
    /** Khoảng cách giữa hai lần gửi gói đục lỗ (ms). Cửa sổ đục lỗ theo PunchSchedule. */
    static final long UDP_PUNCH_INTERVAL_MS = 300;
    static final long UDP_KEEPALIVE_MS = 2000;
    static final long UDP_TIMEOUT_MS = 6000;

    /** Trạng thái kết nối UDP tới một peer (đục lỗ + keepalive). */
    static final class UdpState {
        volatile boolean reachable;
        volatile boolean failed;
        volatile long lastRecv;
        volatile long punchingUntil;
        volatile long nextPunchAt;
        volatile long punchStartedAt;
        volatile String remoteHost = "";
        volatile int remotePort;
    }

    private final Map<Long, UdpState> udpPeers = new ConcurrentHashMap<>();

    /** Trạng thái nhận file đang ghép, key = fileId. */
    private final Map<String, FileRx> fileRx = new ConcurrentHashMap<>();
    /** fileId hiện hành theo người gửi (meta đến trước chunk trên cùng 1 link TCP). */
    private final Map<Long, String> lastFileFromUser = new ConcurrentHashMap<>();

    /** Bộ ghép khối của một file đang nhận. */
    private static final class FileRx {
        final long roomId;
        final long fromUserId;
        final String name;
        final String mime;
        final long size;
        final String sha256;
        final int chunkSize;
        final int chunks;
        final byte[][] parts;
        final AtomicInteger received = new AtomicInteger();

        FileRx(long roomId, long fromUserId, String name, String mime, long size,
               String sha256, int chunkSize, int chunks) {
            this.roomId = roomId;
            this.fromUserId = fromUserId;
            this.name = name;
            this.mime = mime;
            this.size = size;
            this.sha256 = sha256;
            this.chunkSize = chunkSize;
            this.chunks = chunks;
            this.parts = new byte[chunks][];
        }
    }

    /** Thời gian giữ trạng thái gửi tệp để còn gửi lại khối thiếu (resume). */
    private static final long SENT_FILE_TTL_MS = 5 * 60 * 1000L;

    /** Tệp đã gửi đang chờ ACK từng khối, để gửi lại khối thiếu khi mạng chập chờn. */
    private static final class SentFile {
        final long roomId;
        final byte[] data;
        final int chunkSize;
        final int chunks;
        /** Bit khối đã được mỗi peer xác nhận (true = đã nhận). */
        final Map<Long, boolean[]> acked = new ConcurrentHashMap<>();
        final long createdAt = System.currentTimeMillis();
        volatile long lastResendAt;

        SentFile(long roomId, byte[] data, int chunkSize, int chunks) {
            this.roomId = roomId;
            this.data = data;
            this.chunkSize = chunkSize;
            this.chunks = chunks;
        }
    }

    /** Các tệp đã phát đi, chờ ACK đủ từ mọi peer (bị xoá sau TTL hoặc khi xong). */
    private final Map<String, SentFile> sentFiles = new ConcurrentHashMap<>();

    // ---------- A2: giao thức tệp v2 (streamId, đọc/ghi đĩa, cửa sổ + resume) ----------

    /** Mã luồng tăng dần (dương) để bên nhận tách khối của nhiều tệp cùng lúc. */
    private final AtomicInteger streamSeq = new AtomicInteger(1 + new java.util.Random().nextInt(100_000));

    /** Tệp đang gửi đi theo v2: đọc khối từ đĩa, không giữ cả tệp trong RAM. */
    private static final class SentFileV2 {
        final long roomId;
        final String fileId;
        final String name;
        final String mime;
        final long size;
        final String sha256;
        final int chunkSize;
        final int chunks;
        final int streamId;
        final Path path;
        final Map<Long, boolean[]> acked = new ConcurrentHashMap<>();
        /** Vị trí khối kế tiếp cần gửi cho mỗi đích (đặt lại 0 khi nhận accept mới). */
        final Map<Long, Integer> next = new ConcurrentHashMap<>();
        final java.util.Set<Long> accepted = ConcurrentHashMap.newKeySet();
        final java.util.Set<Long> finished = ConcurrentHashMap.newKeySet();
        final java.util.Set<Long> rejected = ConcurrentHashMap.newKeySet();
        final long createdAt = System.currentTimeMillis();
        volatile long lastActivityAt = createdAt;
        volatile boolean paused;
        volatile boolean closed;
        /** Đang xếp hàng vì vượt hạn mức tệp đồng thời (A4/A6). */
        volatile boolean queued;
        /** Đã/đang đẩy blob dự phòng lên Tracker (mỗi tệp chỉ một lần tải lên). */
        final AtomicBoolean blobBusy = new AtomicBoolean();
        final Set<Long> blobSent = ConcurrentHashMap.newKeySet();
        volatile String blobId;
        volatile byte[] blobKey;
        volatile int blobBlocks;
        /** Cửa sổ trượt hiện tại: co lại khi mạng yếu, nới lại khi ACK đều. */
        volatile int window = FileTransferConfig.WINDOW_CHUNKS;
        /** Backoff 0,5s -> 30s khi tệp bị tạm dừng vì không có tiến triển. */
        volatile long backoffMs = FileTransferConfig.RETRY_MIN_MS;
        volatile long retryAt;
        /** SHA-256 rút gọn (16 byte) từng khối, gửi kèm offer để bên nhận phát hiện khối hỏng. */
        volatile byte[][] sums;
        /** Số lần gửi lại từng khối cho mỗi đích (trần MAX_RESEND_PER_CHUNK). */
        final Map<Long, Map<Integer, Integer>> resends = new ConcurrentHashMap<>();
        /** Mốc % đã ghi log (A5: mỗi 10%, chỉ fileId). */
        volatile int loggedPct = -1;

        SentFileV2(long roomId, String fileId, String name, String mime, long size, String sha256,
                   int chunkSize, int chunks, int streamId, Path path) {
            this.roomId = roomId;
            this.fileId = fileId;
            this.name = name;
            this.mime = mime;
            this.size = size;
            this.sha256 = sha256;
            this.chunkSize = chunkSize;
            this.chunks = chunks;
            this.streamId = streamId;
            this.path = path;
        }

        void close() {
            closed = true;
        }
    }

    /** Tệp đang nhận theo v2: ghi khối thẳng xuống đĩa tại đúng offset. */
    private static final class FileRxV2 {
        final long roomId;
        final long fromUserId;
        final String fileId;
        final int streamId;
        final String name;
        final String mime;
        final long size;
        final String sha256;
        final int chunkSize;
        final int chunks;
        final Path part;
        final boolean[] have;
        /** SHA-256 rút gọn từng khối do bên gửi cung cấp (null nếu Core cũ không gửi). */
        final byte[][] sums;
        final int[] nackCount;
        final java.io.RandomAccessFile raf;
        final AtomicInteger received = new AtomicInteger();
        volatile long lastAckAt = System.currentTimeMillis();
        volatile int ackPending;

        FileRxV2(long roomId, long fromUserId, String fileId, int streamId, String name, String mime,
                 long size, String sha256, int chunkSize, int chunks, Path part, boolean[] have,
                 byte[][] sums, java.io.RandomAccessFile raf) {
            this.roomId = roomId;
            this.fromUserId = fromUserId;
            this.fileId = fileId;
            this.streamId = streamId;
            this.name = name;
            this.mime = mime;
            this.size = size;
            this.sha256 = sha256;
            this.chunkSize = chunkSize;
            this.chunks = chunks;
            this.part = part;
            this.have = have;
            this.sums = sums;
            this.nackCount = new int[chunks];
            this.raf = raf;
            for (boolean b : have) {
                if (b) {
                    received.incrementAndGet();
                }
            }
        }
    }

    private final Map<String, SentFileV2> sentFilesV2 = new ConcurrentHashMap<>();
    private final Map<String, FileRxV2> fileRxV2 = new ConcurrentHashMap<>();
    /** Đã khôi phục hàng đợi gửi từ đĩa trong phiên này chưa (chỉ một lần). */
    private volatile boolean restoredSends;
    private volatile ScheduledExecutorService fileScheduler;
    /** fileId đang được tải qua blob — guard để link trực tiếp và blob không ghi chung tệp tạm. */
    private final Set<String> blobReceiving = ConcurrentHashMap.newKeySet();
    /** fileId người dùng đã hủy khi đang tải blob — dừng ở khối kế tiếp. */
    private final Set<String> blobCancelled = ConcurrentHashMap.newKeySet();
    /** Số lần tải blob lỗi (mạng) — thử lại tối đa 3 lần trước khi bỏ. */
    private final Map<String, Integer> blobAttempts = new ConcurrentHashMap<>();
    /** Luồng nền cho blob Tracker (tối đa 2 tệp cùng lúc, khớp hạn mức phía máy chủ). */
    private volatile java.util.concurrent.ExecutorService blobExecutor;
    /** Luồng riêng dựng/gửi phong bì tin nhắn (không dùng chung với UI WS hay pullOffline). */
    private volatile java.util.concurrent.ExecutorService sendExec;

    /** Vé một lần cho kênh UI<->Core (upload/download tệp qua loopback). */
    private final FileTokens fileTokens = new FileTokens();
    /** Kho tệp trên đĩa (nhận/gửi) + metadata resume; null khi chưa bind. */
    private volatile LocalFileStore fileStore;
    private volatile FileLimits fileLimits = FileLimits.DEFAULT;

    public FileLimits fileLimits() {
        return fileLimits;
    }

    public void updateFileLimits(FileLimits limits) {
        if (limits != null) {
            this.fileLimits = limits;
        }
    }
    /** Bảo mật Origin/Host cho API cục bộ — dùng chung allowlist với UI WS. */
    private final UiWsServer.Security uiSecurity = UiWsServer.Security.fromEnv();

    public PeerCore(Identity identity, String serverUrl, String listenIp, int listenPort) {
        this.serverUrl = serverUrl;
        this.listenIp = listenIp;
        this.listenPort = listenPort;
        initIdentity(identity);
    }

    /**
     * Khởi tạo Peer Core ở trạng thái UNBOUND (chưa biết danh tính). Dùng cho cơ chế
     * tự động kích hoạt M3: Peer Core dựng UI WS ngay, chờ trình duyệt bind rồi mới
     * nạp kho khóa/đăng ký. Danh tính được gán qua {@link #bindIdentity(Identity)}.
     */
    public PeerCore(String serverUrl, String listenIp, int listenPort) {
        this.serverUrl = serverUrl;
        this.listenIp = listenIp;
        this.listenPort = listenPort;
    }

    /** Nạp kho phụ thuộc danh tính (keystore, offline DB, khoá định danh + ghim TOFU). */
    private void initIdentity(Identity id) {
        this.identity = id;
        this.keystorePath = E2eKeystore.defaultKeystorePath(id.userId());
        this.offlineStore = new OfflineStore(
                E2eKeystore.userDataDir(id.userId()).resolve("offline.db"));
        this.fileStore = new LocalFileStore(E2eKeystore.userDataDir(id.userId()).resolve("files"));
        try {
            // Khóa định danh Ed25519 bền vững theo user (TOFU): nạp lại nếu đã có, tạo mới nếu chưa.
            this.identityKey = new com.workchat.peer.offline.PeerIdentityStore(
                    com.workchat.peer.offline.PeerIdentityStore.defaultPath(id.userId())).loadOrCreate();
            this.tofuPins = new com.workchat.peer.offline.TofuPinStore(
                    com.workchat.peer.offline.TofuPinStore.defaultPath(id.userId()));
        } catch (Exception e) {
            throw new IllegalStateException("ed25519 init", e);
        }
    }

    /** True khi đã bind với một danh tính (kho khóa/offline sẵn sàng). */
    public boolean isBound() {
        return identity != null;
    }

    /**
     * Gán danh tính cho Peer Core lúc bind. Nếu đã bind cùng userId thì bỏ qua; nếu
     * danh tính khác thì nạp lại toàn bộ kho phụ thuộc. Không tự đăng ký/nối WS —
     * việc đó do CLI (PeerCoreCli) điều phối sau khi bind thành công.
     */
    public synchronized void bindIdentity(Identity id) {
        if (identity != null && identity.userId() == id.userId()) {
            return;
        }
        initIdentity(id);
    }

    /** Xoá danh tính, đưa Peer Core về UNBOUND (đã khoá E2E, đóng link trước đó). */
    public synchronized void clearIdentity() {
        this.identity = null;
        this.identityKey = null;
        this.tofuPins = null;
        this.offlineStore = null;
        this.fileStore = null;
        this.keystorePath = null;
        resetFileTransfers();
    }

    /** Đóng/bỏ mọi transfer tệp đang chạy (đổi tài khoản hoặc khoá). */
    private void resetFileTransfers() {
        for (SentFileV2 sf : sentFilesV2.values()) {
            sf.close();
        }
        sentFilesV2.clear();
        for (FileRxV2 rx : fileRxV2.values()) {
            try {
                rx.raf.close();
            } catch (IOException ignored) {
            }
        }
        fileRxV2.clear();
        sentFiles.clear();
        fileRx.clear();
        lastFileFromUser.clear();
        blobReceiving.clear();
        blobAttempts.clear();
        blobCancelled.clear();
        restoredSends = false;
    }

    public Identity identity() {
        return identity;
    }

    /** Khóa công khai định danh (base64 SPKI) để đăng ký với Tracker; rỗng khi UNBOUND. */
    public String identityPubB64() {
        KeyPair k = identityKey;
        return k == null ? "" : CryptoBox.edPubB64(k.getPublic());
    }

    /** Ký transcript bắt tay bằng khóa định danh. */
    byte[] signIdentity(byte[] msg) {
        try {
            return CryptoBox.signEd(identityKey.getPrivate(), msg);
        } catch (Exception e) {
            throw new IllegalStateException("ed25519 sign", e);
        }
    }

    /** Khóa định danh của peer do Tracker xác thực; null nếu chưa biết (→ từ chối kết nối). */
    String expectedIdPub(long userId) {
        return idPubByUser.get(userId);
    }

    /**
     * TOFU: đối chiếu khóa định danh Ed25519 của peer với khóa đã ghim lần đầu.
     * Trả true nếu khớp hoặc lần đầu thấy (đã ghim); false nếu KHÁC (nghi giả mạo) → từ chối kết nối.
     * Khi phát hiện thay đổi, phát frame {@code key_changed} cho UI cảnh báo.
     */
    boolean verifyTofuPin(long userId, String idPubB64) {
        com.workchat.peer.offline.TofuPinStore pins = tofuPins;
        if (pins == null) {
            return false;
        }
        com.workchat.peer.offline.TofuPinStore.Status st = pins.checkAndPin(userId, idPubB64);
        if (st == com.workchat.peer.offline.TofuPinStore.Status.CHANGED) {
            LinkDiag d = diag(userId);
            d.lastResult = "failed";
            d.lastFailReason = "tofu_mismatch";
            Map<String, Object> frame = new java.util.LinkedHashMap<>();
            frame.put("type", "peer_key_changed");
            frame.put("userId", userId);
            frame.put("keyChanged", true);
            notifyUi(frame);
            System.out.println("[peer] CẢNH BÁO TOFU: khóa định danh của user " + userId + " đã thay đổi");
            return false;
        }
        return true;
    }

    public int listenPort() {
        return listenPort;
    }

    // ---------- mesh: inbound + outbound ----------

    public com.workchat.peer.PeerServer startMesh() {
        com.workchat.peer.PeerServer server = new com.workchat.peer.PeerServer(this, listenIp, listenPort);
        Thread t = new Thread(() -> {
            try {
                server.run();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }, "mesh-accept");
        t.setDaemon(true);
        t.start();
        return server;
    }

    private Bootstrap outboundBootstrap() {
        Bootstrap b = outbound.get();
        if (b != null) {
            return b;
        }
        Bootstrap nb = new Bootstrap();
        nb.group(meshGroup)
                .channel(NioSocketChannel.class)
                .option(ChannelOption.TCP_NODELAY, true)
                .option(ChannelOption.WRITE_BUFFER_WATER_MARK, waterMark())
                .handler(new ChannelInitializer<SocketChannel>() {
                    @Override
                    protected void initChannel(SocketChannel ch) {
                        ch.pipeline().addLast(new LengthFieldBasedFrameDecoder(1 << 20, 0, 4, 0, 4));
                    }
                });
        if (outbound.compareAndSet(null, nb)) {
            return nb;
        }
        return outbound.get();
    }

    /** Ngưỡng backpressure cho kênh mesh: chạm cao thì ngừng bơm khối tới khi xuống thấp. */
    static WriteBufferWaterMark waterMark() {
        return new WriteBufferWaterMark(
                FileTransferConfig.WRITE_LOW_WATERMARK, FileTransferConfig.WRITE_HIGH_WATERMARK);
    }

    PeerLink connectOutbound(PeerEntry e) {        PeerLink existing = linksByUserId.get(e.userId());
        if (existing != null) {
            return existing;
        }
        Identity id = identity;
        if (id == null) {
            return null;
        }
        // Mở kết nối từ CẢ HAI phía (chỉ cần một chiều thành công); link trùng được giữ một
        // theo quy tắc ở onLinkReady. Trước đây chỉ bên userId nhỏ dial nên hỏng một chiều là mất link.
        PeerLink l = new PeerLink(this, true, e.userId());
        linksByUserId.put(e.userId(), l);
        LinkDiag d = diag(e.userId());
        d.lastAddress = e.ip() + ":" + e.port();
        d.lastAttemptAt = System.currentTimeMillis();
        d.lastResult = "connecting";
        outboundBootstrap().clone().handler(new ChannelInitializer<SocketChannel>() {
            @Override
            protected void initChannel(SocketChannel ch) {
                ch.pipeline().addLast(new LengthFieldBasedFrameDecoder(1 << 20, 0, 4, 0, 4));
                ch.pipeline().addLast(l);
            }
        }).connect(e.ip(), e.port()).addListener(f -> {
            if (f.isSuccess()) {
                d.lastResult = "connected";
            } else {
                PeerLink cur = linksByUserId.get(e.userId());
                if (cur == l) {
                    linksByUserId.remove(e.userId(), l);
                }
                Throwable cause = f.cause();
                String msg = cause == null ? "" : String.valueOf(cause.getMessage()).toLowerCase(java.util.Locale.ROOT);
                d.lastResult = "failed";
                d.lastFailReason = msg.contains("refus")
                        ? "connection_refused"
                        : msg.contains("timed out") || msg.contains("timeout")
                                ? "timeout"
                                : "connect_error";
            }
        });
        return l;
    }

    /** Lấy (tạo nếu cần) bản ghi chẩn đoán link cho một userId. */
    LinkDiag diag(long userId) {
        return linkDiag.computeIfAbsent(userId, k -> new LinkDiag());
    }

    public void startApi(int apiPort) throws IOException {
        this.apiPort = apiPort;
        apiServer = HttpServer.create(new InetSocketAddress("127.0.0.1", apiPort), 0);
        apiServer.createContext("/state", this::handleState);
        apiServer.createContext("/links", this::handleLinks);
        apiServer.createContext("/send", this::handleSend);
        apiServer.createContext("/stun", this::handleStun);
        apiServer.createContext("/seen", this::handleSeen);
        apiServer.createContext("/file", this::handleFile);
        apiServer.createContext("/files/upload", this::handleFileUpload);
        apiServer.createContext("/files", this::handleFileDownload);
        apiServer.createContext("/ping", ex -> reply(ex, 200, Json.write(Map.of("ok", true))));
        apiServer.start();
        System.out.println("[peer] API cục bộ (chẩn đoán): http://127.0.0.1:" + apiPort
                + "/state  |  http://127.0.0.1:" + apiPort + "/links");
    }

    public int apiPort() {
        return apiPort;
    }

    /**
     * Mở socket UDP data-plane, dò địa chỉ công khai qua STUN rồi chạy vòng nhận gói.
     * Cổng cục bộ = 0 nghĩa là để hệ điều hành chọn cổng ngẫu nhiên.
     */
    public void startUdp(int port, String stunHost, int stunPort) {
        // một máy chủ duy nhất (tương thích ngược)
        String spec = (stunHost == null || stunHost.isBlank()) ? null : stunHost + ":" + stunPort;
        startUdp(port, spec == null ? java.util.List.of() : java.util.List.of(spec));
    }

    /**
     * Mở socket UDP, chạy vòng nhận (nơi đọc socket duy nhất) rồi dò địa chỉ công khai qua STUN.
     */
    public void startUdp(int port, java.util.List<String> servers) {
        this.stunServers = servers == null ? java.util.List.of() : java.util.List.copyOf(servers);
        try {
            DatagramSocket s = new DatagramSocket(null);
            s.setReuseAddress(true);
            s.bind(new InetSocketAddress(port));
            this.udpSocket = s;
            this.udpPort = s.getLocalPort();
        } catch (Exception e) {
            System.out.println("[peer] UDP bind lỗi: " + e);
            return;
        }
        Thread t = new Thread(this::udpReceiveLoop, "udp-recv");
        t.setDaemon(true);
        t.start();
        udpScheduler = Executors.newSingleThreadScheduledExecutor((r) -> {
            Thread s = new Thread(r, "udp-tick");
            s.setDaemon(true);
            return s;
        });
        udpScheduler.scheduleWithFixedDelay(this::udpTick, 300, 300, TimeUnit.MILLISECONDS);
        if (!stunServers.isEmpty()) {
            discoverStun();
        }
    }

    /**
     * Thử lần lượt từng máy chủ STUN trong danh sách tới khi dò được địa chỉ công khai.
     * Trả về true nếu ít nhất một máy chủ phản hồi. Có thể gọi lại để dò mới (đổi mạng / đổi STUN).
     */
    public synchronized boolean discoverStun() {
        DatagramSocket s = udpSocket;
        if (s == null || s.isClosed()) {
            return false;
        }
        boolean any = false;
        for (String spec : stunServers) {
            String host = spec;
            int port = 3478;
            int colon = spec.lastIndexOf(':');
            if (colon > 0) {
                host = spec.substring(0, colon);
                try {
                    port = Integer.parseInt(spec.substring(colon + 1).trim());
                } catch (NumberFormatException e) {
                    port = 3478;
                }
            }
            StunClient.Mapped m = null;
            try {
                for (int attempt = 0; attempt < 3 && m == null; attempt++) {
                    byte[] txn = StunClient.newTxn();
                    java.util.concurrent.CompletableFuture<StunClient.Mapped> fut =
                            new java.util.concurrent.CompletableFuture<>();
                    pendingStunTxn = txn;
                    pendingStunFuture = fut;
                    try {
                        byte[] req = StunClient.bindingRequest(txn);
                        s.send(new DatagramPacket(req, req.length, InetAddress.getByName(host), port));
                        m = fut.get(800, TimeUnit.MILLISECONDS);
                    } catch (java.util.concurrent.TimeoutException te) {
                        // thử lại
                    } catch (Exception e) {
                        break;
                    } finally {
                        pendingStunTxn = null;
                        pendingStunFuture = null;
                    }
                }
            } catch (Exception e) {
                // bỏ qua máy chủ này
            }
            System.out.println("[peer] STUN " + spec + " -> " + (m == null ? "khong phan hoi" : m.ip() + ":" + m.port()));
            if (m != null) {
                this.udpPublicIp = m.ip();
                this.udpPublicPort = m.port();
                any = true;
                break;
            }
        }
        if (any) {
            reRegister();
        }
        return any;
    }

    /** Nếu datagram là phản hồi STUN khớp transaction đang chờ thì hoàn tất future, trả về true. */
    private boolean deliverStun(byte[] data, int len) {
        java.util.concurrent.CompletableFuture<StunClient.Mapped> fut = pendingStunFuture;
        byte[] txn = pendingStunTxn;
        if (fut == null || txn == null || fut.isDone()) {
            return false;
        }
        StunClient.Mapped m = StunClient.parse(data, len, txn);
        if (m == null) {
            return false;
        }
        return fut.complete(m);
    }

    /** Gắn token để có thể đăng ký lại endpoint với Tracker (sau khi đổi STUN lúc chạy). */
    public void attachToken(String token) {
        this.authToken = token;
    }

    /** Đăng ký lại endpoint hiện tại với Tracker để các peer nhận địa chỉ công khai mới. */
    public void reRegister() {
        String token = authToken;
        if (token == null || token.isBlank()) {
            return;
        }
        try {
            Map<String, Object> regReq = new java.util.HashMap<>();
            regReq.put("ip", listenIp);
            regReq.put("port", listenPort);
            regReq.put("pubkey", identityPubB64());
            regReq.put("udpPort", udpPort);
            regReq.put("udpPublicIp", udpPublicIp);
            regReq.put("udpPublicPort", udpPublicPort);
            java.net.http.HttpRequest req = java.net.http.HttpRequest.newBuilder()
                    .uri(java.net.URI.create(serverUrl + "/api/peer/register"))
                    .timeout(java.time.Duration.ofSeconds(10))
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Bearer " + authToken)
                    .POST(java.net.http.HttpRequest.BodyPublishers.ofString(Json.write(regReq)))
                    .build();
            java.net.http.HttpResponse<String> resp = java.net.http.HttpClient.newHttpClient()
                    .send(req, java.net.http.HttpResponse.BodyHandlers.ofString());
            System.out.println("[peer] đăng ký lại endpoint: " + resp.statusCode()
                    + " udp=" + udpPublicIp + ":" + udpPublicPort);
        } catch (Exception e) {
            System.out.println("[peer] đăng ký lại endpoint lỗi: " + e);
        }
    }

    public java.util.List<String> stunServers() {
        return stunServers;
    }

    public void setStunServers(java.util.List<String> servers) {
        this.stunServers = servers == null ? java.util.List.of() : java.util.List.copyOf(servers);
    }

    private void udpReceiveLoop() {
        byte[] buf = new byte[65536];
        while (true) {
            DatagramSocket s = udpSocket;
            if (s == null || s.isClosed()) {
                return;
            }
            try {
                DatagramPacket p = new DatagramPacket(buf, buf.length);
                s.receive(p);
                if (deliverStun(p.getData(), p.getLength())) {
                    continue;
                }
                onUdpPacket(p);
            } catch (Exception e) {
                if (udpSocket == null || udpSocket.isClosed()) {
                    return;
                }
            }
        }
    }

    /** Xử lý gói UDP tới: đục lỗ (punch/punch_ack), keepalive và dữ liệu ứng dụng (AES). */
    void onUdpPacket(DatagramPacket p) {
        byte[] d = p.getData();
        int len = p.getLength();
        if (len < 9) {
            udpReceived.incrementAndGet();
            return;
        }
        udpReceived.incrementAndGet();
        byte type = d[0];
        long uid = ByteBuffer.wrap(d, 1, 8).getLong();
        if (uid == identity.userId()) {
            return;
        }
        String host = p.getAddress().getHostAddress();
        int port = p.getPort();
        UdpState u = udpPeers.computeIfAbsent(uid, (k) -> new UdpState());
        u.lastRecv = System.currentTimeMillis();
        switch (type) {
            case UDP_PUNCH -> {
                markReachable(u, host, port, uid);
                sendUdp(host, port, UDP_PUNCH_ACK, null);
            }
            case UDP_KEEPALIVE -> {
                markReachable(u, host, port, uid);
                sendUdp(host, port, UDP_PUNCH_ACK, null);
            }
            case UDP_PUNCH_ACK -> markReachable(u, host, port, uid);
            case UDP_DATA -> handleUdpData(uid, d, len);
            default -> { }
        }
    }

    private void markReachable(UdpState u, String host, int port, long uid) {
        boolean was = u.reachable;
        u.reachable = true;
        u.failed = false;
        u.remoteHost = host;
        u.remotePort = port;
        if (!was) {
            System.out.println("[peer] UDP đục lỗ thành công với user " + uid + " qua " + host + ":" + port);
            notifyUdp(uid, true);
        }
    }

    /** Nhận frame ứng dụng qua UDP: giải mã bằng khóa phiên của link TCP rồi xử lý như bình thường. */
    private void handleUdpData(long uid, byte[] d, int len) {
        PeerLink link = linksByUserId.get(uid);
        if (link == null || !link.ready()) {
            return;
        }
        byte[] ct = Arrays.copyOfRange(d, 9, len);
        byte[] plain = link.decryptFromUdp(ct);
        if (plain == null) {
            return;
        }
        udpDataRecv.incrementAndGet();
        onPeerMessage(link, Json.readMap(new String(plain, StandardCharsets.UTF_8)));
    }

    /** Định kỳ đục lỗ / gửi keepalive cho mọi peer đã biết. */
    private void udpTick() {
        long now = System.currentTimeMillis();
        for (Map.Entry<Long, UdpState> en : udpPeers.entrySet()) {
            long uid = en.getKey();
            UdpState u = en.getValue();
            PeerEntry e = findPeer(uid);
            if (e == null) {
                continue;
            }
            if (u.reachable) {
                if (now - u.lastRecv > UDP_TIMEOUT_MS) {
                    u.reachable = false;
                    u.punchingUntil = now + PunchSchedule.WINDOW_MS;
                    u.punchStartedAt = now;
                    u.nextPunchAt = 0;
                    System.out.println("[peer] UDP mất kết nối user " + uid + " → đục lỗ lại");
                    notifyUdp(uid, false);
                } else if (System.currentTimeMillis() - u.lastRecv >= UDP_KEEPALIVE_MS) {
                    sendUdp(u.remoteHost, u.remotePort, UDP_KEEPALIVE, null);
                }
            } else if (!u.failed) {
                if (u.punchingUntil == 0) {
                    u.punchingUntil = now + PunchSchedule.WINDOW_MS;
                    u.punchStartedAt = now;
                }
                long nowMs = System.currentTimeMillis();
                if (nowMs < u.punchingUntil) {
                    if (nowMs >= u.nextPunchAt) {
                        punchPeer(e, PunchSchedule.phase(nowMs - u.punchStartedAt));
                        u.nextPunchAt = nowMs + UDP_PUNCH_INTERVAL_MS;
                    }
                } else {
                    u.failed = true;
                    System.out.println("[peer] UDP đục lỗ thất bại với user " + uid + " → cần Relay");
                    notifyUdp(uid, false);
                }
            }
        }
    }

    /**
     * Đục lỗ theo giai đoạn: LAN trước, sau đó tới địa chỉ công khai. Chỉ gửi UDP_PUNCH
     * tới các ứng viên thuộc giai đoạn hiện tại để tránh làm nhiễu/đốt thời gian.
     */
    private void punchPeer(PeerEntry e, PunchSchedule.Phase phase) {
        if (phase == PunchSchedule.Phase.GIVE_UP) {
            return;
        }
        boolean wantLan = phase == PunchSchedule.Phase.LAN;
        for (String cand : udpCandidates(e)) {
            int i = cand.lastIndexOf(':');
            if (i <= 0) {
                continue;
            }
            String hp = cand.substring(0, i);
            if (isPrivateIp(hp) != wantLan) {
                continue;
            }
            int pp = parsePort(cand.substring(i + 1));
            if (pp > 0) {
                sendUdp(hp, pp, UDP_PUNCH, null);
            }
        }
    }

    private static int parsePort(String s) {
        try {
            return Integer.parseInt(s.trim());
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static List<String> udpCandidates(PeerEntry e) {
        List<String> out = new ArrayList<>();
        if (e.udpPort() > 0 && e.ip() != null && !e.ip().isBlank() && !"0.0.0.0".equals(e.ip())) {
            out.add(e.ip() + ":" + e.udpPort());
        }
        if (e.udpPublicPort() > 0 && e.udpPublicIp() != null && !e.udpPublicIp().isBlank()
                && !"0.0.0.0".equals(e.udpPublicIp())) {
            out.add(e.udpPublicIp() + ":" + e.udpPublicPort());
        }
        return out.stream().distinct().toList();
    }

    /** Gửi gói UDP tới đích; payload có thể null. Gói luôn nhúng userId của peer gửi. */
    private void sendUdp(String host, int port, byte type, byte[] data) {
        DatagramSocket s = udpSocket;
        if (s == null || s.isClosed() || host == null || host.isBlank() || port <= 0) {
            return;
        }
        try {
            int len = 1 + 8 + (data == null ? 0 : data.length);
            ByteBuffer bb = ByteBuffer.allocate(len);
            bb.put(type);
            bb.putLong(identity.userId());
            if (data != null) {
                bb.put(data);
            }
            byte[] b = bb.array();
            s.send(new DatagramPacket(b, b.length, InetAddress.getByName(host), port));
            udpSent.incrementAndGet();
        } catch (Exception e) {
            // im lặng: gói UDP có thể mất
        }
    }

    private void notifyUdp(long uid, boolean reachable) {
        long roomId = 0;
        for (Map.Entry<Long, Map<Long, PeerEntry>> r : roomPeers.entrySet()) {
            if (r.getValue().containsKey(uid)) {
                roomId = r.getKey();
                break;
            }
        }
        String transport = reachable ? "udp" : (relayOnly ? "relay" : "tcp");
        notifyUi(Map.of(
                "type", "udp_state",
                "userId", uid,
                "roomId", roomId,
                "reachable", reachable,
                "transport", transport));
    }

    private PeerEntry findPeer(long uid) {
        for (Map<Long, PeerEntry> r : roomPeers.values()) {
            PeerEntry e = r.get(uid);
            if (e != null) {
                return e;
            }
        }
        return null;
    }

    public boolean udpReachable(long uid) {
        UdpState u = udpPeers.get(uid);
        return u != null && u.reachable;
    }

    public boolean udpFailed(long uid) {
        UdpState u = udpPeers.get(uid);
        return u != null && u.failed;
    }

    public int udpReachableCount() {
        int n = 0;
        for (UdpState u : udpPeers.values()) {
            if (u.reachable) {
                n++;
            }
        }
        return n;
    }

    public int udpPort() {
        return udpPort;
    }

    public String udpPublicIp() {
        return udpPublicIp;
    }

    public int udpPublicPort() {
        return udpPublicPort;
    }

    /**
     * Áp dụng kết quả mở cổng tự động (UPnP/NAT-PMP). Chỉ điền khi STUN chưa cho địa chỉ
     * công khai (không ghi đè giá trị thật đã đo), rồi đăng ký lại endpoint nếu có thay đổi.
     */
    public synchronized void onPortMapped(String externalIp, int udpExternalPort) {
        boolean changed = false;
        if (udpExternalPort > 0 && udpPublicPort == 0) {
            udpPublicPort = udpExternalPort;
            changed = true;
        }
        if (externalIp != null && !externalIp.isBlank()
                && (udpPublicIp == null || udpPublicIp.isBlank())) {
            udpPublicIp = externalIp;
            changed = true;
        }
        if (changed) {
            reRegister();
        }
    }

    private void handleState(HttpExchange ex) {
        List<Map<String, Object>> rooms = new ArrayList<>();
        for (Map.Entry<Long, Map<Long, PeerEntry>> r : roomPeers.entrySet()) {
            List<Map<String, Object>> peers = new ArrayList<>();
            for (PeerEntry e : r.getValue().values()) {
                PeerLink l = linksByUserId.get(e.userId());
                peers.add(Map.of(
                        "userId", e.userId(),
                        "username", e.username(),
                        "ip", e.ip(),
                        "port", e.port(),
                        "udpPort", e.udpPort(),
                        "udpPublicIp", e.udpPublicIp(),
                        "udpPublicPort", e.udpPublicPort(),
                        "udpReachable", udpReachable(e.userId()),
                        "connected", l != null && l.isActive() && l.ready()));
            }
            rooms.add(Map.of("roomId", r.getKey(), "peers", peers));
        }
        List<Map<String, Object>> links = new ArrayList<>();
        for (PeerLink l : linksByUserId.values()) {
            if (l.isActive()) {
                links.add(Map.of(
                        "userId", l.remoteId(),
                        "username", l.remoteUsername(),
                        "ready", l.ready(),
                        "initiator", l.initiator()));
            }
        }
        Identity id = identity;
        Map<String, Object> idJson = id == null
                ? Map.of("bound", false)
                : Map.of("bound", true, "userId", id.userId(), "username", id.username());
        reply(ex, 200, Json.write(Map.of(
                "identity", idJson,
                "idPub", identityPubB64(),
                "listenIp", listenIp,
                "listenPort", listenPort,
                "udp", Map.of(
                        "port", udpPort,
                        "publicIp", udpPublicIp,
                        "publicPort", udpPublicPort,
                        "received", udpReceived.get(),
                        "sent", udpSent.get(),
                        "dataSent", udpDataSent.get(),
                        "dataRecv", udpDataRecv.get(),
                        "relaySent", relaySent.get(),
                        "relayRecv", relayRecv.get(),
                        "reachable", udpPeers.values().stream().filter((u) -> u.reachable).count()),
                "stunServers", stunServers,
                "rooms", rooms,
                "links", links,
                "received", received,
                "seen", seenEvents)));
    }

    /**
     * Chẩn đoán kết nối (LỖI B): với mỗi thành viên của các phòng đang mở, cho biết trạng thái
     * link ({@code none|connecting|ready}, số khung còn chờ {@code pendingOutCount}), địa chỉ
     * Tracker cấp (ip:port + nguồn {@code lan|zerotier|public}), peer còn sống theo Tracker không,
     * và lần thử kết nối gần nhất (địa chỉ, thời điểm, kết quả, lý do thất bại dạng mã).
     * CHỈ chứa thông tin kết nối — KHÔNG có khóa/token/nội dung.
     */
    private void handleLinks(HttpExchange ex) {
        List<LocalNetworks.Iface> ifaces = LocalNetworks.scan();
        Identity id = identity;
        long me = id == null ? 0 : id.userId();
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map.Entry<Long, Map<Long, PeerEntry>> r : roomPeers.entrySet()) {
            for (PeerEntry e : r.getValue().values()) {
                if (e.userId() == me) {
                    continue;
                }
                PeerLink l = linksByUserId.get(e.userId());
                boolean active = l != null && l.isActive();
                boolean ready = l != null && l.ready();
                String linkState = ready ? "ready" : active ? "connecting" : "none";
                int pendingOut = l != null ? l.pendingCount() : 0;
                LinkDiag d = linkDiag.get(e.userId());
                Map<String, Object> row = new java.util.LinkedHashMap<>();
                row.put("roomId", r.getKey());
                row.put("userId", e.userId());
                row.put("name", e.username());
                row.put("linkState", linkState);
                row.put("pendingOutCount", pendingOut);
                row.put("trackerAlive", true);
                row.put("trackerAddress", e.ip() + ":" + e.port());
                row.put("trackerAddressSource", LocalNetworks.classify(e.ip(), ifaces));
                row.put("udpReachable", udpReachable(e.userId()));
                if (d != null) {
                    if (d.lastAddress != null) {
                        row.put("lastAttemptAddress", d.lastAddress);
                    }
                    row.put("lastAttemptAt", d.lastAttemptAt);
                    if (d.lastResult != null) {
                        row.put("lastResult", d.lastResult);
                    }
                    if (d.lastFailReason != null) {
                        row.put("lastFailReason", d.lastFailReason);
                    }
                }
                out.add(row);
            }
        }
        reply(ex, 200, Json.write(Map.of(
                "identity", id == null
                        ? Map.of("bound", false)
                        : Map.of("bound", true, "userId", me, "username", id.username()),
                "listenIp", listenIp,
                "listenPort", listenPort,
                "apiPort", apiPort,
                "links", out)));
    }

    private void handleSend(HttpExchange ex) {        if (!isBound()) {
            reply(ex, 409, Json.write(Map.of("error", "not_bound")));
            return;
        }
        Map<String, Object> b = Json.readMap(body(ex));
        Object rv = b.get("roomId");
        Object tv = b.get("text");
        if (!(rv instanceof Number rid) || !(tv instanceof String text)) {
            reply(ex, 400, Json.write(Map.of("error", "invalid_body")));
            return;
        }
        Object cv = b.get("clientId");
        String cid = cv instanceof String s && s.matches("^[0-9A-Za-z_-]{8,64}$") ? s : null;
        SendResult r = sendChat(rid.longValue(), text, cid);
        reply(ex, 200, Json.write(Map.of("ok", true, "sentTo", r.meshCount())));
    }

    private void handleSeen(HttpExchange ex) {
        if (!isBound()) {
            reply(ex, 409, Json.write(Map.of("error", "not_bound")));
            return;
        }
        Map<String, Object> b = Json.readMap(body(ex));
        Object rv = b.get("roomId");
        Object mv = b.get("messageId");
        if (!(rv instanceof Number rid) || !(mv instanceof String mid)) {
            reply(ex, 400, Json.write(Map.of("error", "invalid_body")));
            return;
        }
        int n = sendSeen(rid.longValue(), mid);
        reply(ex, 200, Json.write(Map.of("ok", true, "sentTo", n)));
    }

    /**
     * POST /stun  body JSON: {"servers": "stun.a:3478,stun.b:3478"} hoặc {"servers": ["...","..."]}.
     * Cập nhật danh sách máy chủ STUN rồi dò lại địa chỉ công khai + đăng ký lại endpoint.
     */
    private void handleStun(HttpExchange ex) {
        if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
            reply(ex, 405, Json.write(Map.of("error", "method")));
            return;
        }
        Map<String, Object> b = Json.readMap(body(ex));
        List<String> servers = new ArrayList<>();
        Object sv = b.get("servers");
        if (sv instanceof String str) {
            for (String part : str.split(",")) {
                String t = part.trim();
                if (!t.isEmpty() && !t.equalsIgnoreCase("off") && !t.equalsIgnoreCase("none")) {
                    servers.add(t);
                }
            }
        } else if (sv instanceof List<?> list) {
            for (Object o : list) {
                if (o != null) {
                    String t = o.toString().trim();
                    if (!t.isEmpty() && !t.equalsIgnoreCase("off") && !t.equalsIgnoreCase("none")) {
                        servers.add(t);
                    }
                }
            }
        } else {
            reply(ex, 400, Json.write(Map.of("error", "invalid_body")));
            return;
        }
        setStunServers(servers);
        boolean ok = false;
        if (udpSocket != null && !udpSocket.isClosed() && !servers.isEmpty()) {
            ok = discoverStun();
        }
        reply(ex, 200, Json.write(Map.of(
                "ok", true,
                "resolved", ok,
                "servers", stunServers,
                "publicIp", udpPublicIp,
                "publicPort", udpPublicPort)));
    }

    // ---------- file transfer: chia khối 32KB + đối soát SHA-256 ----------

    /** POST /file?roomId=&name=&mime=&sha256=&fileId=  — body là bytes thô của file. */
    private void handleFile(HttpExchange ex) {
        if (!isBound()) {
            reply(ex, 409, Json.write(Map.of("error", "not_bound")));
            return;
        }
        if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
            reply(ex, 405, Json.write(Map.of("error", "method")));
            return;
        }
        Map<String, String> q = query(ex);
        String roomRaw = q.get("roomId");
        if (roomRaw == null) {
            reply(ex, 400, Json.write(Map.of("error", "invalid_body")));
            return;
        }
        long roomId;
        try {
            roomId = Long.parseLong(roomRaw);
        } catch (NumberFormatException e) {
            reply(ex, 400, Json.write(Map.of("error", "invalid_room")));
            return;
        }
        String fileId = q.getOrDefault("fileId", "");
        if (fileId.isBlank()) {
            fileId = "F" + identity.userId() + "-" + UUID.randomUUID().toString().substring(0, 8);
        }
        String name = q.getOrDefault("name", "file.bin");
        String mime = q.getOrDefault("mime", "application/octet-stream");
        String sha = q.get("sha256");
        byte[] data;
        try {
            data = ex.getRequestBody().readAllBytes();
        } catch (IOException e) {
            reply(ex, 400, Json.write(Map.of("error", "read_body")));
            return;
        }
        String actual = sha256Hex(data);
        if (sha != null && !sha.isBlank() && !sha.equalsIgnoreCase(actual)) {
            reply(ex, 400, Json.write(Map.of("error", "bad_checksum", "sha256", actual)));
            return;
        }
        int to = sendFile(roomId, fileId, name, mime, data, actual);
        reply(ex, 200, Json.write(Map.of(
                "ok", true,
                "fileId", fileId,
                "size", data.length,
                "chunks", chunkCount(data.length),
                "sha256", actual,
                "sentTo", to)));
    }

    private static int chunkCount(int size) {
        return Math.max(1, (int) ((size + (long) FILE_CHUNK_SIZE - 1) / FILE_CHUNK_SIZE));
    }

    // ---------- kênh UI <-> Core cho tệp (loopback; vé dùng một lần) ----------

    /** Lệnh WS {@code file_begin}: cấp fileId + vé upload một lần, gắn user + Origin. */
    public Map<String, Object> beginFileUpload(long roomId, String name, String mime, long size,
                                               String origin, String reqId) {
        Identity id = identity;
        if (id == null) {
            return Map.of("type", "file_begin_err", "error", "not_bound", "reqId", reqId == null ? "" : reqId);
        }
        FileSecurity.NameCheck nc = FileSecurity.sanitizeName(name);
        if (!nc.ok()) {
            Map<String, Object> err = new LinkedHashMap<>();
            err.put("type", "file_begin_err");
            err.put("error", "invalid_name");
            err.put("message", nc.error());
            err.put("reqId", reqId == null ? "" : reqId);
            return err;
        }
        FileSecurity.ExtCheck ec = FileSecurity.validateExtension(nc.name());
        if (!ec.ok()) {
            Map<String, Object> err = new LinkedHashMap<>();
            err.put("type", "file_begin_err");
            err.put("error", "invalid_type");
            err.put("message", ec.error());
            err.put("reqId", reqId == null ? "" : reqId);
            return err;
        }
        if (size <= 0) {
            return Map.of("type", "file_begin_err", "error", "bad_size", "message", "File rỗng (0 byte)", "reqId", reqId == null ? "" : reqId);
        }
        long maxPossible = Math.max(fileLimits.maxDirectBytes(), fileLimits.maxBlobBytes());
        if (size > maxPossible) {
            Map<String, Object> err = new LinkedHashMap<>();
            err.put("type", "file_begin_err");
            err.put("error", "too_large");
            err.put("message", "File quá lớn (tối đa " + (maxPossible / (1024 * 1024)) + " MB)");
            err.put("maxBytes", maxPossible);
            err.put("reqId", reqId == null ? "" : reqId);
            return err;
        }
        String fileId = "F" + id.userId() + "-" + UUID.randomUUID().toString().substring(0, 8);
        FileTokens.Upload up = fileTokens.issueUpload(id.userId(), origin, fileId,
                nc.name(), mime == null ? "" : mime, size,
                System.currentTimeMillis());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("type", "file_begin_ok");
        out.put("fileId", fileId);
        out.put("uploadToken", up.token());
        out.put("roomId", roomId);
        out.put("maxBytes", FileTransferConfig.MAX_LOCAL_UPLOAD_BYTES);
        out.put("reqId", reqId == null ? "" : reqId);
        return out;
    }

    /** Lệnh WS {@code file_open}: cấp vé tải một lần cho mỗi lần mở tệp. */
    public Map<String, Object> openFileDownload(String fileId, String origin, String reqId) {
        Identity id = identity;
        LocalFileStore fs = fileStore;
        if (id == null || fs == null || fileId == null || !Files.exists(fs.data(fileId))) {
            return Map.of("type", "file_ticket_err", "error", "not_found", "reqId", reqId == null ? "" : reqId);
        }
        LocalFileStore.Meta meta = fs.readMeta(fileId);
        if (meta != null && "recalled".equalsIgnoreCase(meta.state())) {
            return Map.of("type", "file_ticket_err", "error", "recalled", "reqId", reqId == null ? "" : reqId);
        }
        FileTokens.Download d = fileTokens.issueDownload(id.userId(), origin, fileId,
                System.currentTimeMillis());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("type", "file_ticket_ok");
        out.put("fileId", fileId);
        out.put("ticket", d.token());
        out.put("apiPort", apiPort);
        out.put("reqId", reqId == null ? "" : reqId);
        return out;
    }

    /** POST /files/upload/&lt;token&gt;?sha256= — body là byte thô; ghi thẳng xuống đĩa. */
    private void handleFileUpload(HttpExchange ex) {
        try {
            if (preflight(ex)) {
                return;
            }
            if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
                reply(ex, 405, Json.write(Map.of("error", "method")));
                return;
            }
            String origin = header(ex, "Origin");
            if (!uiSecurity.originAllowed(origin)) {
                reply(ex, 403, Json.write(Map.of("error", "cross_origin")));
                return;
            }
            cors(ex, origin);
            if (!isBound()) {
                reply(ex, 409, Json.write(Map.of("error", "not_bound")));
                return;
            }
            String path = ex.getRequestURI().getPath();
            String token = path.substring("/files/upload/".length());
            String sha = query(ex).get("sha256");
            FileTokens.Upload up = fileTokens.takeUpload(token, identity.userId(), origin,
                    System.currentTimeMillis());
            if (up == null) {
                reply(ex, 403, Json.write(Map.of("error", "bad_ticket")));
                return;
            }
            LocalFileStore fs = fileStore;
            if (fs == null) {
                reply(ex, 503, Json.write(Map.of("error", "no_store")));
                return;
            }
            Path tmp = fs.temp(up.fileId());
            Files.createDirectories(tmp.getParent());
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            long total = 0;
            byte[] head = null;
            try (InputStream in = ex.getRequestBody(); OutputStream out = Files.newOutputStream(tmp)) {
                byte[] buf = new byte[64 * 1024];
                int r;
                while ((r = in.read(buf)) != -1) {
                    if (head == null && r > 0) {
                        head = java.util.Arrays.copyOf(buf, Math.min(r, 64));
                    }
                    total += r;
                    if (total > up.size()) {
                        out.close();
                        Files.deleteIfExists(tmp);
                        reply(ex, 400, Json.write(Map.of("error", "size_exceeded", "message", "Dung lượng thực tế vượt quá size khai báo")));
                        return;
                    }
                    md.update(buf, 0, r);
                    out.write(buf, 0, r);
                }
            }
            if (total != up.size()) {
                Files.deleteIfExists(tmp);
                reply(ex, 400, Json.write(Map.of("error", "size_mismatch")));
                return;
            }
            String actual = hex(md.digest());
            if (sha != null && !sha.isBlank() && !sha.equalsIgnoreCase(actual)) {
                Files.deleteIfExists(tmp);
                reply(ex, 400, Json.write(Map.of("error", "bad_checksum", "sha256", actual)));
                return;
            }
            FileSecurity.MagicCheck mc = FileSecurity.inspectMagicBytes(head, up.name());
            if (!mc.ok()) {
                Files.deleteIfExists(tmp);
                reply(ex, 400, Json.write(Map.of("error", "bad_content", "message", mc.error())));
                return;
            }
            Path data = fs.data(up.fileId());
            Files.createDirectories(data.getParent());
            Files.move(tmp, data, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            long roomId = roomIdOf(ex);
            int chunks = chunkCount((int) total);
            fs.writeMeta(new LocalFileStore.Meta(up.fileId(), roomId,
                    0L, up.name(), up.mime(), total, actual, FileTransferConfig.CHUNK_SIZE, chunks,
                    "sending", "out", System.currentTimeMillis()));
            fileDebug("upload", up.fileId(), Map.of("size", total));
            int to = startFileSend(roomId, up.fileId(), up.name(), up.mime(), data, total, actual);
            reply(ex, 200, Json.write(Map.of(
                    "ok", true,
                    "fileId", up.fileId(),
                    "size", total,
                    "chunks", chunks,
                    "sha256", actual,
                    "sentTo", to)));
        } catch (Exception e) {
            reply(ex, 500, Json.write(Map.of("error", "upload_failed")));
        }
    }

    /** GET /files/&lt;fileId&gt;?ticket= — trả byte thô của tệp (hỗ trợ Range đơn). */
    private void handleFileDownload(HttpExchange ex) {
        try {
            if (preflight(ex)) {
                return;
            }
            if (!"GET".equalsIgnoreCase(ex.getRequestMethod())) {
                reply(ex, 405, Json.write(Map.of("error", "method")));
                return;
            }
            String origin = header(ex, "Origin");
            if (!uiSecurity.originAllowed(origin)) {
                reply(ex, 403, Json.write(Map.of("error", "cross_origin")));
                return;
            }
            cors(ex, origin);
            if (!isBound()) {
                reply(ex, 409, Json.write(Map.of("error", "not_bound")));
                return;
            }
            String path = ex.getRequestURI().getPath();
            String fileId = path.substring("/files/".length());
            String ticket = query(ex).get("ticket");
            FileTokens.Download d = fileTokens.takeDownload(ticket, identity.userId(), origin,
                    System.currentTimeMillis());
            if (d == null) {
                reply(ex, 403, Json.write(Map.of("error", "bad_ticket")));
                return;
            }
            LocalFileStore fs = fileStore;
            Path data = fs == null ? null : fs.data(d.fileId());
            if (data == null || !Files.exists(data)) {
                reply(ex, 404, Json.write(Map.of("error", "not_found")));
                return;
            }
            LocalFileStore.Meta meta = fs.readMeta(d.fileId());
            if (meta != null && "recalled".equalsIgnoreCase(meta.state())) {
                reply(ex, 410, Json.write(Map.of("error", "recalled")));
                return;
            }
            long len = Files.size(data);
            String mime = meta == null || meta.mime() == null || meta.mime().isBlank()
                    ? "application/octet-stream" : meta.mime();
            ex.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
            ex.getResponseHeaders().set("Content-Disposition", FileSecurity.safeDispositionHeader(meta == null ? "file.bin" : meta.name()));
            long[] range = parseRange(header(ex, "Range"), len);
            if (range == null) {
                ex.getResponseHeaders().set("Content-Type", mime);
                ex.getResponseHeaders().set("Accept-Ranges", "bytes");
                ex.sendResponseHeaders(200, len);
            } else {
                long start = range[0];
                long end = range[1];
                long count = end - start + 1;
                ex.getResponseHeaders().set("Content-Type", mime);
                ex.getResponseHeaders().set("Accept-Ranges", "bytes");
                ex.getResponseHeaders().set("Content-Range", "bytes " + start + "-" + end + "/" + len);
                ex.sendResponseHeaders(206, count);
            }
            long start = range == null ? 0 : range[0];
            long count = range == null ? len : range[1] - range[0] + 1;
            try (InputStream in = Files.newInputStream(data); OutputStream out = ex.getResponseBody()) {
                if (start > 0) {
                    in.skipNBytes(start);
                }
                byte[] buf = new byte[64 * 1024];
                long remaining = count;
                while (remaining > 0) {
                    int r = in.read(buf, 0, (int) Math.min(buf.length, remaining));
                    if (r == -1) {
                        break;
                    }
                    out.write(buf, 0, r);
                    remaining -= r;
                }
            } catch (IOException ignored) {
                // client hủy tải — bỏ qua
            }
            ex.close();
        } catch (Exception e) {
            reply(ex, 500, Json.write(Map.of("error", "download_failed")));
        }
    }

    /** Bắt đầu gửi một tệp trên đĩa tới các peer trong phòng theo giao thức v2. */
    private int startFileSend(long roomId, String fileId, String name, String mime, Path data,
                              long size, String sha) {
        List<Long> targets = fileTargetIds(roomId);
        if (fileStore == null) {
            notifyFileState(roomId, fileId, "waiting", 0, sha);
            return 0;
        }
        int chunks = FileChunks.count(size, FileTransferConfig.CHUNK_SIZE);
        SentFileV2 sf = new SentFileV2(roomId, fileId, name, mime, size, sha,
                FileTransferConfig.CHUNK_SIZE, chunks, streamSeq.getAndIncrement(), data);
        for (Long uid : targets) {
            sf.acked.put(uid, new boolean[chunks]);
            sf.next.put(uid, 0);
        }
        sentFilesV2.put(fileId, sf);
        saveLocalFileRow(sf);
        if (targets.isEmpty()) {
            // Không có peer nào có địa chỉ: giữ tệp ngoài bảng theo dõi để không bị báo
            // "thất bại" sau TTL; chỉ chờ người nhận mở ứng dụng (blob/hộp thư).
            sentFilesV2.remove(fileId, sf);
            notifyFileState(roomId, fileId, "waiting", 0, sha);
            scheduleBlobFallback(sf);
            return 0;
        }
        activateOrQueue(sf);
        return targets.size();
    }

    /** Kích hoạt tệp nếu còn chỗ, ngược lại xếp hàng và thử lại sau 2 giây (A4/A6). */
    private void activateOrQueue(SentFileV2 sf) {
        if (sf.closed) {
            return;
        }
        if (overCapacity(sf)) {
            if (!sf.queued) {
                sf.queued = true;
                notifyFileState(sf.roomId, sf.fileId, "waiting", 0, sf.sha256);
                saveFileState(sf.roomId, sf.fileId, "queued", "out");
                fileDebug("queued", sf.fileId, Map.of("active", sentFilesV2.size()));
            }
            try {
                fileSched().schedule(() -> activateOrQueue(sf), 2000L, TimeUnit.MILLISECONDS);
            } catch (Exception ignored) {
                // scheduler đã đóng
            }
            return;
        }
        sf.queued = false;
        ensureChunkSums(sf);
        for (Long uid : sf.acked.keySet()) {
            sendFileOffer(sf, uid);
        }
        fileDebug("send-start", sf.fileId, Map.of("targets", sf.acked.size(), "chunks", sf.chunks));
        ensureRetryScheduler();
        scheduleBlobFallback(sf);
    }

    /** Trần tệp đồng thời: toàn bộ và theo từng người nhận (không tính tệp đang xếp hàng). */
    private boolean overCapacity(SentFileV2 sf) {
        int active = 0;
        Map<Long, Integer> perUser = new HashMap<>();
        for (SentFileV2 s : sentFilesV2.values()) {
            if (s == sf || s.closed || s.queued) {
                continue;
            }
            active++;
            for (Long uid : s.acked.keySet()) {
                perUser.merge(uid, 1, Integer::sum);
            }
        }
        if (active >= FileTransferConfig.MAX_FILES_TOTAL) {
            return true;
        }
        for (Long uid : sf.acked.keySet()) {
            if (perUser.getOrDefault(uid, 0) >= FileTransferConfig.MAX_FILES_PER_RECIPIENT) {
                return true;
            }
        }
        return false;
    }

    /** Ghi lại tệp đã gửi vào lịch sử cục bộ để mở lại được sau khi khởi động. */
    private void saveLocalFileRow(SentFileV2 sf) {
        try {
            LocalFileStore fs = fileStore;
            if (fs != null) {
                fs.writeMeta(new LocalFileStore.Meta(sf.fileId, sf.roomId, 0L, sf.name, sf.mime, sf.size,
                        sf.sha256, sf.chunkSize, sf.chunks, "sending", "out", System.currentTimeMillis()));
            }
            OfflineStore os = offlineStore;
            if (os != null) {
                os.saveLocal(new OfflineStore.LocalMsg("file:" + sf.fileId, sf.roomId, identity.userId(),
                        "file", MediaRef.local(sf.fileId, sf.name, sf.mime, sf.size, sf.sha256).toJson(),
                        sf.createdAt, "out", "stored"));
            }
        } catch (Exception e) {
            fileDebug("local-row", sf.fileId, Map.of("err", String.valueOf(e.getMessage())));
        }
    }

    /** Sau một nhịp chờ link trực tiếp, tệp nhỏ chưa tới đích sẽ đi đường blob qua Tracker. */
    private void scheduleBlobFallback(SentFileV2 sf) {
        if (sf.size > FileTransferConfig.MAX_BLOB_BYTES) {
            return;
        }
        try {
            fileSched().schedule(() -> maybeBlobFallback(sf),
                    FileTransferConfig.DIRECT_LINK_WAIT_MS, TimeUnit.MILLISECONDS);
        } catch (Exception ignored) {
            // scheduler đã đóng
        }
    }

    private void sendFileOffer(SentFileV2 sf, long uid) {
        PeerLink link = linksByUserId.get(uid);
        Map<String, Object> offer = new HashMap<>();
        offer.put("t", "file_offer");
        offer.put("proto", FileTransferConfig.PROTO_V2);
        offer.put("roomId", sf.roomId);
        offer.put("fileId", sf.fileId);
        offer.put("streamId", sf.streamId);
        offer.put("name", sf.name);
        offer.put("mime", sf.mime);
        offer.put("size", sf.size);
        offer.put("sha256", sf.sha256);
        offer.put("chunkSize", sf.chunkSize);
        offer.put("chunks", sf.chunks);
        byte[][] sums = sf.sums;
        if (sums != null) {
            offer.put("sums", ChunkSums.encode(sums));
        }
        if (link != null && link.isActive()) {
            link.send(offer);
        } else {
            // Chưa có link: thử dial, đồng thời để Relay/hộp thư xử lý ở bước A3.
            PeerEntry e = roomPeers.getOrDefault(sf.roomId, Map.of()).get(uid);
            if (e != null) {
                PeerLink l = connectOutbound(e);
                if (l != null) {
                    l.send(offer);
                }
            }
        }
    }

    /** Đọc tối đa {@code WINDOW_CHUNKS} khối/lượt, tôn trọng backpressure rồi hẹn lượt kế. */
    private void pumpFile(SentFileV2 sf, long uid) {
        if (sf.closed || sf.paused) {
            return;
        }
        PeerLink link = linksByUserId.get(uid);
        if (link == null || !link.isActive()) {
            schedulePump(sf, uid, 500L);
            return;
        }
        boolean[] acked = sf.acked.get(uid);
        if (acked == null) {
            return;
        }
        int seq = sf.next.getOrDefault(uid, 0);
        int sent = 0;
        try (java.nio.channels.FileChannel fc = java.nio.channels.FileChannel.open(sf.path)) {
            while (seq < sf.chunks) {
                if (sf.closed || sf.paused) {
                    return;
                }
                if (!link.isActive()) {
                    schedulePump(sf, uid, 500L);
                    return;
                }
                if (!link.canSendChunk() || sent >= sf.window) {
                    sf.next.put(uid, seq);
                    schedulePump(sf, uid, sent >= sf.window ? 30L : 100L);
                    return;
                }
                if (acked[seq]) {
                    seq++;
                    continue;
                }
                long off = (long) seq * sf.chunkSize;
                int len = (int) Math.min(sf.chunkSize, sf.size - off);
                if (len <= 0) {
                    seq++;
                    continue;
                }
                byte[] chunk = readAt(fc, off, len);
                if (chunk.length != len) {
                    sf.next.put(uid, seq);
                    schedulePump(sf, uid, 1000L);
                    return;
                }
                link.sendBytes(FileChunkFrame.encode(sf.streamId, seq, chunk, 0, chunk.length));
                seq++;
                sent++;
            }
            sf.next.put(uid, seq);
            sf.lastActivityAt = System.currentTimeMillis();
        } catch (IOException e) {
            sf.next.put(uid, seq);
            schedulePump(sf, uid, 1000L);
        }
    }

    private void schedulePump(SentFileV2 sf, long uid, long delayMs) {
        if (sf.closed) {
            return;
        }
        try {
            fileSched().schedule(() -> {
                try {
                    pumpFile(sf, uid);
                } catch (Exception ignored) {
                    // vòng nền: không để lỗi làm chết scheduler
                }
            }, delayMs, TimeUnit.MILLISECONDS);
        } catch (Exception ignored) {
            // scheduler đã đóng
        }
    }

    private ScheduledExecutorService fileSched() {
        ScheduledExecutorService s = fileScheduler;
        if (s == null) {
            synchronized (this) {
                if (fileScheduler == null) {
                    fileScheduler = Executors.newSingleThreadScheduledExecutor(r -> {
                        Thread t = new Thread(r, "peer-file");
                        t.setDaemon(true);
                        return t;
                    });
                }
                s = fileScheduler;
            }
        }
        return s;
    }

    private static byte[] readAt(java.nio.channels.FileChannel fc, long off, int len) throws IOException {
        ByteBuffer bb = ByteBuffer.allocate(len);
        long pos = off;
        while (bb.hasRemaining()) {
            int r = fc.read(bb, pos);
            if (r < 0) {
                break;
            }
            pos += r;
        }
        byte[] out = new byte[bb.position()];
        System.arraycopy(bb.array(), 0, out, 0, out.length);
        return out;
    }

    /** Bên nhận báo đã sẵn sàng + danh sách khối đã có → gửi phần còn thiếu. */
    private void handleFileAccept(Map<String, Object> m, long from) {
        String fileId = str(m, "fileId");
        SentFileV2 sf = fileId == null ? null : sentFilesV2.get(fileId);
        if (sf == null || !sf.acked.containsKey(from)) {
            return;
        }
        boolean[] acked = sf.acked.get(from);
        Object seqs = m.get("have");
        if (seqs instanceof List<?> list) {
            for (Object o : list) {
                if (o instanceof Number n) {
                    int s = n.intValue();
                    if (s >= 0 && s < acked.length) {
                        acked[s] = true;
                    }
                }
            }
        }
        sf.accepted.add(from);
        sf.paused = false;
        sf.backoffMs = FileTransferConfig.RETRY_MIN_MS;
        sf.lastActivityAt = System.currentTimeMillis();
        sf.next.put(from, 0);
        pumpFile(sf, from);
    }

    /** Bên nhận báo lỗi/không nhận (hết chỗ, sai định dạng...). */
    private void handleFileReject(Map<String, Object> m, long from) {
        String fileId = str(m, "fileId");
        SentFileV2 sf = fileId == null ? null : sentFilesV2.get(fileId);
        if (sf == null) {
            return;
        }
        sf.rejected.add(from);
        sf.finished.add(from);
        notifyFileState(sf.roomId, sf.fileId, "sending", sf.accepted.size(), sf.sha256,
                false, sf.acked.size(), recipientStates(sf));
        checkSentComplete(sf);
    }

    /** Bên nhận xác nhận đã ghép xong + SHA thực nhận. */
    private void handleFileDoneV2(Map<String, Object> m, long from) {
        String fileId = str(m, "fileId");
        SentFileV2 sf = fileId == null ? null : sentFilesV2.get(fileId);
        if (sf == null) {
            return;
        }
        String actual = str(m, "sha256");
        boolean ok = !Boolean.FALSE.equals(m.get("ok"))
                && (sf.sha256 == null || sf.sha256.isBlank()
                        || (actual != null && actual.equalsIgnoreCase(sf.sha256)));
        sf.lastActivityAt = System.currentTimeMillis();
        sf.finished.add(from);
        if (!ok) {
            failSentFile(sf, "BAD_CHECKSUM");
            return;
        }
        checkSentComplete(sf);
    }

    /** ACK v2 cho một khối: đánh dấu + gia hạn "còn tiến triển" rồi mời bơm tiếp. */
    private void handleFileAckV2(Map<String, Object> m, long from) {
        String fileId = str(m, "fileId");
        SentFileV2 sf = fileId == null ? null : sentFilesV2.get(fileId);
        if (sf == null) {
            return;
        }
        Object seqO = m.get("seq");
        if (!(seqO instanceof Number seqN)) {
            return;
        }
        boolean[] acked = sf.acked.get(from);
        int seq = seqN.intValue();
        if (acked == null) {
            return;
        }
        if (seq >= 0 && seq < acked.length) {
            acked[seq] = true;
        }
        if (seq % 16 == 0) {
            int done = 0;
            for (boolean b : acked) {
                if (b) {
                    done++;
                }
            }
            int pct = acked.length == 0 ? 100 : (int) (100L * done / acked.length);
            if (pct / 10 > sf.loggedPct / 10) {
                sf.loggedPct = pct;
                fileDebug("progress", sf.fileId, Map.of("pct", pct, "route", "direct"));
            }
        }
        sf.lastActivityAt = System.currentTimeMillis();
        sf.paused = false;
        // ACK đều -> nới cửa sổ dần và hạ backoff về mức nhỏ nhất
        sf.window = RetryPacing.grow(sf.window);
        sf.backoffMs = FileTransferConfig.RETRY_MIN_MS;
        if (seq < 0 || seq >= acked.length) {
            return;
        }
        schedulePump(sf, from, 20L);
    }

    /** Bên nhận báo một khối hỏng: đánh dấu chưa ACK để bơm lại đúng khối đó. */
    private void handleFileNack(Map<String, Object> m, long from) {
        String fileId = str(m, "fileId");
        SentFileV2 sf = fileId == null ? null : sentFilesV2.get(fileId);
        if (sf == null) {
            return;
        }
        boolean[] acked = sf.acked.get(from);
        Object seqO = m.get("seq");
        if (acked == null || !(seqO instanceof Number seqN)) {
            return;
        }
        int seq = seqN.intValue();
        if (seq < 0 || seq >= acked.length) {
            return;
        }
        Map<Integer, Integer> counts = sf.resends.computeIfAbsent(from, k -> new ConcurrentHashMap<>());
        int n = counts.merge(seq, 1, Integer::sum);
        if (n > FileTransferConfig.MAX_RESEND_PER_CHUNK * 4) {
            failSentFile(sf, "BAD_CHECKSUM");
            return;
        }
        acked[seq] = false;
        sf.lastActivityAt = System.currentTimeMillis();
        sf.paused = false;
        sf.next.put(from, 0);
        schedulePump(sf, from, 10L);
    }

    /** Phía bên kia hủy: dừng nhận (xóa tệp tạm) hoặc bỏ người nhận đó khỏi danh sách gửi. */
    private void handleFileCancel(Map<String, Object> m, long from) {
        String fileId = str(m, "fileId");
        if (fileId == null) {
            return;
        }
        for (FileRxV2 rx : fileRxV2.values()) {
            if (fileId.equals(rx.fileId) && rx.fromUserId == from) {
                rejectRx(rx, "cancelled");
                return;
            }
        }
        SentFileV2 sf = sentFilesV2.get(fileId);
        if (sf != null) {
            sf.accepted.remove(from);
            sf.acked.remove(from);
            sf.finished.add(from);
            sf.rejected.add(from);
            checkSentComplete(sf);
            fileDebug("cancel-peer", fileId, Map.of("from", from));
        }
    }

    /** Hủy tệp đang gửi hoặc đang nhận; gửi `file_cancel` cho phía bên kia. */
    public Map<String, Object> cancelFile(String fileId) {
        Map<String, Object> res = new HashMap<>();
        res.put("type", "file_cmd_ok");
        res.put("fileId", fileId == null ? "" : fileId);
        res.put("state", "cancelled");
        if (fileId == null || fileId.isBlank()) {
            res.put("type", "file_cmd_err");
            res.put("error", "bad_id");
            return res;
        }
        SentFileV2 sf = sentFilesV2.remove(fileId);
        if (sf != null) {
            sf.close();
            Map<String, Object> c = new HashMap<>();
            c.put("t", "file_cancel");
            c.put("fileId", fileId);
            c.put("roomId", sf.roomId);
            c.put("streamId", sf.streamId);
            for (Long uid : sf.acked.keySet()) {
                PeerLink link = linksByUserId.get(uid);
                if (link != null) {
                    link.send(c);
                }
            }
            saveFileState(sf.roomId, fileId, "cancelled", "out");
            notifyFileState(sf.roomId, fileId, "cancelled", 0, sf.sha256);
            fileDebug("cancel-out", fileId, Map.of());
            return res;
        }
        for (FileRxV2 rx : fileRxV2.values()) {
            if (fileId.equals(rx.fileId)) {
                rejectRx(rx, "cancelled");
                fileDebug("cancel-in", fileId, Map.of());
                return res;
            }
        }
        blobCancelled.add(fileId);
        return res;
    }

    /** Gửi lại một tệp đã hủy/lỗi từ dữ liệu còn trên đĩa (cùng fileId, không tạo bản trùng). */
    public Map<String, Object> retryFile(String fileId) {
        Map<String, Object> res = new HashMap<>();
        res.put("type", "file_cmd_ok");
        res.put("fileId", fileId == null ? "" : fileId);
        res.put("state", "sending");
        LocalFileStore fs = fileStore;
        LocalFileStore.Meta meta = fs == null || fileId == null ? null : fs.readMeta(fileId);
        Path data = fs == null || fileId == null ? null : fs.data(fileId);
        if (meta == null || data == null || !Files.exists(data) || "in".equals(meta.direction())) {
            res.put("type", "file_cmd_err");
            res.put("error", "not_found");
            return res;
        }
        blobCancelled.remove(fileId);
        int targets = startFileSend(meta.roomId(), fileId, meta.name(), meta.mime(), data,
                meta.size(), meta.sha256());
        res.put("targets", targets);
        return res;
    }

    private void saveFileState(long roomId, String fileId, String state, String direction) {
        LocalFileStore fs = fileStore;
        LocalFileStore.Meta old = fs == null ? null : fs.readMeta(fileId);
        if (fs == null || old == null) {
            return;
        }
        try {
            fs.writeMeta(new LocalFileStore.Meta(old.fileId(), roomId, old.peerUserId(), old.name(),
                    old.mime(), old.size(), old.sha256(), old.chunkSize(), old.chunks(), state,
                    direction, System.currentTimeMillis()));
        } catch (Exception ignored) {
            // chỉ là metadata hiển thị
        }
    }

    private void checkSentComplete(SentFileV2 sf) {        if (!sf.finished.containsAll(sf.acked.keySet())) {
            return;
        }
        if (sentFilesV2.remove(sf.fileId, sf)) {
            sf.close();
            if (sf.rejected.size() == sf.acked.size()) {
                notifyFileState(sf.roomId, sf.fileId, "failed", sf.rejected.size(), sf.sha256,
                        false, sf.acked.size(), recipientStates(sf));
                saveFileState(sf.roomId, sf.fileId, "failed", "out");
            } else {
                notifyFileState(sf.roomId, sf.fileId, "sent", sf.acked.size(), sf.sha256,
                        false, sf.acked.size(), recipientStates(sf));
                saveFileState(sf.roomId, sf.fileId, "sent", "out");
            }
            fileDebug("send-done", sf.fileId, Map.of("route", "direct"));
        }
    }

    private void failSentFile(SentFileV2 sf, String code) {
        if (sentFilesV2.remove(sf.fileId, sf)) {
            sf.close();
            notifyFileState(sf.roomId, sf.fileId, "failed", 0, sf.sha256);
        }
        saveFileState(sf.roomId, sf.fileId, "failed", "out");
        fileDebug("send-fail", sf.fileId, Map.of("code", code));
    }

    /** Báo UI trạng thái của tệp ĐANG GỬI (không phải tệp nhận). */
    private void notifyFileState(long roomId, String fileId, String state, int sentTo, String sha) {
        notifyFileState(roomId, fileId, state, sentTo, sha, false, 0, List.of());
    }

    private void notifyFileState(long roomId, String fileId, String state, int sentTo, String sha,
                                 boolean weak, int total, List<Map<String, Object>> recipients) {
        Map<String, Object> f = new HashMap<>();
        f.put("type", "file_state");
        f.put("roomId", roomId);
        f.put("fileId", fileId);
        f.put("state", state);
        f.put("sentTo", sentTo);
        f.put("total", total);
        f.put("weak", weak);
        f.put("recipients", recipients);
        f.put("sha256", sha == null ? "" : sha);
        notifyUi(f);
    }

    /** Trạng thái từng người nhận của một tệp nhóm (A6: không gộp thành một trạng thái chung). */
    private static List<Map<String, Object>> recipientStates(SentFileV2 sf) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Long uid : sf.acked.keySet()) {
            String st;
            if (sf.rejected.contains(uid)) {
                st = "rejected";
            } else if (sf.finished.contains(uid)) {
                st = "sent";
            } else if (sf.paused) {
                st = "paused";
            } else if (sf.accepted.contains(uid)) {
                st = "sending";
            } else {
                st = "waiting";
            }
            out.add(Map.of("userId", uid, "state", st));
        }
        return out;
    }

    /** Nhận offer v2: mở phần tạm trên đĩa, trả danh sách khối đã có (resume). */
    private void handleFileOffer(PeerLink link, Map<String, Object> m, long from, String fromName) {
        LocalFileStore fs = fileStore;
        String fileId = str(m, "fileId");
        Object sidO = m.get("streamId");
        Object sizeO = m.get("size");
        Object chunksO = m.get("chunks");
        if (fs == null || fileId == null || !(sidO instanceof Number sidN)
                || !(sizeO instanceof Number sizeN) || !(chunksO instanceof Number chunksN)) {
            return;
        }
        int streamId = sidN.intValue();
        long size = sizeN.longValue();
        int chunks = chunksN.intValue();
        if (streamId <= 0 || size <= 0 || chunks <= 0 || chunks > 1_000_000) {
            return;
        }
        String rawName = str(m, "name");
        FileSecurity.NameCheck nc = FileSecurity.sanitizeName(rawName);
        if (!nc.ok()) {
            Map<String, Object> rej = new HashMap<>();
            rej.put("t", "file_reject");
            rej.put("roomId", m.get("roomId") instanceof Number r ? r.longValue() : 0L);
            rej.put("fileId", fileId);
            rej.put("code", "invalid_name");
            link.send(rej);
            return;
        }
        FileSecurity.ExtCheck ec = FileSecurity.validateExtension(nc.name());
        if (!ec.ok()) {
            Map<String, Object> rej = new HashMap<>();
            rej.put("t", "file_reject");
            rej.put("roomId", m.get("roomId") instanceof Number r ? r.longValue() : 0L);
            rej.put("fileId", fileId);
            rej.put("code", "invalid_type");
            link.send(rej);
            return;
        }
        if (size > fileLimits.maxDirectBytes()) {
            Map<String, Object> rej = new HashMap<>();
            rej.put("t", "file_reject");
            rej.put("roomId", m.get("roomId") instanceof Number r ? r.longValue() : 0L);
            rej.put("fileId", fileId);
            rej.put("code", "too_large");
            link.send(rej);
            return;
        }
        if (blobReceiving.contains(fileId)) {
            // Blob đang về cùng tệp — bỏ qua offer để không hai luồng cùng ghi một tệp tạm.
            return;
        }
        try {
            Path probe = fs.temp(fileId);
            Files.createDirectories(probe.getParent());
            long usable = Files.getFileStore(probe.getParent()).getUsableSpace();
            if (usable > 0 && usable < size + 64L * 1024 * 1024) {
                Map<String, Object> rej = new HashMap<>();
                rej.put("t", "file_reject");
                rej.put("roomId", m.get("roomId") instanceof Number r ? r.longValue() : 0L);
                rej.put("fileId", fileId);
                rej.put("code", "no_space");
                link.send(rej);
                Map<String, Object> out = new HashMap<>();
                out.put("type", "file");
                out.put("roomId", rej.get("roomId"));
                out.put("fileId", fileId);
                out.put("name", str(m, "name"));
                out.put("mime", str(m, "mime"));
                out.put("size", size);
                out.put("fromUserId", from);
                out.put("ok", false);
                out.put("state", "failed");
                out.put("code", "no_space");
                out.put("direction", "in");
                notifyUi(out);
                return;
            }
        } catch (Exception ignored) {
            // không đọc được dung lượng: cứ thử nhận, lỗi ghi sẽ được báo sau
        }
        int chunkSize = m.get("chunkSize") instanceof Number cs && cs.intValue() > 0
                ? cs.intValue() : FileTransferConfig.CHUNK_SIZE;
        long roomId = m.get("roomId") instanceof Number r ? r.longValue() : 0L;
        String sha = str(m, "sha256");
        byte[][] sums = ChunkSums.parse(m.get("sums"), chunks);
        String key = from + ":" + streamId;
        FileRxV2 rx = fileRxV2.get(key);
        try {
            if (rx == null) {
                Path part = fs.temp(fileId);
                Files.createDirectories(part.getParent());
                boolean[] have = new boolean[chunks];
                if (Files.exists(part)) {
                    boolean[] saved = fs.readHave(fileId, chunks);
                    System.arraycopy(saved, 0, have, 0, Math.min(saved.length, chunks));
                }
                java.io.RandomAccessFile raf = new java.io.RandomAccessFile(part.toFile(), "rw");
                rx = new FileRxV2(roomId, from, fileId, streamId, str(m, "name"),
                        str(m, "mime") == null ? "" : str(m, "mime"), size, sha,
                        chunkSize, chunks, part, have, sums, raf);
                fileRxV2.put(key, rx);
                fs.writeMeta(new LocalFileStore.Meta(fileId, roomId, from, rx.name, rx.mime,
                        size, sha, chunkSize, chunks, "receiving", "in", System.currentTimeMillis()));
                fs.writeHave(fileId, have);
            }
            Map<String, Object> accept = new HashMap<>();
            accept.put("t", "file_accept");
            accept.put("proto", FileTransferConfig.PROTO_V2);
            accept.put("roomId", rx.roomId);
            accept.put("fileId", fileId);
            accept.put("streamId", streamId);
            List<Integer> have = new ArrayList<>();
            synchronized (rx) {
                for (int i = 0; i < rx.have.length; i++) {
                    if (rx.have[i]) {
                        have.add(i);
                    }
                }
            }
            accept.put("have", have);
            link.send(accept);
            fileDebug("rx-offer", fileId, Map.of("from", from, "chunks", chunks));
        } catch (IOException e) {
            Map<String, Object> rej = new HashMap<>();
            rej.put("t", "file_reject");
            rej.put("roomId", roomId);
            rej.put("fileId", fileId);
            rej.put("streamId", streamId);
            rej.put("reason", "io");
            link.send(rej);
        }
    }

    /** Nhận một khối v2: ghi đúng offset trên đĩa; ACK theo lô; xong thì kiểm SHA. */
    private void onFileChunkV2(PeerLink link, byte[] data) {
        FileChunkFrame.Decoded d = FileChunkFrame.decode(data, data.length);
        if (d == null) {
            return;
        }
        long from = link.remoteId();
        FileRxV2 rx = fileRxV2.get(from + ":" + d.streamId());
        if (rx == null || d.seq() >= rx.chunks) {
            return;
        }
        int seq = d.seq();
        long off = (long) seq * rx.chunkSize;
        int want = (int) Math.min(rx.chunkSize, rx.size - off);
        if (want <= 0) {
            return;
        }
        if (d.data().length > want) {
            // vượt kích thước khai báo -> hủy rõ ràng, không ghi quá đĩa
            rejectRx(rx, "BAD_SIZE");
            return;
        }
        if (d.data().length != want) {
            return;
        }
        byte[][] sums = rx.sums;
        if (sums != null && !ChunkSums.matches(sums[seq], d.data())) {
            nackChunk(link, rx, seq);
            return;
        }
        boolean isNew = false;
        synchronized (rx) {
            if (!rx.have[seq]) {
                try {
                    rx.raf.getChannel().write(ByteBuffer.wrap(d.data()), off);
                    rx.have[seq] = true;
                    rx.received.incrementAndGet();
                    isNew = true;
                } catch (IOException e) {
                    return;
                }
            }
        }
        if (!isNew) {
            return;
        }
        rx.lastAckAt = System.currentTimeMillis();
        int pending = ++rx.ackPending;
        if (rx.received.get() == rx.chunks) {
            finishFileV2(link, rx);
            return;
        }
        // Lưu bản đồ khối định kỳ để resume được sau khi Core khởi động lại.
        if (rx.received.get() % 128 == 0) {
            LocalFileStore fs = fileStore;
            if (fs != null) {
                synchronized (rx) {
                    fs.writeHave(rx.fileId, rx.have);
                }
            }
        }
        if (pending >= 16) {
            rx.ackPending = 0;
            Map<String, Object> ack = new HashMap<>();
            ack.put("t", "file_ack");
            ack.put("roomId", rx.roomId);
            ack.put("fileId", rx.fileId);
            ack.put("streamId", rx.streamId);
            ack.put("seq", seq);
            link.send(ack);
        }
    }

    /** Khối hỏng: yêu cầu gửi lại đúng khối đó, tối đa MAX_RESEND_PER_CHUNK lần rồi hủy. */
    private void nackChunk(PeerLink link, FileRxV2 rx, int seq) {
        int n;
        synchronized (rx) {
            n = ++rx.nackCount[seq];
        }
        if (n > FileTransferConfig.MAX_RESEND_PER_CHUNK) {
            rejectRx(rx, "BAD_CHECKSUM");
            return;
        }
        Map<String, Object> nack = new HashMap<>();
        nack.put("t", "file_nack");
        nack.put("roomId", rx.roomId);
        nack.put("fileId", rx.fileId);
        nack.put("streamId", rx.streamId);
        nack.put("seq", seq);
        link.send(nack);
        fileDebug("rx-nack", rx.fileId, Map.of("seq", seq, "try", n));
    }

    /** Người nhận từ chối hẳn tệp (hỏng quá số lần, hết chỗ, vượt kích thước). */
    private void rejectRx(FileRxV2 rx, String code) {
        fileRxV2.remove(rx.fromUserId + ":" + rx.streamId, rx);
        try {
            synchronized (rx) {
                rx.raf.close();
            }
        } catch (IOException ignored) {
        }
        try {
            Files.deleteIfExists(rx.part);
        } catch (IOException ignored) {
        }
        Map<String, Object> rej = new HashMap<>();
        rej.put("t", "file_reject");
        rej.put("roomId", rx.roomId);
        rej.put("fileId", rx.fileId);
        rej.put("code", code);
        PeerLink link = linksByUserId.get(rx.fromUserId);
        if (link != null) {
            link.send(rej);
        }
        Map<String, Object> out = new HashMap<>();
        out.put("type", "file");
        out.put("roomId", rx.roomId);
        out.put("fileId", rx.fileId);
        out.put("name", rx.name);
        out.put("mime", rx.mime);
        out.put("size", rx.size);
        out.put("sha256", rx.sha256);
        out.put("chunks", rx.chunks);
        out.put("fromUserId", rx.fromUserId);
        out.put("ok", false);
        out.put("state", "cancelled".equals(code) ? "cancelled" : "failed");
        out.put("code", code);
        out.put("progress", 0);
        out.put("direction", "in");
        fileDebug("rx-reject", rx.fileId, Map.of("code", code));
        notifyUi(out);
    }

    /** Ghép xong v2: kiểm SHA trên đĩa, chuyển .part → .bin, báo UI + bên gửi. */
    private void finishFileV2(PeerLink link, FileRxV2 rx) {
        fileRxV2.remove(rx.fromUserId + ":" + rx.streamId, rx);
        String actual = "";
        boolean ok;
        try {
            synchronized (rx) {
                rx.raf.close();
            }
            actual = sha256File(rx.part);
            ok = Files.size(rx.part) == rx.size
                    && (rx.sha256 == null || rx.sha256.isBlank() || rx.sha256.equalsIgnoreCase(actual));
        } catch (IOException e) {
            ok = false;
        }
        if (ok) {
            byte[] head = new byte[64];
            try (InputStream fis = Files.newInputStream(rx.part)) {
                int hr = fis.read(head);
                if (hr > 0 && hr < 64) {
                    head = java.util.Arrays.copyOf(head, hr);
                }
            } catch (Exception ignored) {}
            FileSecurity.MagicCheck mc = FileSecurity.inspectMagicBytes(head, rx.name);
            if (!mc.ok()) {
                ok = false;
            }
        }
        if (ok) {
            try {
                LocalFileStore fs = fileStore;
                if (fs == null) {
                    throw new IOException("no_store");
                }
                Path dest = fs.data(rx.fileId);
                Files.createDirectories(dest.getParent());
                Files.move(rx.part, dest, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                fs.writeMeta(new LocalFileStore.Meta(rx.fileId, rx.roomId, rx.fromUserId,
                        rx.name, rx.mime, rx.size, rx.sha256, rx.chunkSize, rx.chunks,
                        "done", "in", System.currentTimeMillis()));
                OfflineStore os = offlineStore;
                if (os != null) {
                    os.saveLocal(new OfflineStore.LocalMsg("file:" + rx.fileId, rx.roomId, rx.fromUserId,
                            "file", MediaRef.local(rx.fileId, rx.name, rx.mime, rx.size, actual).toJson(),
                            System.currentTimeMillis(), "in", "delivered"));
                }
            } catch (IOException e) {
                ok = false;
            }
        }
        if (!ok) {
            try {
                Files.deleteIfExists(rx.part);
            } catch (IOException ignored) {
            }
        }
        Map<String, Object> done = new HashMap<>();
        done.put("t", "file_done");
        done.put("roomId", rx.roomId);
        done.put("fileId", rx.fileId);
        done.put("streamId", rx.streamId);
        done.put("ok", ok);
        done.put("sha256", actual);
        link.send(done);

        Map<String, Object> out = new HashMap<>();
        out.put("type", "file");
        out.put("roomId", rx.roomId);
        out.put("fileId", rx.fileId);
        out.put("name", rx.name);
        out.put("mime", rx.mime);
        out.put("size", rx.size);
        out.put("sha256", rx.sha256);
        out.put("actualSha256", actual);
        out.put("chunks", rx.chunks);
        out.put("fromUserId", rx.fromUserId);
        out.put("ok", ok);
        out.put("state", ok ? "done" : "failed");
        out.put("progress", ok ? 100 : 0);
        out.put("direction", "in");
        if (!ok) {
            out.put("code", "BAD_CHECKSUM");
        }
        fileDebug("rx-done", rx.fileId, Map.of("ok", ok, "from", rx.fromUserId));
        notifyUi(out);
    }

    /** Tính (một lần) SHA rút gọn từng khối của tệp gửi để bên nhận NACK đúng khối hỏng. */
    private void ensureChunkSums(SentFileV2 sf) {
        if (sf.sums != null) {
            return;
        }
        try (java.nio.channels.FileChannel fc = java.nio.channels.FileChannel.open(sf.path)) {
            byte[][] sums = new byte[sf.chunks][];
            for (int i = 0; i < sf.chunks; i++) {
                long off = (long) i * sf.chunkSize;
                int len = (int) Math.min(sf.chunkSize, sf.size - off);
                if (len <= 0) {
                    break;
                }
                byte[] b = readAt(fc, off, len);
                if (b.length != len) {
                    return;
                }
                sums[i] = ChunkSums.of(b);
            }
            sf.sums = sums;
        } catch (Exception e) {
            fileDebug("chunk-sums", sf.fileId, Map.of("err", String.valueOf(e.getMessage())));
        }
    }

    /** SHA-256 của một tệp trên đĩa (đọc theo luồng, không nạp cả tệp vào RAM). */
    private static String sha256File(Path p) throws IOException {
        MessageDigest md;
        try {
            md = MessageDigest.getInstance("SHA-256");
        } catch (Exception e) {
            throw new IOException("sha256", e);
        }
        try (InputStream in = Files.newInputStream(p)) {
            byte[] buf = new byte[64 * 1024];
            int r;
            while ((r = in.read(buf)) != -1) {
                md.update(buf, 0, r);
            }
        }
        return hex(md.digest());
    }

    /** Kết quả đẩy một tệp lên Tracker (byte đã mã hóa) để người nhận offline tải về. */
    private record BlobUpload(String blobId, byte[] key, int blocks) {
    }

    /**
     * Đẩy blob dự phòng khi link trực tiếp không tới được đích. Chỉ một lần/tệp, chạy trên
     * luồng nền riêng để tệp khác không bị chặn (A6). Nội dung luôn mã hóa E2E.
     */
    private void maybeBlobFallback(SentFileV2 sf) {
        maybeBlobFallback(sf, false);
    }

    /**
     * @param includeAccepted true khi tệp đã kẹt (quá {@code T_STALL_MS}) — lúc đó cả đích đã
     *                        accept nhưng không tiến triển cũng cần bản blob dự phòng.
     */
    private void maybeBlobFallback(SentFileV2 sf, boolean includeAccepted) {
        if (sf.closed || sf.size <= 0 || sf.size > FileTransferConfig.MAX_BLOB_BYTES) {
            return;
        }
        if (offlineStore == null || e2e == null || fileStore == null) {
            return;
        }
        if (!sf.blobBusy.compareAndSet(false, true)) {
            return;
        }
        blobExec().execute(() -> {
            try {
                long me = identity.userId();
                List<Long> pending = new ArrayList<>();
                for (Long uid : roomMemberIds(sf.roomId)) {
                    if (uid == null || uid == me || sf.finished.contains(uid) || sf.blobSent.contains(uid)) {
                        continue;
                    }
                    if (!includeAccepted && sf.accepted.contains(uid)) {
                        continue;
                    }
                    pending.add(uid);
                }
                if (pending.isEmpty()) {
                    return;
                }
                fileDebug("blob-start", sf.fileId, Map.of("pending", pending.size(), "size", sf.size));
                if (sf.blobId == null) {
                    BlobUpload up = uploadBlob(sf);
                    if (up == null) {
                        return;
                    }
                    sf.blobId = up.blobId();
                    sf.blobKey = up.key();
                    sf.blobBlocks = up.blocks();
                }
                byte[] key = sf.blobKey;
                if (key == null) {
                    return;
                }
                String json = new MediaRef(MediaRef.VERSION, sf.fileId, sf.name, sf.mime, sf.size, sf.sha256,
                        sf.blobId, CryptoBox.b64(key), sf.blobBlocks).toJson();
                String cid = "file:" + sf.fileId;
                List<Map<String, Object>> envs = buildEnvelopesFor(sf.roomId, cid, sf.createdAt, json, pending);
                if (!envs.isEmpty()
                        && postStore(sf.roomId, cid, sf.createdAt, envs, "file", MediaRef.CONTENT_TYPE)) {
                    sf.blobSent.addAll(pending);
                    fileDebug("blob-stored", sf.fileId, Map.of("recipients", envs.size()));
                    // Kiểm tra còn peer nào đang truyền trực tiếp (active link) không
                    boolean hasActiveDirect = false;
                    for (Long uid : sf.accepted) {
                        PeerLink link = linksByUserId.get(uid);
                        if (link != null && link.isActive() && !sf.finished.contains(uid)) {
                            hasActiveDirect = true;
                            break;
                        }
                    }
                    if (!hasActiveDirect || includeAccepted) {
                        // Không còn link trực tiếp nào đang truyền hoặc đã fallback sau khi stall -> hộp thư đã giữ bản dự phòng,
                        // coi như "đã gửi" (người nhận sẽ kéo về khi mở khóa), giống tin nhắn thường.
                        if (sentFilesV2.remove(sf.fileId, sf)) {
                            sf.close();
                        }
                        saveFileState(sf.roomId, sf.fileId, "sent", "out");
                        notifyFileState(sf.roomId, sf.fileId, "sent", envs.size(), sf.sha256);
                    } else {
                        notifyFileState(sf.roomId, sf.fileId, "sending", sf.accepted.size(), sf.sha256);
                    }
                }
            } catch (Exception e) {
                fileDebug("blob-fail", sf.fileId, Map.of("err", String.valueOf(e.getMessage())));
            } finally {
                sf.blobBusy.set(false);
            }
        });
    }

    /** Mã hóa từng khối 256 KB rồi đẩy lên Tracker; trả null nếu thất bại. */
    private BlobUpload uploadBlob(SentFileV2 sf) {
        int blockSize = FileTransferConfig.BLOB_BLOCK_SIZE;
        int blocks = (int) ((sf.size + blockSize - 1) / blockSize);
        int tag = BlobCrypto.TAG_BITS / 8;
        long encSize = sf.size + (long) blocks * (BlobCrypto.NONCE_BYTES + tag);
        byte[] key = BlobCrypto.newKey();
        byte[] prefix = BlobCrypto.newNoncePrefix();
        try {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("size", encSize);
            body.put("blocks", blocks);
            HttpResponse<String> cr = postWithRetry(serverUrl + "/api/blob", Json.write(body));
            if (cr.statusCode() != 200) {
                return null;
            }
            String blobId = Json.tree(cr.body()).path("blob_id").asText("");
            if (blobId.isBlank()) {
                return null;
            }
            try (java.nio.channels.FileChannel fc = java.nio.channels.FileChannel.open(sf.path)) {
                for (int i = 0; i < blocks; i++) {
                    if (blobCancelled.contains(sf.fileId)) {
                        return null;
                    }
                    long off = (long) i * blockSize;
                    int len = (int) Math.min(blockSize, sf.size - off);
                    byte[] plain = readAt(fc, off, len);
                    if (plain.length != len) {
                        return null;
                    }
                    byte[] enc = BlobCrypto.encryptBlock(key, prefix, i, plain);
                    if (enc == null) {
                        return null;
                    }
                    HttpResponse<String> r = putBytesRetry(serverUrl + "/api/blob/" + blobId + "/block/" + i, enc);
                    if (r.statusCode() != 200) {
                        fileDebug("blob-put", sf.fileId, Map.of("block", i, "status", r.statusCode()));
                        return null;
                    }
                }
            }
            HttpResponse<String> fr = postWithRetry(serverUrl + "/api/blob/" + blobId + "/finish", "{}");
            if (fr.statusCode() != 200) {
                return null;
            }
            return new BlobUpload(blobId, key, blocks);
        } catch (Exception e) {
            fileDebug("blob-up-fail", sf.fileId, Map.of("err", String.valueOf(e.getMessage())));
            return null;
        }
    }

    private void enqueueBlobDownload(MediaRef ref, long roomId, long fromUserId) {
        if (fileStore == null || ref.blobId().isBlank() || ref.blocks() <= 0) {
            return;
        }
        boolean direct = fileRxV2.values().stream().anyMatch(rx -> ref.fileId().equals(rx.fileId));
        if (direct || !blobReceiving.add(ref.fileId())) {
            return;
        }
        blobExec().execute(() -> downloadBlob(ref, roomId, fromUserId));
    }

    /** Tải + giải mã blob rồi lưu vào kho cục bộ; xong mới báo UI có thẻ tệp. */
    private void downloadBlob(MediaRef ref, long roomId, long fromUserId) {
        LocalFileStore fs = fileStore;
        Path part = fs == null ? null : fs.temp(ref.fileId());
        try {
            byte[] key = CryptoBox.unb64(ref.keyB64());
            if (fs == null || part == null || key.length != BlobCrypto.KEY_BYTES) {
                return;
            }
            Files.createDirectories(part.getParent());
            try (OutputStream out = Files.newOutputStream(part, java.nio.file.StandardOpenOption.CREATE,
                    java.nio.file.StandardOpenOption.TRUNCATE_EXISTING, java.nio.file.StandardOpenOption.WRITE)) {
                for (int i = 0; i < ref.blocks(); i++) {
                    if (blobCancelled.contains(ref.fileId())) {
                        throw new IOException("cancelled");
                    }
                    byte[] enc = getBytes(serverUrl + "/api/blob/" + ref.blobId() + "?block=" + i);
                    byte[] plain = enc == null ? null : BlobCrypto.decryptBlock(key, enc);
                    if (plain == null) {
                        throw new IOException("blob_block");
                    }
                    out.write(plain);
                }
            }
            String actual = sha256File(part);
            if (Files.size(part) != ref.size()
                    || (!ref.sha256().isBlank() && !actual.equalsIgnoreCase(ref.sha256()))) {
                Files.deleteIfExists(part);
                fileDebug("blob-rx-bad", ref.fileId(), Map.of("size", ref.size()));
                return;
            }
            Path dest = fs.data(ref.fileId());
            Files.move(part, dest, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            int chunks = FileChunks.count(ref.size(), FileTransferConfig.CHUNK_SIZE);
            fs.writeMeta(new LocalFileStore.Meta(ref.fileId(), roomId, fromUserId, ref.name(), ref.mime(),
                    ref.size(), actual, FileTransferConfig.CHUNK_SIZE, chunks, "done", "in",
                    System.currentTimeMillis()));
            OfflineStore os = offlineStore;
            if (os != null) {
                os.saveLocal(new OfflineStore.LocalMsg("file:" + ref.fileId(), roomId, fromUserId,
                        "file", ref.toJson(), System.currentTimeMillis(), "in", "delivered"));
            }
            notifyUi(receivedFileFrame(ref, roomId, fromUserId, actual, chunks));
            fileDebug("blob-rx", ref.fileId(), Map.of("blocks", ref.blocks(), "route", "blob"));
        } catch (Exception e) {
            try {
                if (part != null) {
                    Files.deleteIfExists(part);
                }
            } catch (IOException ignored) {
            }
            fileDebug("blob-rx-fail", ref.fileId(), Map.of("err", String.valueOf(e.getMessage())));
            int attempts = blobAttempts.merge(ref.fileId(), 1, Integer::sum);
            if (attempts <= 3) {
                try {
                    fileSched().schedule(() -> enqueueBlobDownload(ref, roomId, fromUserId),
                            15000L, TimeUnit.MILLISECONDS);
                } catch (Exception ignored) {
                    // scheduler đã đóng
                }
            }
        } finally {
            blobReceiving.remove(ref.fileId());
        }
    }

    private static Map<String, Object> receivedFileFrame(MediaRef ref, long roomId, long fromUserId,
                                                         String sha, int chunks) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("type", "file");
        out.put("roomId", roomId);
        out.put("fileId", ref.fileId());
        out.put("name", ref.name());
        out.put("mime", ref.mime());
        out.put("size", ref.size());
        out.put("sha256", ref.sha256());
        out.put("actualSha256", sha);
        out.put("chunks", chunks);
        out.put("fromUserId", fromUserId);
        out.put("ok", true);
        out.put("state", "done");
        out.put("progress", 100);
        out.put("direction", "in");
        return out;
    }

    private java.util.concurrent.ExecutorService blobExec() {
        java.util.concurrent.ExecutorService e = blobExecutor;
        if (e == null) {
            synchronized (this) {
                if (blobExecutor == null) {
                    blobExecutor = Executors.newFixedThreadPool(2, r -> {
                        Thread t = new Thread(r, "peer-blob");
                        t.setDaemon(true);
                        return t;
                    });
                }
                e = blobExecutor;
            }
        }
        return e;
    }

    private HttpResponse<String> putBytes(String url, byte[] data) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(30))
                .header("Content-Type", "application/octet-stream")
                .PUT(HttpRequest.BodyPublishers.ofByteArray(data));
        String tok = authToken;
        if (tok != null) {
            b.header("Authorization", "Bearer " + tok);
        }
        HttpResponse<String> r = HTTP.send(b.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        noteTrackerOk();
        return r;
    }

    private byte[] getBytes(String url) throws Exception {
        for (int attempt = 0; ; attempt++) {
            HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(30))
                    .GET();
            String tok = authToken;
            if (tok != null) {
                b.header("Authorization", "Bearer " + tok);
            }
            HttpResponse<byte[]> r = HTTP.send(b.build(), HttpResponse.BodyHandlers.ofByteArray());
            noteTrackerOk();
            if (r.statusCode() == 429 && attempt < 3) {
                Thread.sleep(Math.min(30000L, retryAfterMs(r, 2000L << attempt)));
                continue;
            }
            return r.statusCode() == 200 ? r.body() : null;
        }
    }

    /** Tracker quá tải: đọc `Retry-After` (giây) để Core chờ rồi thử lại, không báo lỗi sớm. */
    private static long retryAfterMs(HttpResponse<?> r, long fallback) {
        String v = r.headers().firstValue("Retry-After").orElse("");
        try {
            return Math.max(1000L, Long.parseLong(v.trim()) * 1000L);
        } catch (Exception e) {
            return fallback;
        }
    }

    private HttpResponse<String> postWithRetry(String url, String json) throws Exception {
        HttpResponse<String> r = postJson(url, json);
        for (int attempt = 0; attempt < 3 && r.statusCode() == 429; attempt++) {
            Thread.sleep(Math.min(30000L, retryAfterMs(r, 2000L << attempt)));
            r = postJson(url, json);
        }
        return r;
    }

    private HttpResponse<String> putBytesRetry(String url, byte[] data) throws Exception {
        HttpResponse<String> r = putBytes(url, data);
        for (int attempt = 0; attempt < 3 && r.statusCode() == 429; attempt++) {
            Thread.sleep(Math.min(30000L, retryAfterMs(r, 2000L << attempt)));
            r = putBytes(url, data);
        }
        return r;
    }

    private static long roomIdOf(HttpExchange ex) {
        String r = query(ex).get("roomId");
        try {
            return r == null ? 0L : Long.parseLong(r);
        } catch (NumberFormatException e) {
            return 0L;
        }
    }

    private static String header(HttpExchange ex, String name) {
        return ex.getRequestHeaders().getFirst(name);
    }

    /** Cho phép trình duyệt đọc phản hồi từ origin UI đã được allowlist. */
    private void cors(HttpExchange ex, String origin) {
        if (origin != null && !origin.isBlank() && uiSecurity.originAllowed(origin)) {
            ex.getResponseHeaders().set("Access-Control-Allow-Origin", origin);
            ex.getResponseHeaders().set("Vary", "Origin");
            ex.getResponseHeaders().set("Access-Control-Allow-Private-Network", "true");
        }
    }

    /** Xử lý CORS preflight (nếu có) và trả true khi đã trả lời xong. */
    private boolean preflight(HttpExchange ex) throws IOException {
        if (!"OPTIONS".equalsIgnoreCase(ex.getRequestMethod())) {
            return false;
        }
        String origin = header(ex, "Origin");
        if (!uiSecurity.originAllowed(origin)) {
            reply(ex, 403, Json.write(Map.of("error", "cross_origin")));
            return true;
        }
        cors(ex, origin);
        ex.getResponseHeaders().set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        ex.getResponseHeaders().set("Access-Control-Allow-Headers", "Content-Type, Range, Authorization, X-Requested-With");
        ex.getResponseHeaders().set("Access-Control-Allow-Private-Network", "true");
        ex.getResponseHeaders().set("Access-Control-Max-Age", "600");
        ex.sendResponseHeaders(204, -1);
        ex.close();
        return true;
    }

    /** "Range: bytes=start-end" (một khoảng) → [start,end] đã kẹp; null nếu không có/không hợp lệ. */
    static long[] parseRange(String rangeHeader, long len) {
        if (rangeHeader == null || !rangeHeader.startsWith("bytes=") || len <= 0) {
            return null;
        }
        String spec = rangeHeader.substring("bytes=".length()).trim();
        int dash = spec.indexOf('-');
        if (dash < 0) {
            return null;
        }
        try {
            String a = spec.substring(0, dash).trim();
            String b = spec.substring(dash + 1).trim();
            long start;
            long end;
            if (a.isEmpty()) {
                long suffix = Long.parseLong(b);
                start = Math.max(0, len - suffix);
                end = len - 1;
            } else {
                start = Long.parseLong(a);
                end = b.isEmpty() ? len - 1 : Long.parseLong(b);
            }
            if (start < 0 || start >= len) {
                return null;
            }
            end = Math.min(end, len - 1);
            if (end < start) {
                return null;
            }
            return new long[] { start, end };
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** Log chẩn đoán (mặc định tắt, bật bằng PEER_FILE_DEBUG=1) — CHỈ ghi fileId, không tên/nội dung. */
    void fileDebug(String stage, String fileId, Map<String, Object> extra) {
        if (!FileTransferConfig.debugEnabled()) {
            return;
        }
        System.out.println("[file] " + stage + " id=" + shortId(fileId) + " " + Json.write(extra));
    }

    private static String hex(byte[] d) {
        StringBuilder sb = new StringBuilder(d.length * 2);
        for (byte b : d) {
            sb.append(Character.forDigit((b >> 4) & 0xf, 16)).append(Character.forDigit(b & 0xf, 16));
        }
        return sb.toString();
    }

    /**
     * Chia file thành các khối 32KB, gửi meta → từng khối nhị phân (mã hóa AES) → done
     * tới mọi peer trong phòng. Trả số peer đã nhận meta.
     */
    public int sendFile(long roomId, String fileId, String name, String mime, byte[] data, String sha256Hex) {
        int chunkSize = FILE_CHUNK_SIZE;
        int chunks = Math.max(1, (int) ((data.length + (long) chunkSize - 1) / chunkSize));
        Map<String, Object> meta = new HashMap<>();
        meta.put("t", "file_meta");
        meta.put("roomId", roomId);
        meta.put("fileId", fileId);
        meta.put("name", name == null ? "file.bin" : name);
        meta.put("mime", mime == null ? "" : mime);
        meta.put("size", data.length);
        meta.put("sha256", sha256Hex == null ? "" : sha256Hex);
        meta.put("chunkSize", chunkSize);
        meta.put("chunks", chunks);
        meta.put("fromUserId", identity.userId());
        meta.put("fromUsername", identity.username());
        int to = peerBroadcastFile(roomId, meta);
        for (int seq = 0; seq < chunks; seq++) {
            int off = seq * chunkSize;
            int len = Math.min(chunkSize, data.length - off);
            byte[] payload = new byte[1 + 4 + len];
            payload[0] = FILE_TAG;
            payload[1] = (byte) (seq >>> 24);
            payload[2] = (byte) (seq >>> 16);
            payload[3] = (byte) (seq >>> 8);
            payload[4] = (byte) seq;
            System.arraycopy(data, off, payload, 5, len);
            peerBroadcastFileBytes(roomId, payload);
        }
        Map<String, Object> done = new HashMap<>();
        done.put("t", "file_done");
        done.put("roomId", roomId);
        done.put("fileId", fileId);
        done.put("chunks", chunks);
        peerBroadcastFile(roomId, done);
        // Theo dõi để gửi lại khối thiếu khi có ACK/resume (chỉ khi có peer đích).
        List<Long> targets = fileTargetIds(roomId);
        if (!targets.isEmpty()) {
            SentFile sf = new SentFile(roomId, data, chunkSize, chunks);
            for (Long uid : targets) {
                sf.acked.put(uid, new boolean[chunks]);
            }
            sentFiles.put(fileId, sf);
            ensureRetryScheduler();
        }
        return to;
    }

    /** Danh sách userId trong phòng (trừ mình) — đích của luồng tệp. */
    private List<Long> fileTargetIds(long roomId) {
        List<Long> out = new ArrayList<>();
        Map<Long, PeerEntry> room = roomPeers.get(roomId);
        if (room == null) {
            return out;
        }
        long me = identity.userId();
        for (Long uid : room.keySet()) {
            if (uid != null && uid != me) {
                out.add(uid);
            }
        }
        return out;
    }

    /** Xác nhận khối từ một peer: đánh dấu; xong hết thì thôi theo dõi. */
    private void handleFileAck(Map<String, Object> m, long from) {
        String fileId = str(m, "fileId");
        Object seqO = m.get("seq");
        if (fileId == null || !(seqO instanceof Number seqN)) {
            return;
        }
        SentFile sf = sentFiles.get(fileId);
        if (sf == null) {
            return;
        }
        int seq = seqN.intValue();
        boolean complete;
        synchronized (sf) {
            boolean[] have = sf.acked.computeIfAbsent(from, k -> new boolean[sf.chunks]);
            if (seq >= 0 && seq < sf.chunks) {
                have[seq] = true;
            }
            complete = allAcked(sf);
        }
        if (complete) {
            sentFiles.remove(fileId);
        }
    }

    /**
     * Bên nhận cho biết các khối đã có (sau khi nối lại) → chỉ gửi lại phần còn thiếu.
     */
    private void handleFileHave(PeerLink link, Map<String, Object> m, long from) {
        String fileId = str(m, "fileId");
        if (fileId == null) {
            return;
        }
        SentFile sf = sentFiles.get(fileId);
        if (sf == null) {
            return;
        }
        Object seqsO = m.get("seqs");
        List<Integer> missing;
        synchronized (sf) {
            boolean[] have = new boolean[sf.chunks];
            if (seqsO instanceof List<?> list) {
                for (Object o : list) {
                    if (o instanceof Number n) {
                        int s = n.intValue();
                        if (s >= 0 && s < sf.chunks) {
                            have[s] = true;
                        }
                    }
                }
            }
            boolean[] ackedByPeer = sf.acked.computeIfAbsent(from, k -> new boolean[sf.chunks]);
            for (int i = 0; i < sf.chunks; i++) {
                if (have[i]) {
                    ackedByPeer[i] = true; // đã có sẵn = coi như đã nhận
                }
            }
            missing = FileChunks.missing(sf.chunks, have);
        }
        if (!missing.isEmpty()) {
            resendFileChunks(link, sf, missing);
        }
        if (allAcked(sf)) {
            sentFiles.remove(fileId);
        }
    }

    private static boolean allAcked(SentFile sf) {
        if (sf.acked.isEmpty()) {
            return true;
        }
        for (boolean[] arr : sf.acked.values()) {
            for (boolean b : arr) {
                if (!b) {
                    return false;
                }
            }
        }
        return true;
    }

    /** Gửi lại một số khối cho một peer cụ thể (TCP trực tiếp, hoặc Broadcast qua Relay). */
    private void resendFileChunks(PeerLink link, SentFile sf, List<Integer> seqs) {
        if (seqs == null || seqs.isEmpty()) {
            return;
        }
        for (int seq : seqs) {
            int off = seq * sf.chunkSize;
            if (off >= sf.data.length) {
                continue;
            }
            int len = Math.min(sf.chunkSize, sf.data.length - off);
            byte[] payload = new byte[1 + 4 + len];
            payload[0] = FILE_TAG;
            payload[1] = (byte) (seq >>> 24);
            payload[2] = (byte) (seq >>> 16);
            payload[3] = (byte) (seq >>> 8);
            payload[4] = (byte) seq;
            System.arraycopy(sf.data, off, payload, 5, len);
            if (!relayOnly && !forceDirectOnly && link != null && link.isActive()) {
                link.sendBytes(payload);
            } else {
                // Relay/đường vòng: dùng lại broadcast (bên nhận tự bỏ qua khối đã có).
                peerBroadcastFileBytes(sf.roomId, payload);
            }
        }
        sf.lastResendAt = System.currentTimeMillis();
    }

    /** Dọn/tạm dừng transfer v2: quá TTL thì bỏ, quá T_STALL không ACK thì nhả cho tệp khác. */
    private void sweepSentFilesV2(long now) {
        for (SentFileV2 sf : sentFilesV2.values()) {
            if (sf.closed) {
                continue;
            }
            if (now - sf.createdAt > SENT_FILE_TTL_MS) {
                failSentFile(sf, "TIMEOUT");
                continue;
            }
            if (!sf.accepted.isEmpty() && !sf.paused
                    && now - sf.lastActivityAt > FileTransferConfig.T_STALL_MS) {
                sf.paused = true;
                // mạng yếu: co cửa sổ, tăng dần backoff 0,5s -> 30s rồi tự thử lại
                sf.window = RetryPacing.shrink(sf.window);
                sf.backoffMs = RetryPacing.nextBackoff(sf.backoffMs);
                sf.retryAt = now + sf.backoffMs;
                saveFileState(sf.roomId, sf.fileId, "paused", "out");
                notifyFileState(sf.roomId, sf.fileId, "sending", sf.accepted.size(), sf.sha256,
                        true, sf.acked.size(), recipientStates(sf));
                fileDebug("send-stall", sf.fileId, Map.of("backoff", sf.backoffMs));
                maybeBlobFallback(sf, true);
            }
            if (sf.paused && now >= sf.retryAt) {
                sf.paused = false;
                fileDebug("send-resume", sf.fileId, Map.of("window", sf.window));
                for (Long uid : sf.acked.keySet()) {
                    if (sf.finished.contains(uid)) {
                        continue;
                    }
                    sf.next.put(uid, 0);
                    sendFileOffer(sf, uid);
                }
            }
        }
    }

    /** Gửi lại offer cho các đích vừa có link mới (resume sau khi đứt). */
    void reofferFilesOnLink(long uid) {
        restorePendingSends();
        for (SentFileV2 sf : sentFilesV2.values()) {
            if (!sf.closed && !sf.queued && sf.acked.containsKey(uid) && !sf.finished.contains(uid)) {
                sendFileOffer(sf, uid);
            }
        }
    }

    /** Khôi phục hàng đợi gửi còn dở trên đĩa sau khi Core khởi động lại (A6.8). */
    private void restorePendingSends() {
        if (restoredSends) {
            return;
        }
        LocalFileStore fs = fileStore;
        if (fs == null) {
            return;
        }
        restoredSends = true;
        for (LocalFileStore.Meta m : fs.list()) {
            if (!"out".equals(m.direction()) || m.fileId() == null) {
                continue;
            }
            String state = m.state();
            if (!"sending".equals(state) && !"paused".equals(state) && !"queued".equals(state)) {
                continue;
            }
            Path data = fs.data(m.fileId());
            if (!Files.exists(data) || sentFilesV2.containsKey(m.fileId())) {
                continue;
            }
            fileDebug("restore-send", m.fileId(), Map.of("state", state));
            startFileSend(m.roomId(), m.fileId(), m.name(), m.mime(), data, m.size(), m.sha256());
        }
    }

    /** Gửi lại khối thiếu cho các peer chưa ACK đủ, và dọn trạng thái quá hạn. */
    private void sweepSentFiles() {
        long now = System.currentTimeMillis();
        for (Map.Entry<String, SentFile> en : sentFiles.entrySet()) {
            SentFile sf = en.getValue();
            if (now - sf.createdAt > SENT_FILE_TTL_MS) {
                sentFiles.remove(en.getKey());
                notifyUi(Map.of("type", "file_transfer", "roomId", sf.roomId,
                        "fileId", en.getKey(), "ok", false, "code", "TIMEOUT"));
                continue;
            }
            if (now - sf.lastResendAt < 3000L) {
                continue;
            }
            for (Map.Entry<Long, boolean[]> pe : sf.acked.entrySet()) {
                boolean[] have = pe.getValue();
                List<Integer> missing = FileChunks.missing(sf.chunks, have);
                if (missing.isEmpty()) {
                    continue;
                }
                PeerLink l = linksByUserId.get(pe.getKey());
                resendFileChunks(l, sf, missing.size() > 64 ? missing.subList(0, 64) : missing);
            }
        }
    }

    /**
     * Broadcast frame điều khiển của luồng file (meta/done). Dùng TCP trực tiếp để giữ thứ tự,
     * hoặc Relay khi chạy ở chế độ failover; KHÔNG dùng UDP (UDP không đảm bảo thứ tự/không mất).
     */
    private int peerBroadcastFile(long roomId, Map<String, Object> frame) {
        Map<Long, PeerEntry> room = roomPeers.get(roomId);
        if (room == null) {
            return 0;
        }
        long me = identity.userId();
        int n = 0;
        for (PeerEntry e : room.values()) {
            if (e.userId() == me) {
                continue;
            }
            PeerLink l = linksByUserId.get(e.userId());
            if (l == null || !l.isActive()) {
                l = connectOutbound(e);
            }
            if (l != null && l.isActive()) {
                if (relayOnly) {
                    if (l.ready() && sendViaRelay(l, e.username(), frame)) {
                        n++;
                    }
                    continue;
                }
                if (forceDirectOnly) {
                    continue;
                }
                l.send(frame);
                n++;
            }
        }
        return n;
    }

    /** Gửi khối nhị phân file qua TCP trực tiếp, hoặc Relay (base64) khi failover. */
    private void peerBroadcastFileBytes(long roomId, byte[] payload) {
        Map<Long, PeerEntry> room = roomPeers.get(roomId);
        if (room == null) {
            return;
        }
        long me = identity.userId();
        for (PeerEntry e : room.values()) {
            if (e.userId() == me) {
                continue;
            }
            PeerLink l = linksByUserId.get(e.userId());
            if (l == null || !l.isActive()) {
                l = connectOutbound(e);
            }
            if (l != null && l.isActive()) {
                if (relayOnly) {
                    if (l.ready()) {
                        sendViaRelayBytes(l, e.username(), payload);
                    }
                    continue;
                }
                if (forceDirectOnly) {
                    continue;
                }
                l.sendBytes(payload);
            }
        }
    }

    /**
     * Gửi 1 khối file qua Relay. Khối được mã hóa AES-GCM rồi base64; nếu base64 vượt
     * {@link #RELAY_FRAG} ký tự thì cắt thành nhiều mảnh nhỏ (kèm fid/fi/fc) để không
     * vượt giới hạn frame của WebSocket, phía nhận ghép lại rồi mới giải mã.
     */
    private boolean sendViaRelayBytes(PeerLink link, String toUsername, byte[] payload) {
        WsSignaling sig = signaling;
        if (sig == null || toUsername == null || toUsername.isBlank()) {
            return false;
        }
        byte[] ct = link.encryptForUdp(payload);
        if (ct == null) {
            return false;
        }
        String b64 = Base64.getEncoder().encodeToString(ct);
        if (b64.length() <= RELAY_FRAG) {
            if (sig.sendSignal(toUsername, Map.of("rbytes", b64))) {
                relaySent.incrementAndGet();
                return true;
            }
            return false;
        }
        long fid = relayFragSeq.incrementAndGet();
        int count = (b64.length() + RELAY_FRAG - 1) / RELAY_FRAG;
        boolean all = true;
        for (int i = 0; i < count; i++) {
            int off = i * RELAY_FRAG;
            String part = b64.substring(off, Math.min(b64.length(), off + RELAY_FRAG));
            if (!sig.sendSignal(toUsername, Map.of("rbf", part, "fid", fid, "fi", i, "fc", count))) {
                all = false;
            }
        }
        if (all) {
            relaySent.incrementAndGet();
        }
        return all;
    }

    /** Ghép các mảnh của 1 khối file gửi qua Relay; trả về base64 đầy đủ khi đã đủ mảnh. */
    private String collectRelayFragment(String fromUsername, Map<String, Object> data) {
        Object partO = data.get("rbf");
        if (!(partO instanceof String part)) {
            return null;
        }
        Object fidO = data.get("fid");
        Object fiO = data.get("fi");
        Object fcO = data.get("fc");
        if (!(fidO instanceof Number fidN) || !(fiO instanceof Number fiN) || !(fcO instanceof Number fcN)) {
            return null;
        }
        int fi = fiN.intValue();
        int fc = fcN.intValue();
        if (fc <= 0 || fc > 100000 || fi < 0 || fi >= fc) {
            return null;
        }
        if (relayFrags.size() > 512) {
            relayFrags.clear();
        }
        String key = fromUsername + "#" + fidN.longValue();
        RelayFrag frag = relayFrags.computeIfAbsent(key, k -> new RelayFrag(fc));
        if (frag.parts.length != fc) {
            relayFrags.remove(key);
            return null;
        }
        synchronized (frag) {
            if (frag.parts[fi] == null) {
                frag.parts[fi] = part;
                frag.got++;
            }
            if (frag.got == fc) {
                relayFrags.remove(key);
                StringBuilder sb = new StringBuilder(fc * RELAY_FRAG);
                for (String p : frag.parts) {
                    sb.append(p);
                }
                return sb.toString();
            }
        }
        return null;
    }
    /** Nhận một khối nhị phân (đã giải mã) từ một link; ghép vào file đang nhận. */
    void onFileChunk(PeerLink link, byte[] data) {
        if (data.length < 5) {
            return;
        }
        if (data[0] == FileChunkFrame.TAG) {
            onFileChunkV2(link, data);
            return;
        }
        long from = link.remoteId();
        String fileId = lastFileFromUser.get(from);
        if (fileId == null) {
            return;
        }
        FileRx rx = fileRx.get(fileId);
        if (rx == null) {
            return;
        }
        int seq = ((data[1] & 0xff) << 24) | ((data[2] & 0xff) << 16) | ((data[3] & 0xff) << 8) | (data[4] & 0xff);
        if (seq < 0 || seq >= rx.chunks) {
            return;
        }
        byte[] chunk = Arrays.copyOfRange(data, 5, data.length);
        boolean isNew = false;
        synchronized (rx.parts) {
            if (rx.parts[seq] == null) {
                rx.parts[seq] = chunk;
                rx.received.incrementAndGet();
                isNew = true;
            }
        }
        // ACK từng khối để bên gửi biết phần nào đã tới (gửi lại phần thiếu khi đứt).
        if (isNew) {
            Map<String, Object> ack = new HashMap<>();
            ack.put("t", "file_ack");
            ack.put("roomId", rx.roomId);
            ack.put("fileId", fileId);
            ack.put("seq", seq);
            link.send(ack);
        }
    }

    private void handleFileMeta(PeerLink link, Map<String, Object> m, long from, String fromName) {
        String fileId = str(m, "fileId");
        Object sizeO = m.get("size");
        Object chunksO = m.get("chunks");
        if (fileId == null || !(sizeO instanceof Number sizeN) || !(chunksO instanceof Number chunksN)) {
            return;
        }
        int chunks = chunksN.intValue();
        if (chunks <= 0 || chunks > 100000) {
            return;
        }
        String sha = str(m, "sha256");
        FileRx existing = fileRx.get(fileId);
        if (existing != null && existing.chunks == chunks && existing.size == sizeN.longValue()
                && sameSha(existing.sha256, sha)) {
            // Resume: giữ phần đã nhận, chỉ xin bên gửi gửi lại các khối còn thiếu.
            lastFileFromUser.put(from, fileId);
            sendFileHave(link, fileId, existing);
            return;
        }
        long roomId = m.get("roomId") instanceof Number r ? r.longValue() : 0L;
        FileRx rx = new FileRx(roomId, from,
                str(m, "name"), str(m, "mime") == null ? "" : str(m, "mime"),
                sizeN.longValue(), sha,
                m.get("chunkSize") instanceof Number cs ? cs.intValue() : FILE_CHUNK_SIZE,
                chunks);
        fileRx.put(fileId, rx);
        lastFileFromUser.put(from, fileId);
    }

    /** Hai hash coi là khớp nếu thiếu một bên (chỉ dùng để quyết định resume). */
    private static boolean sameSha(String a, String b) {
        if (a == null || a.isBlank() || b == null || b.isBlank()) {
            return true;
        }
        return a.equalsIgnoreCase(b);
    }

    /** Báo cho bên gửi các khối đã có của một file (để họ chỉ gửi lại khối thiếu). */
    private void sendFileHave(PeerLink link, String fileId, FileRx rx) {
        if (link == null) {
            return;
        }
        List<Integer> have = new ArrayList<>();
        synchronized (rx.parts) {
            for (int i = 0; i < rx.chunks; i++) {
                if (rx.parts[i] != null) {
                    have.add(i);
                }
            }
        }
        Map<String, Object> frame = new HashMap<>();
        frame.put("t", "file_have");
        frame.put("roomId", rx.roomId);
        frame.put("fileId", fileId);
        frame.put("seqs", have);
        link.send(frame);
    }

    private void handleFileDone(Map<String, Object> m, long from, String fromName) {
        String fileId = str(m, "fileId");
        if (fileId != null) {
            finishFile(fileId, from, fromName);
        }
    }

    /** Ghép các khối, tính SHA-256, so với hash nguồn rồi đẩy kết quả cho UI. */
    private void finishFile(String fileId, long from, String fromName) {
        FileRx rx = fileRx.remove(fileId);
        if (rx == null) {
            return;
        }
        if (fileId.equals(lastFileFromUser.get(from))) {
            lastFileFromUser.remove(from);
        }
        boolean complete = rx.received.get() == rx.chunks;
        byte[] all = complete ? concat(rx) : null;
        String actual = all != null ? sha256Hex(all) : "";
        boolean ok = complete && all.length == rx.size
                && (rx.sha256 == null || rx.sha256.isBlank() || rx.sha256.equalsIgnoreCase(actual));
        Map<String, Object> out = new HashMap<>();
        out.put("type", "file");
        out.put("roomId", rx.roomId);
        out.put("fileId", fileId);
        out.put("name", rx.name);
        out.put("mime", rx.mime);
        out.put("size", rx.size);
        out.put("sha256", rx.sha256);
        out.put("actualSha256", actual);
        out.put("chunks", rx.chunks);
        out.put("fromUserId", from);
        out.put("fromUsername", fromName);
        out.put("ok", ok);
        out.put("state", ok ? "done" : "failed");
        out.put("progress", ok ? 100 : 0);
        out.put("direction", "in");
        if (ok) {
            LocalFileStore fs = fileStore;
            if (fs != null) {
                try {
                    Files.createDirectories(fs.data(fileId).getParent());
                    Files.write(fs.data(fileId), all);
                    fs.writeMeta(new LocalFileStore.Meta(fileId, rx.roomId, from, rx.name, rx.mime,
                            rx.size, rx.sha256, rx.chunkSize, rx.chunks, "done", "in",
                            System.currentTimeMillis()));
                    OfflineStore os = offlineStore;
                    if (os != null) {
                        os.saveLocal(new OfflineStore.LocalMsg("file:" + fileId, rx.roomId, from,
                                "file", MediaRef.local(fileId, rx.name, rx.mime, rx.size, actual).toJson(),
                                System.currentTimeMillis(), "in", "delivered"));
                    }
                } catch (IOException e) {
                    out.put("ok", false);
                    out.put("state", "failed");
                    out.put("code", "STORE_FAILED");
                }
            }
        } else {
            out.put("code", complete ? "BAD_CHECKSUM" : "INCOMPLETE");
        }
        fileDebug("done", fileId, Map.of("ok", out.get("ok"), "from", from));
        notifyUi(out);
    }

    private static byte[] concat(FileRx rx) {
        ByteArrayOutputStream bos = new ByteArrayOutputStream((int) Math.min(rx.size, Integer.MAX_VALUE));
        for (int i = 0; i < rx.chunks; i++) {
            byte[] p = rx.parts[i];
            if (p == null) {
                return null;
            }
            bos.write(p, 0, p.length);
        }
        return bos.toByteArray();
    }

    static String sha256Hex(byte[] data) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(data);
            StringBuilder sb = new StringBuilder(d.length * 2);
            for (byte b : d) {
                sb.append(Character.forDigit((b >> 4) & 0xf, 16)).append(Character.forDigit(b & 0xf, 16));
            }
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException("sha256", e);
        }
    }

    private static Map<String, String> query(HttpExchange ex) {
        Map<String, String> out = new HashMap<>();
        String raw = ex.getRequestURI().getRawQuery();
        if (raw == null || raw.isBlank()) {
            return out;
        }
        for (String pair : raw.split("&")) {
            int i = pair.indexOf('=');
            if (i < 0) {
                continue;
            }
            try {
                String k = java.net.URLDecoder.decode(pair.substring(0, i), StandardCharsets.UTF_8.name());
                String v = java.net.URLDecoder.decode(pair.substring(i + 1), StandardCharsets.UTF_8.name());
                out.put(k, v);
            } catch (Exception ignored) {
            }
        }
        return out;
    }

    void reply(HttpExchange ex, int code, String json) {
        try {
            byte[] data = json.getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
            ex.sendResponseHeaders(code, data.length);
            ex.getResponseBody().write(data);
            ex.close();
        } catch (IOException ignored) {
        }
    }

    private static String body(HttpExchange ex) {
        try {
            return new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            return "";
        }
    }

    // ---------- message API ----------

    /**
     * Gửi tin nhắn trong phòng. clientId do UI cấp (chính là client_msg_id đã lưu qua
     * REST) để người nhận nối được mesh-copy với bản ghi lịch sử — dedupe không lệch.
     * Không có clientId (UI cũ) thì server tự sinh như trước.
     */
    public SendResult sendChat(long roomId, String text, String clientId) {
        return sendChat(roomId, text, clientId, null);
    }

    public SendResult sendChat(long roomId, String text, String clientId, String replyToClientId) {
        Identity id = identity;
        String cid = clientId != null ? clientId
                : "P" + (id == null ? 0 : id.userId()) + "-" + UUID.randomUUID().toString().substring(0, 8);
        int n = 0;
        boolean queued = false;
        if (id != null) {
            Map<String, Object> frame = new LinkedHashMap<>();
            frame.put("t", "chat");
            frame.put("roomId", roomId);
            frame.put("text", text);
            frame.put("clientId", cid);
            frame.put("ts", System.currentTimeMillis());
            frame.put("fromUserId", id.userId());
            frame.put("fromUsername", id.username());
            if (replyToClientId != null && !replyToClientId.isBlank()) {
                frame.put("replyToClientId", replyToClientId);
            }
            n = peerBroadcast(roomId, frame).peers();
            trackOutbound(cid, roomId, frame);
            if (text != null && !text.isEmpty()) {
                long sentAt = (System.currentTimeMillis() / 1000L) * 1000L;
                offlineStore.saveLocal(new OfflineStore.LocalMsg(cid, roomId, id.userId(),
                        "text", text, sentAt, "out", "stored", replyToClientId));
                queued = e2e != null;
                sendEnvelopesAsync(roomId, cid, sentAt, text);
            }
        }
        System.out.println("[peer-send] gửi id=" + shortId(cid) + " room=" + roomId
                + " mesh=" + n + " queued=" + queued + " -> stored");
        return new SendResult(cid, n, false, queued);
    }

    /** Dựng phong bì E2E + đẩy hộp thư ở luồng nền riêng, không chặn lệnh UI nào. */
    private void sendEnvelopesAsync(long roomId, String cid, long sentAt, String text) {
        try {
            sendExecutor().execute(() -> {
                try {
                    List<Map<String, Object>> envs = buildEnvelopesFor(roomId, cid, sentAt, text,
                            roomMemberIds(roomId));
                    if (!envs.isEmpty() && postStore(roomId, cid, sentAt, envs)) {
                        markSent(cid);
                    }
                } catch (Exception e) {
                    System.err.println("[peer-send] store nền lỗi id=" + shortId(cid)
                            + ": " + e.getMessage());
                }
            });
        } catch (Exception e) {
            System.err.println("[peer-send] không xếp được store nền: " + e.getMessage());
        }
    }

    /** Luồng riêng cho việc dựng/gửi phong bì — tách khỏi cả UI WS lẫn pullOffline. */
    private java.util.concurrent.ExecutorService sendExecutor() {
        java.util.concurrent.ExecutorService e = sendExec;
        if (e == null) {
            synchronized (this) {
                if (sendExec == null) {
                    sendExec = Executors.newSingleThreadExecutor(r -> {
                        Thread t = new Thread(r, "peer-send");
                        t.setDaemon(true);
                        return t;
                    });
                }
                e = sendExec;
            }
        }
        return e;
    }

    public int sendSeen(long roomId, String messageId) {
        Map<String, Object> frame = new ConcurrentHashMap<>();
        frame.put("t", "seen");
        frame.put("roomId", roomId);
        frame.put("messageId", messageId);
        frame.put("ts", System.currentTimeMillis());
        int n = peerBroadcast(roomId, frame).peers();
        if (n == 0) {
            n = sendLightViaTracker(roomId, frame);
        }
        logLightSend("seen", roomId, n);
        return n;
    }

    /**
     * Gửi một sự kiện nhẹ (typing/edit/recall/reaction/read) tới mọi peer trong phòng
     * trừ mình. fields phải đã chứa "t" (loại sự kiện) và "roomId".
     * Trả {@link EventSendResult} mô tả kết quả THỰC (sent/pending/no_route) — dùng để báo
     * trạng thái gửi khung cuộc gọi về UI bên gọi (LỖI B).
     */
    public EventSendResult sendEvent(long roomId, Map<String, Object> fields) {
        Map<String, Object> frame = new ConcurrentHashMap<>(fields);
        frame.putIfAbsent("roomId", roomId);
        frame.putIfAbsent("ts", System.currentTimeMillis());
        Identity id = identity;
        if (id != null) {
            frame.putIfAbsent("fromUserId", id.userId());
            frame.putIfAbsent("fromUsername", id.username());
        }
        EventSendResult r = peerBroadcast(roomId, frame);
        Object t = frame.get("t");
        if (!r.state().equals("sent") && "typing".equals(t)) {
            if (sendLightViaTracker(roomId, frame) > 0) {
                r = new EventSendResult("sent", "relay", 1, r.pending());
            }
        }
        if ("typing".equals(t)) {
            logLightSend("typing", roomId, r.peers());
        }
        if ("call".equals(t)) {
            // Chẩn đoán LỖI B: trạng thái gửi thực của khung cuộc gọi.
            Map<String, Object> dbg = CallDebug.summary(frame);
            dbg.put("state", r.state());
            if (r.via() != null) {
                dbg.put("via", r.via());
            }
            dbg.put("peers", r.peers());
            dbg.put("pending", r.pending());
            CallDebug.log("core-gui", dbg);
            if (!r.state().equals("sent")) {
                Map<String, Object> drop = CallDebug.summary(frame);
                drop.put("lyDo", r.state().equals("pending")
                        ? "chua_bat_tay_xong_chi_xep_hang"
                        : "khong_co_link_toi_phong");
                drop.put("state", r.state());
                drop.put("pending", r.pending());
                CallDebug.log("core-bo-qua", drop);
            }
            Object cid = frame.get("callId");
            // Báo trạng thái gửi về UI bên gọi dưới dạng frame `call_state` (chỉ THÊM; UI cũ
            // bỏ qua vì không hiểu `type` lạ). Chỉ gửi cho lời mời (invite).
            if ("invite".equals(frame.get("signal"))) {
                Map<String, Object> st = new ConcurrentHashMap<>();
                st.put("type", "call_state");
                if (cid != null) {
                    st.put("callId", cid);
                }
                st.put("roomId", roomId);
                st.put("state", r.state());
                if (r.via() != null) {
                    st.put("via", r.via());
                }
                st.put("ts", System.currentTimeMillis());
                notifyUi(st);
            }
            // LỖI B: lời mời KHÔNG tới được ai (không có PeerLink tới phòng này). Báo NGAY cho UI
            // bên gọi để họ kết thúc với lý do rõ ràng, thay vì đổ chuông 45 giây rồi "không có
            // người trả lời". Tín hiệu mới này chỉ được THÊM: bản UI cũ bỏ qua vì `CallSession.handle`
            // không hiểu `signal` lạ.
            if (!r.state().equals("sent") && "invite".equals(frame.get("signal"))) {
                Map<String, Object> out = new ConcurrentHashMap<>();
                out.put("type", "call");
                out.put("signal", "undeliverable");
                out.put("roomId", roomId);
                if (cid != null) {
                    out.put("callId", cid);
                }
                out.put("ts", System.currentTimeMillis());
                notifyUi(out);
            }
        }
        return r;
    }

    /**
     * Đường dự phòng cho typing/seen khi KHÔNG có PeerLink (peerBroadcast trả 0): nhờ Tracker
     * định tuyến theo PHÒNG qua phiên WS đã xác thực của người nhận. Chạy được cả khi kênh WS
     * của ta mở (gửi thẳng qua WS) lẫn khi WS đứt nhưng HTTP còn (POST /api/events/light).
     * Chỉ gửi trường phi nội dung (type, messageId, ts) — Tracker không thấy nội dung tin (E2E).
     */
    private int sendLightViaTracker(long roomId, Map<String, Object> frame) {
        Map<String, Object> event = lightFallbackEvent(frame);
        if (event == null) {
            return 0;
        }
        String type = event.get("type").toString();
        WsSignaling sig = signaling;
        if (sig != null && sig.isOpen() && sig.sendLightEvent(roomId, event)) {
            System.out.println("[peer-light] fallback Tracker/WS type=" + type + " room=" + roomId);
            return 1;
        }
        asyncPostLight(roomId, event);
        return 1;
    }

    /**
     * Dựng payload sự kiện nhẹ để gửi qua Tracker (không có PeerLink): CHỈ {@code typing}/{@code seen}
     * và CHỈ trường phi nội dung (type, messageId của seen, ts). Trả {@code null} cho mọi loại khác
     * (edit/call/recall/reaction…) — những loại này có thể mang nội dung nên KHÔNG đi đường Tracker.
     */
    static Map<String, Object> lightFallbackEvent(Map<String, Object> frame) {
        if (frame == null) {
            return null;
        }
        Object tv = frame.get("t");
        String type = tv == null ? "" : tv.toString();
        if (!"typing".equals(type) && !"seen".equals(type) && !"recall".equals(type) && !"reaction".equals(type)) {
            return null;
        }
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("type", type);
        if ("seen".equals(type)) {
            Object mid = frame.get("messageId");
            if (mid != null) {
                event.put("messageId", mid.toString());
            }
        }
        if ("recall".equals(type) || "reaction".equals(type)) {
            Object cid = frame.get("clientId");
            if (cid != null) event.put("clientId", cid.toString());
        }
        if ("reaction".equals(type)) {
            Object em = frame.get("emoji");
            if (em != null) event.put("emoji", em.toString());
            Object rm = frame.get("remove");
            if (rm instanceof Boolean b) event.put("remove", b);
        }
        Object tsv = frame.get("ts");
        event.put("ts", tsv instanceof Number n ? n.longValue() : System.currentTimeMillis());
        return event;
    }

    /** POST sự kiện nhẹ lên Tracker ở luồng nền để không chặn vòng sự kiện UI. */
    private void asyncPostLight(long roomId, Map<String, Object> event) {
        Runnable task = () -> {
            try {
                Map<String, Object> body = new LinkedHashMap<>();
                body.put("room_id", roomId);
                body.put("event", event);
                HttpResponse<String> r = postJson(serverUrl + "/api/events/light", Json.write(body));
                System.out.println("[peer-light] fallback Tracker/HTTP type=" + event.get("type")
                        + " room=" + roomId + " status=" + r.statusCode());
            } catch (Exception e) {
                System.err.println("[peer-light] HTTP fallback lỗi: " + e.getMessage());
            }
        };
        ensureRetryScheduler();
        ScheduledExecutorService ex = retryScheduler;
        if (ex == null) {
            task.run();
            return;
        }
        try {
            ex.execute(task);
        } catch (Exception e) {
            System.err.println("[peer-light] không xếp được POST nền: " + e.getMessage());
        }
    }

    /**
     * Nhận sự kiện nhẹ (typing/seen) do Tracker định tuyến theo phòng (không qua PeerLink) và
     * chuyển thẳng tới UI — cùng dạng frame như đường peer-to-peer để FE xử lý y hệt.
     */
    public void onTrackerLightEvent(String fromUsername, long fromUserId, long roomId,
                                    Map<String, Object> event) {
        if (event == null) {
            return;
        }
        Object tv = event.get("type");
        String type = tv == null ? "" : tv.toString();
        if (!"typing".equals(type) && !"seen".equals(type) && !"recall".equals(type) && !"reaction".equals(type)) {
            return;
        }
        Map<String, Object> out = new ConcurrentHashMap<>();
        out.put("type", type);
        out.put("roomId", roomId);
        out.put("fromUserId", fromUserId);
        out.put("fromUsername", fromUsername == null ? "" : fromUsername);
        if ("seen".equals(type)) {
            Object mid = event.get("messageId");
            if (mid != null) {
                out.put("messageId", mid);
            }
        }
        if ("recall".equals(type)) {
            Object cid = event.get("clientId");
            if (cid != null) {
                out.put("clientId", cid);
                applyLocalRecall(cid.toString());
            }
        }
        if ("reaction".equals(type)) {
            Object cid = event.get("clientId");
            if (cid != null) out.put("clientId", cid);
            Object em = event.get("emoji");
            if (em != null) out.put("emoji", em);
            Object rm = event.get("remove");
            if (rm != null) out.put("remove", rm);
        }
        Object ts = event.get("ts");
        if (ts != null) {
            out.put("ts", ts);
        }
        notifyUi(out);
        System.out.println("[peer-light] nhận Tracker type=" + type + " room=" + roomId);
    }

    /** Log chẩn đoán đường gửi sự kiện nhẹ (KHÔNG chứa nội dung): loại, phòng, số peer nhận. */
    private void logLightSend(String type, long roomId, int n) {
        System.out.println("[peer-light] gửi type=" + type + " room=" + roomId + " n=" + n);
    }

    /** Broadcast frame đã đầy đủ tới mọi peer trong phòng (trừ mình).
     *  Chỉ tính {@code "sent"} khi khung THỰC SỰ được ghi vào một PeerLink đã READY (hoặc Relay
     *  nhận). Nếu link chưa ready, khung chỉ nằm trong {@code pendingOut} → đếm vào {@code pending},
     *  KHÔNG tính là đã gửi (sửa lỗi "báo gửi thành công giả"). */
    private EventSendResult peerBroadcast(long roomId, Map<String, Object> frame) {
        Map<Long, PeerEntry> room = roomPeers.get(roomId);
        if (room == null) {
            return EventSendResult.NO_ROUTE;
        }
        long me = identity.userId();
        int sent = 0;
        int pending = 0;
        String via = null;
        boolean isCall = "call".equals(frame.get("t"));
        Object tov = frame.get("to");
        Long targetUid = tov instanceof Number num && num.longValue() > 0 ? num.longValue() : null;
        for (PeerEntry e : room.values()) {
            if (e.userId() == me) {
                continue;
            }
            if (targetUid != null && e.userId() != targetUid) {
                continue;
            }
            PeerLink l = linksByUserId.get(e.userId());
            if (l == null || !l.isActive()) {
                l = connectOutbound(e);
            }
            if (l != null && l.isActive()) {
                if (l.ready()) {
                    if (!relayOnly) {
                        if (!isCall && sendUdpData(l, e.userId(), frame)) {
                            logConnVia(e.username(), udpVia(e.userId(), e));
                            sent++;
                            if (via == null) {
                                via = "direct";
                            }
                            continue;
                        }
                        if (isCall || !udpFailed(e.userId())) {
                            l.send(frame);
                            logConnVia(e.username(), directVia(e.ip()));
                            sent++;
                            if (via == null) {
                                via = "direct";
                            }
                            continue;
                        }
                    }
                    if (!forceDirectOnly && sendViaRelay(l, e.username(), frame)) {
                        logConnVia(e.username(), "relay");
                        sent++;
                        if (via == null) {
                            via = "relay";
                        }
                        continue;
                    }
                    // Link READY nhưng không gửi được trực tiếp: đẩy vào hàng đợi (chưa chắc đã đi).
                    l.send(frame);
                    logConnVia(e.username(), directVia(e.ip()));
                    pending++;
                } else {
                    // Chưa bắt tay xong: khung chỉ được XẾP HÀNG, chưa gửi được.
                    l.send(frame);
                    pending++;
                }
            }
        }
        if (sent > 0) {
            return new EventSendResult("sent", via, sent, pending);
        }
        if (pending > 0) {
            return new EventSendResult("pending", null, 0, pending);
        }
        return EventSendResult.NO_ROUTE;
    }

    /** Gửi frame ứng dụng qua kênh UDP đã đục lỗ (mã hóa AES-GCM bằng khóa phiên). */
    private boolean sendUdpData(PeerLink link, long uid, Map<String, Object> frame) {
        UdpState u = udpPeers.get(uid);
        if (u == null || !u.reachable) {
            return false;
        }
        byte[] ct = link.encryptForUdp(Json.write(frame).getBytes(StandardCharsets.UTF_8));
        if (ct == null || ct.length > UDP_DATA_MAX) {
            return false;
        }
        sendUdp(u.remoteHost, u.remotePort, UDP_DATA, ct);
        udpDataSent.incrementAndGet();
        return true;
    }

    /**
     * Gửi frame ứng dụng qua Relay của Tracker (control-plane WS). Payload vẫn được
     * mã hóa AES-GCM bằng khóa phiên của kênh TCP nên Tracker không đọc được.
     */
    private boolean sendViaRelay(PeerLink link, String toUsername, Map<String, Object> frame) {
        WsSignaling sig = signaling;
        if (sig == null || toUsername == null || toUsername.isBlank()) {
            return false;
        }
        byte[] ct = link.encryptForUdp(Json.write(frame).getBytes(StandardCharsets.UTF_8));
        if (ct == null) {
            return false;
        }
        if (sig.sendSignal(toUsername, Map.of("relay", Base64.getEncoder().encodeToString(ct)))) {
            relaySent.incrementAndGet();
            return true;
        }
        return false;
    }

    /** Nhận frame ứng dụng qua Relay, giải mã bằng khóa phiên rồi xử lý như bình thường. */
    void onRelay(String fromUsername, Map<String, Object> data) {
        if (data == null) {
            return;
        }
        Object r = data.get("relay");
        Object rb = data.get("rbytes");
        Object rbf = data.get("rbf");
        boolean isBytes = false;
        String b64;
        if (rbf != null) {
            b64 = collectRelayFragment(fromUsername, data);
            if (b64 == null) {
                return;
            }
            isBytes = true;
        } else if (r instanceof String s && !s.isBlank()) {
            b64 = s;
        } else if (rb instanceof String b && !b.isBlank()) {
            b64 = b;
            isBytes = true;
        } else {
            return;
        }
        PeerLink link = linkByUsername(fromUsername);
        if (link == null || !link.ready()) {
            return;
        }
        byte[] plain;
        try {
            plain = link.decryptFromUdp(Base64.getDecoder().decode(b64));
        } catch (Exception e) {
            return;
        }
        if (plain == null) {
            return;
        }
        relayRecv.incrementAndGet();
        if (isBytes) {
            onFileChunk(link, plain);
        } else {
            onPeerMessage(link, Json.readMap(new String(plain, StandardCharsets.UTF_8)));
        }
    }

    private PeerLink linkByUsername(String username) {
        if (username == null) {
            return null;
        }
        for (PeerLink l : linksByUserId.values()) {
            if (username.equals(l.remoteUsername())) {
                return l;
            }
        }
        return null;
    }

    public void setRelayOnly(boolean v) {
        this.relayOnly = v;
    }

    /** Bắt buộc chỉ dùng kênh trực tiếp (không Relay) — phục vụ kiểm tra LAN/công khai. */
    public void setForceDirectOnly(boolean v) {
        this.forceDirectOnly = v;
    }

    /**
     * Log "conn via: lan|zerotier|public|relay" khi transport tới một peer thay đổi. Không
     * log nội dung, chỉ log phương thức kết nối (siêu dữ liệu vận chuyển).
     */
    private void logConnVia(String username, String via) {
        if (username == null) {
            return;
        }
        String prev = lastTransport.put(username, via);
        if (!via.equals(prev)) {
            System.out.println("[peer] conn via: " + via + " → " + username);
        }
    }

    /**
     * "zerotier" nếu địa chỉ nằm trong dải giao diện ZeroTier cục bộ, "lan" nếu nằm trong
     * dải giao diện cục bộ khác hoặc thuộc dải riêng tư/CGNAT, ngược lại "public".
     */
    private String directVia(String ip) {
        long now = System.currentTimeMillis();
        if (now - localIfacesAt > 10_000L) {
            localIfaces = LocalNetworks.scan();
            localIfacesAt = now;
        }
        return LocalNetworks.classify(ip, localIfaces);
    }

    private String udpVia(long uid, PeerEntry e) {
        UdpState u = udpPeers.get(uid);
        String host = u != null && u.remoteHost != null && !u.remoteHost.isBlank() ? u.remoteHost : e.ip();
        return directVia(host);
    }

    /** IPv4 thuộc dải riêng tư, loopback, link-local hoặc CGNAT (100.64.0.0/10). */
    static boolean isPrivateIp(String ip) {
        if (ip == null || ip.isBlank()) {
            return true;
        }
        String[] p = ip.split("\\.");
        if (p.length != 4) {
            return false;
        }
        int a;
        int b;
        try {
            a = Integer.parseInt(p[0]);
            b = Integer.parseInt(p[1]);
        } catch (NumberFormatException e) {
            return false;
        }
        if (a == 10 || a == 127) {
            return true;
        }
        if (a == 172 && b >= 16 && b <= 31) {
            return true;
        }
        if (a == 192 && b == 168) {
            return true;
        }
        if (a == 169 && b == 254) {
            return true;
        }
        // CGNAT 100.64.0.0/10 = 100.64.0.0 – 100.127.255.255
        return a == 100 && b >= 64 && b <= 127;
    }

    // ---------- sự kiện từ link ----------

    void onLinkReady(PeerLink link) {
        long uid = link.remoteId();
        if (uid == 0) {
            return;
        }
        LinkDiag d = diag(uid);
        if (link.ready()) {
            d.lastResult = "ok";
            d.lastFailReason = null;
            d.everReady = true;
        }
        long me = identity.userId();
        synchronized (linksByUserId) {
            PeerLink cur = linksByUserId.get(uid);
            if (cur == null || !cur.isActive()) {
                linksByUserId.put(uid, link);
                return;
            }
            if (cur == link) {
                return;
            }
            boolean lReady = link.ready();
            boolean cReady = cur.ready();
            if (cReady && !lReady) {
                link.close();
                return;
            }
            if (lReady && !cReady) {
                linksByUserId.put(uid, link);
                cur.close();
                return;
            }
            // cả hai sẵn sàng → giữ link được khởi tạo bởi userId LỚN hơn (ổn định 2 phía)
            boolean keepOurs = (me > uid) == link.initiator();
            if (keepOurs) {
                PeerLink old = linksByUserId.put(uid, link);
                if (old != null && old != link) {
                    old.close();
                }
            } else {
                link.close();
            }
        }
        refreshRoomLinks();
    }

    /** Kênh vừa rảnh lại: đánh thức các tệp đang chờ chỗ để bơm tiếp khối. */
    void onLinkWritable(PeerLink link) {
        long uid = link.remoteId();
        if (uid <= 0) {
            return;
        }
        for (SentFileV2 sf : sentFilesV2.values()) {
            if (!sf.closed && !sf.queued && !sf.paused && !sf.finished.contains(uid)
                    && sf.acked.containsKey(uid)) {
                schedulePump(sf, uid, 5L);
            }
        }
    }

    void onLinkDead(PeerLink link) {
        long uid = link.remoteId();
        if (uid == 0) {
            return;
        }
        linksByUserId.remove(uid, link);
        LinkDiag d = diag(uid);
        d.lastResult = "dead";
        // Link đã từng chạy rồi mới đứt → closed_by_peer; chưa từng ready mà đã chết sau khi
        // TCP kết nối được → nhiều khả năng thất bại ở bắt tay (hello/TOFU).
        if (d.everReady) {
            d.lastFailReason = "closed_by_peer";
        } else if (d.lastFailReason == null) {
            d.lastFailReason = "hello_verify_failed";
        }
    }

    private void refreshRoomLinks() {
        // Đảm bảo mọi peer trong phòng đều có link active (nối lại nếu rớt).
        for (Map<Long, PeerEntry> room : roomPeers.values()) {
            for (PeerEntry e : room.values()) {
                if (e.userId() == identity.userId()) {
                    continue;
                }
                PeerLink l = linksByUserId.get(e.userId());
                if (l == null || !l.isActive()) {
                    connectOutbound(e);
                }
            }
        }
    }

    private static final Set<String> LIGHT_EVENT_TYPES = Set.of("typing", "edit", "recall", "reaction", "call");

    void onPeerMessage(PeerLink link, Map<String, Object> m) {
        String t = str(m, "t");
        long from = link.remoteId();
        String fn = link.remoteUsername();
        if (from <= 0) {
            from = (long) m.getOrDefault("fromUserId", 0L);
        }
        if (fn == null || fn.isBlank()) {
            fn = str(m, "fromUsername");
        }
        if ("chat".equals(t)) {
            Map<String, Object> rec = new ConcurrentHashMap<>(m);
            rec.put("fromUserId", from);
            rec.put("fromUsername", fn);
            long roomId = m.get("roomId") instanceof Number n ? n.longValue() : 0L;
            String cid = str(m, "clientId");
            String txt = str(m, "text");
            String replyTo = str(m, "replyToClientId");
            if (roomId > 0 && cid != null && !cid.isBlank()) {
                offlineStore.saveLocal(new OfflineStore.LocalMsg(
                        cid, roomId, from, "text", txt == null ? "" : txt,
                        System.currentTimeMillis(), "in", "delivered", replyTo));
            }
            synchronized (received) {
                received.add(rec);
                if (received.size() > 500) {
                    received.remove(0);
                }
            }
            Map<String, Object> out = new ConcurrentHashMap<>();
            out.put("type", "message");
            out.put("message", rec);
            notifyUi(out);
            // ACK cho bên gửi để họ chuyển "Đang chờ" → "Đã gửi" (chỉ khi người gửi là peer).
            if (roomId > 0 && cid != null && !cid.isBlank()) {
                try {
                    Map<String, Object> ack = new HashMap<>();
                    ack.put("t", "ack");
                    ack.put("roomId", roomId);
                    ack.put("clientId", cid);
                    ack.put("ts", System.currentTimeMillis());
                    link.send(ack);
                } catch (Exception ignored) {
                    // ACK là tối ưu; bên gửi có cơ chế thử lại theo backoff.
                }
            }
        } else if ("ack".equals(t)) {
            // Người nhận xác nhận đã nhận bản live → tin đi của ta đã gửi.
            markSent(str(m, "clientId"));
        } else if ("seen".equals(t)) {
            Map<String, Object> rec = new ConcurrentHashMap<>(m);
            rec.put("fromUserId", from);
            rec.put("fromUsername", fn);
            synchronized (seenEvents) {
                seenEvents.add(rec);
                if (seenEvents.size() > 200) {
                    seenEvents.remove(0);
                }
            }
            Map<String, Object> out = new ConcurrentHashMap<>();
            out.put("type", "seen");
            out.put("roomId", rec.get("roomId"));
            out.put("messageId", rec.get("messageId"));
            out.put("ts", rec.get("ts"));
            out.put("fromUserId", from);
            out.put("fromUsername", fn);
            notifyUi(out);
        } else if (LIGHT_EVENT_TYPES.contains(t)) {
            // typing/edit/recall/reaction — forward nguyên frame tới UI (không lưu trạng thái)
            if ("call".equals(t)) {
                // ACK end-to-end (LỖI B): đây là xác nhận của Core bên NHẬN gửi ngược về bên gọi.
                // KHÔNG forward tiếp cho UI bên gọi như một tín hiệu cuộc gọi thường; thay vào đó
                // chuyển thành frame `call_state` để bên gọi biết lời mời đã tới UI người nhận chưa.
                if ("ack".equals(str(m, "signal"))) {
                    handleCallAck(m, from);
                    return;
                }
                // Chẩn đoán LỖI B: tín hiệu cuộc gọi ĐÃ tới Peer Core này từ peer.
                Map<String, Object> dbg = CallDebug.summary(m);
                dbg.put("from", from);
                CallDebug.log("core-nhan", dbg);
            }
            Map<String, Object> out = new ConcurrentHashMap<>(m);
            out.put("type", t);
            out.put("fromUserId", from);
            out.put("fromUsername", fn);
            out.remove("t");
            int uiCount = notifyUi(out);
            // Lời mời: báo ngược cho Core bên gọi biết đã đẩy xuống được mấy UI (ack end-to-end).
            if ("call".equals(t) && "invite".equals(str(m, "signal"))) {
                try {
                    Map<String, Object> ack = new ConcurrentHashMap<>();
                    ack.put("t", "call");
                    ack.put("signal", "ack");
                    Object cid = m.get("callId");
                    if (cid != null) {
                        ack.put("callId", cid);
                    }
                    ack.put("roomId", m.get("roomId"));
                    ack.put("uiCount", uiCount);
                    ack.put("ts", System.currentTimeMillis());
                    link.send(ack);
                    Map<String, Object> dbg = CallDebug.summary(m);
                    dbg.put("ack", uiCount > 0 ? "acked" : "ack_no_ui");
                    dbg.put("uiCount", uiCount);
                    CallDebug.log("core-ack-gui", dbg);
                } catch (Exception ignored) {
                    // Không gửi được ack: bên gọi sẽ tự hết hạn theo CALL_ACK_TIMEOUT_MS.
                }
            }
            // SỬA tin: cập nhật bản đã giải mã trong lịch sử cục bộ để không mất khi tải lại.
            if ("edit".equals(t)) {
                String cid = str(m, "clientId");
                String txt = str(m, "text");
                if (cid != null && txt != null) {
                    offlineStore.updateLocalText(cid, txt);
                }
            }
            if ("recall".equals(t)) {
                String cid = str(m, "clientId");
                if (cid != null) {
                    applyLocalRecall(cid);
                }
            }
        } else if ("file_meta".equals(t)) {
            handleFileMeta(link, m, from, fn);
        } else if ("file_offer".equals(t)) {
            handleFileOffer(link, m, from, fn);
        } else if ("file_accept".equals(t)) {
            handleFileAccept(m, from);
        } else if ("file_reject".equals(t)) {
            handleFileReject(m, from);
        } else if ("file_done".equals(t)) {
            // v2 mang streamId; khung cũ (không streamId) vẫn đi đường cũ.
            if (m.get("streamId") instanceof Number) {
                handleFileDoneV2(m, from);
            } else {
                handleFileDone(m, from, fn);
            }
        } else if ("file_ack".equals(t)) {
            if (m.get("streamId") instanceof Number) {
                handleFileAckV2(m, from);
            } else {
                handleFileAck(m, from);
            }
        } else if ("file_nack".equals(t)) {
            handleFileNack(m, from);
        } else if ("file_cancel".equals(t)) {
            handleFileCancel(m, from);
        } else if ("file_have".equals(t)) {
            handleFileHave(link, m, from);
        }
    }

    // ---------- Nhắn tin ngoại tuyến E2E (Hướng A) ----------

    /** Nhãn thuật toán phong bì; phải khớp cột message_cache.algo (≤ 32 ký tự). */
    private static final String E2E_ALGO = "v1:OAEP256+GCM256+PSS256";

    public boolean e2eReady() {
        return e2e != null;
    }

    /** Ảnh chụp trạng thái E2E cho UI (không lộ khóa riêng). */
    public Map<String, Object> e2eStatus() {
        E2eKeystore.Material mat = e2e;
        Path kp = keystorePath;
        OfflineStore os = offlineStore;
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("unlocked", mat != null);
        out.put("hasKeystore", kp != null && new E2eKeystore(kp).exists());
        out.put("fingerprint", e2e == null ? "" : e2e.fingerprint());
        out.put("pendingOutbox", os == null ? 0 : os.count("pending"));
        return out;
    }

    public String e2eState() {
        if (e2e != null) {
            return "unlocked";
        }
        Path kp = keystorePath;
        if (kp == null || !new E2eKeystore(kp).exists()) {
            return "no_keystore";
        }
        try {
            new E2eKeystore(kp).open(new char[0]);
            return "empty_passphrase";
        } catch (Exception ignored) {
            return "locked";
        }
    }

    public OfflineStore.LocalMsg localMsg(String clientMsgId) {
        OfflineStore os = offlineStore;
        return os == null ? null : os.localMsg(clientMsgId);
    }

    /**
     * Mở khóa (hoặc tạo) kho khóa E2E bằng passphrase, đăng ký public key với Tracker.
     * Trả về frame trực tiếp cho UI (type "unlocked" hoặc "unlock_failed").
     */
    public synchronized Map<String, Object> unlock(String passphrase) {
        if (!isBound()) {
            return Map.of("type", "unlock_failed", "error", "NOT_BOUND");
        }
        if (this.e2e != null) {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("type", "unlocked");
            out.put("ok", true);
            out.put("alreadyUnlocked", true);
            out.put("created", false);
            out.put("fingerprint", this.e2e.fingerprint());
            out.put("pubkey", CryptoBox.pubB64(this.e2e.publicKey()));
            out.put("keyChanged", false);
            out.put("durationMs", 0L);
            return out;
        }
        long now = System.currentTimeMillis();
        if (now < unlockLockedUntil) {
            long remainingSec = (unlockLockedUntil - now + 999) / 1000;
            return Map.of("type", "unlock_failed", "error", "RATE_LIMITED",
                    "lockoutSeconds", remainingSec, "remainingAttempts", 0);
        }
        if (passphrase == null) {
            return Map.of("type", "unlock_failed", "error", "EMPTY_PASSPHRASE");
        }
        E2eKeystore ks = new E2eKeystore(keystorePath);
        boolean created = !ks.exists();
        if (created && passphrase.isBlank()) {
            return Map.of("type", "unlock_failed", "error", "EMPTY_PASSPHRASE");
        }
        long startMs = System.currentTimeMillis();
        E2eKeystore.Material mat;
        try {
            mat = created ? ks.create(passphrase.toCharArray()) : ks.open(passphrase.toCharArray());
        } catch (IllegalStateException ex) {
            unlockFailCount++;
            long remainingSec = 0;
            if (unlockFailCount >= 5) {
                unlockLockedUntil = System.currentTimeMillis() + 30_000L;
                remainingSec = 30;
            }
            int remainingAttempts = Math.max(0, 5 - unlockFailCount);
            return Map.of("type", "unlock_failed", "error", "BAD_PASSPHRASE",
                    "remainingAttempts", remainingAttempts,
                    "lockoutSeconds", remainingSec);
        }
        unlockFailCount = 0;
        unlockLockedUntil = 0L;
        long durationMs = System.currentTimeMillis() - startMs;
        this.e2e = mat;
        offlineStore.setDbKey(mat.dbKey());
        peerE2eKeys.put(identity.userId(), mat.publicKey());
        // Đăng ký public key với Tracker ở LUỒNG NỀN: khi mất mạng, `postJson` có thể treo tới
        // 15 giây; nếu chạy trên vòng sự kiện UI thì pong ngừng → UI báo "Mất kết nối" oan.
        // Kết quả "khóa có đổi không" báo bất đồng bộ bằng frame `key_changed` (UI đã xử lý).
        final String fingerprint = mat.fingerprint();
        runAsync("register_key", () -> {
            if (registerE2eKey(mat)) {
                notifyUi(Map.of("type", "key_changed", "fingerprint", fingerprint));
            }
        });
        System.out.println("[e2e-bench] Keystore unlocked in " + durationMs + "ms (created=" + created + ")");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("type", "unlocked");
        out.put("ok", true);
        out.put("created", created);
        out.put("fingerprint", fingerprint);
        out.put("pubkey", CryptoBox.pubB64(mat.publicKey()));
        // Báo bất đồng bộ qua frame "key_changed" (xem trên) để không chặn vòng sự kiện UI.
        out.put("keyChanged", false);
        out.put("durationMs", durationMs);
        return out;
    }

    public synchronized void lock() {
        this.e2e = null;
        OfflineStore os = offlineStore;
        if (os != null) {
            os.setDbKey(null);
        }
    }

    /**
     * Thu hồi phiên Peer Core khi người dùng đăng xuất: khoá khoá E2E trong RAM,
     * đóng toàn bộ link mesh, xoá trạng thái phiên (phòng/peer/khoá định danh) và
     * token xác thực. Keystore trên đĩa giữ nguyên để lần sau mở khoá lại.
     */
    public synchronized void revokeSession() {
        this.e2e = null;
        OfflineStore os = offlineStore;
        if (os != null) {
            os.setDbKey(null);
        }
        for (Long uid : new java.util.ArrayList<>(linksByUserId.keySet())) {
            PeerLink l = linksByUserId.remove(uid);
            if (l != null) {
                l.close();
            }
        }
        roomPeers.clear();
        udpPeers.clear();
        peerE2eKeys.clear();
        idPubByUser.clear();
        this.authToken = null;
    }

    /** Đăng ký public key E2E với Tracker; trả về true nếu khóa thay đổi (fingerprint cũ khác). */
    private boolean registerE2eKey(E2eKeystore.Material mat) {
        try {
            HttpResponse<String> r = postJson(serverUrl + "/api/keys",
                    Json.write(Map.of("public_key", CryptoBox.pubB64(mat.publicKey()))));
            if (r.statusCode() != 200) {
                System.err.println("[e2e] đăng ký public key thất bại: " + r.statusCode());
                return false;
            }
            return Json.tree(r.body()).path("changed").asBoolean(false);
        } catch (Exception e) {
            System.err.println("[e2e] đăng ký public key lỗi: " + e.getMessage());
            return false;
        }
    }

    // ---------- GĐ5: xoay/khôi phục kho khóa E2E + giới hạn đã biết ----------
    //
    // Giới hạn (chấp nhận trong phạm vi đồ án):
    //  1) TOFU (tin cậy khóa lần đầu): public key lấy từ Tracker không được xác thực
    //     ngoài luồng, nên Tracker bị xâm nhập có thể trả khóa giả để đọc tin. Chữ ký
    //     số chỉ chống giả mạo khi khóa công khai là đúng.
    //  2) Quên passphrase: khóa riêng không thể phục hồi; phải xóa keystore và tạo khóa
    //     mới, khi đó các tin ngoại tuyến cũ không giải mã được nữa.
    //  3) Báo cáo/AD8: nội dung đã mã hóa đầu-cuối nên máy chủ hay người báo cáo không
    //     đọc được; chỉ người nhận giải mã trên thiết bị của mình.

    /** Đổi passphrase keystore E2E (re-encrypt, giữ nguyên khóa). Trả frame cho UI. */
    public synchronized Map<String, Object> changePassphrase(String oldPassphrase, String newPassphrase) {
        if (!isBound()) {
            return Map.of("type", "passphrase_changed", "ok", false, "error", "NOT_BOUND");
        }
        if (newPassphrase == null || newPassphrase.isBlank()) {
            return Map.of("type", "passphrase_changed", "ok", false, "error", "EMPTY_NEW");
        }
        E2eKeystore ks = new E2eKeystore(keystorePath);
        if (!ks.exists()) {
            return Map.of("type", "passphrase_changed", "ok", false, "error", "NO_KEYSTORE");
        }
        try {
            E2eKeystore.Material mat;
            if (this.e2e != null && (oldPassphrase == null || oldPassphrase.isBlank())) {
                mat = ks.reencrypt(this.e2e, newPassphrase.toCharArray());
            } else {
                mat = ks.changePassphrase(
                        oldPassphrase == null ? new char[0] : oldPassphrase.toCharArray(),
                        newPassphrase.toCharArray());
            }
            this.e2e = mat;
            offlineStore.setDbKey(mat.dbKey());
            return Map.of("type", "passphrase_changed", "ok", true, "fingerprint", mat.fingerprint());
        } catch (IllegalStateException e) {
            return Map.of("type", "passphrase_changed", "ok", false, "error", "BAD_OLD");
        }
    }

    public synchronized Map<String, Object> changePassphraseWithTicket(String ticket, String newPassphrase) {
        if (!isBound()) {
            return Map.of("type", "passphrase_changed", "ok", false, "error", "NOT_BOUND");
        }
        if (newPassphrase == null || newPassphrase.isBlank() || newPassphrase.length() < 6) {
            return Map.of("type", "passphrase_changed", "ok", false, "error", "EMPTY_NEW");
        }
        if (ticket == null || ticket.isBlank()) {
            return Map.of("type", "passphrase_changed", "ok", false, "error", "INVALID_TICKET");
        }
        long verifiedUserId = -1;
        try {
            HttpResponse<String> r = postJson(serverUrl + "/api/e2e/otp/consume",
                    Json.write(Map.of("ticket", ticket.trim())));
            if (r.statusCode() == 200) {
                JsonNode res = Json.tree(r.body());
                if (res.path("ok").asBoolean(false)) {
                    verifiedUserId = res.path("userId").asLong(-1);
                }
            }
        } catch (Exception e) {
            System.err.println("[e2e] consume ticket error: " + e.getMessage());
        }
        if (verifiedUserId != identity.userId()) {
            return Map.of("type", "passphrase_changed", "ok", false, "error", "INVALID_TICKET");
        }

        E2eKeystore ks = new E2eKeystore(keystorePath);
        try {
            E2eKeystore.Material mat;
            if (this.e2e != null && ks.exists()) {
                mat = ks.reencrypt(this.e2e, newPassphrase.toCharArray());
            } else {
                ks.delete();
                this.e2e = null;
                if (offlineStore != null) offlineStore.setDbKey(null);
                mat = ks.create(newPassphrase.toCharArray());
            }
            this.e2e = mat;
            offlineStore.setDbKey(mat.dbKey());
            peerE2eKeys.put(identity.userId(), mat.publicKey());
            final String fingerprint = mat.fingerprint();
            runAsync("register_key", () -> {
                if (registerE2eKey(mat)) {
                    notifyUi(Map.of("type", "key_changed", "fingerprint", fingerprint));
                }
            });
            return Map.of("type", "passphrase_changed", "ok", true, "fingerprint", fingerprint);
        } catch (Exception e) {
            return Map.of("type", "passphrase_changed", "ok", false, "error", "CHANGE_FAILED");
        }
    }

    /** Xóa keystore E2E (khi quên mật khẩu). Lần mở khóa sau sẽ tạo khóa mới. */
    public synchronized Map<String, Object> resetKeystore() {
        if (!isBound()) {
            return Map.of("type", "keystore_reset", "ok", false, "error", "NOT_BOUND");
        }
        E2eKeystore ks = new E2eKeystore(keystorePath);
        boolean deleted = !ks.exists() || ks.delete();
        this.e2e = null;
        OfflineStore os = offlineStore;
        if (os != null) {
            os.setDbKey(null);
        }
        peerE2eKeys.clear();
        return Map.of("type", "keystore_reset", "ok", deleted);
    }

    /** Lấy public key E2E của một user (cache lại). Trả null nếu chưa đăng ký/không tải được. */
    private PublicKey peerE2eKey(long userId) {
        Identity id = identity;
        if (id != null && userId == id.userId() && e2e != null) {
            return e2e.publicKey();
        }
        PublicKey cached = peerE2eKeys.get(userId);
        if (cached != null) {
            return cached;
        }
        try {
            HttpResponse<String> r = getJson(serverUrl + "/api/users/" + userId + "/pubkey");
            if (r.statusCode() != 200) {
                return null;
            }
            String der = Json.tree(r.body()).path("public_key").asText("");
            if (der.isBlank()) {
                return null;
            }
            PublicKey pk = CryptoBox.publicKeyFromDer(CryptoBox.unb64(der));
            peerE2eKeys.put(userId, pk);
            return pk;
        } catch (Exception e) {
            return null;
        }
    }

    private List<Long> roomMemberIds(long roomId) {
        try {
            HttpResponse<String> r = getJson(serverUrl + "/api/rooms/" + roomId);
            if (r.statusCode() != 200) {
                return List.of();
            }
            List<Long> ids = new ArrayList<>();
            for (JsonNode m : Json.tree(r.body()).path("room").path("members")) {
                long id = m.path("id").asLong();
                if (id > 0) {
                    ids.add(id);
                }
            }
            return ids;
        } catch (Exception e) {
            return List.of();
        }
    }

    /**
     * Tạo phong bì E2E cho MỌI thành viên khác trong phòng rồi lưu cục bộ + xếp vào outbox.
     *
     * <p>Không bỏ qua thành viên "đang online qua mesh": kênh mesh có thể còn {@code isActive()}
     * nhưng không còn giao được (địa chỉ peer cũ sau khi Tracker khởi động lại). Nếu chỉ dựa vào
     * mesh thì tin kẹt "Đang chờ" và người nhận KHÔNG có bản nào trong hộp thư để kéo về. Luôn có
     * bản dự phòng trên hộp thư đảm bảo có ACK (→ "Đã gửi") và người nhận luôn nhận được; bản
     * trùng được khử theo {@code clientMsgId} ở phía nhận.
     *
     * @return danh sách phong bì đã xếp outbox (rỗng nếu chưa mở khoá E2E hoặc không có người nhận).
     */
    private List<Map<String, Object>> buildStoreEnvelopes(long roomId, String clientMsgId, long sentAt, String text) {
        offlineStore.saveLocal(new OfflineStore.LocalMsg(clientMsgId, roomId, identity.userId(),
                "text", text, sentAt, "out", "stored"));
        return buildEnvelopesFor(roomId, clientMsgId, sentAt, text, roomMemberIds(roomId));
    }

    /** Bọc cùng một nội dung cho danh sách người nhận chỉ định (bỏ qua chính mình). */
    private List<Map<String, Object>> buildEnvelopesFor(long roomId, String clientMsgId, long sentAt,
                                                        String text, List<Long> uids) {
        if (e2e == null) {
            return new ArrayList<>();
        }
        List<Map<String, Object>> envs = new ArrayList<>();
        for (Long uid : uids) {
            if (uid == null || uid == identity.userId()) {
                continue;
            }
            PublicKey pk = peerE2eKey(uid);
            if (pk == null) {
                continue;
            }
            Map<String, Object> env = buildEnvelope(e2e, pk, uid, clientMsgId, sentAt, text);
            if (env == null) {
                continue;
            }
            envs.add(env);
            offlineStore.savePending(new OfflineStore.OutboxEnvelope(0, clientMsgId, roomId, uid,
                    E2E_ALGO, (String) env.get("iv"), (String) env.get("wrapped_key"),
                    (String) env.get("signature"), (String) env.get("ciphertext"), sentAt, "pending", 0));
        }
        return envs;
    }

    /**
     * POST phong bì lên hộp thư Tracker ở luồng nền; thành công thì chuyển tin sang "Đã gửi".
     * Nhờ vậy đường gửi không bao giờ chặn vòng sự kiện UI dù Tracker chậm tới 15 giây.
     */
    private void asyncPostStore(long roomId, String clientMsgId, long sentAt, List<Map<String, Object>> envs) {
        ensureRetryScheduler();
        ScheduledExecutorService ex = retryScheduler;
        if (ex == null) {
            if (postStore(roomId, clientMsgId, sentAt, envs)) {
                markSent(clientMsgId);
            }
            return;
        }
        try {
            ex.execute(() -> {
                try {
                    if (postStore(roomId, clientMsgId, sentAt, envs)) {
                        markSent(clientMsgId);
                    }
                } catch (Exception e) {
                    System.err.println("[peer-send] store nền lỗi: " + e.getMessage());
                }
            });
        } catch (Exception e) {
            System.err.println("[peer-send] không xếp được store nền: " + e.getMessage());
        }
    }

    /**
     * Áp dụng SỬA tin theo E2E: cập nhật nội dung trong lịch sử cục bộ rồi MÃ HOÁ LẠI
     * bản mới cho mọi thành viên khác (ghi đè ciphertext cũ trong hộp thư). Giữ nguyên thời
     * điểm gửi gốc để không đảo thứ tự trong hộp thư người nhận. Không bỏ qua người "đang
     * online" để bản sửa luôn có đường dự phòng qua hộp thư (kênh mesh có thể đã đứt ngầm).
     */
    public int applyLocalEdit(String clientMsgId, String text) {
        if (clientMsgId == null || text == null) {
            return 0;
        }
        OfflineStore.LocalMsg row = offlineStore.localMsg(clientMsgId);
        offlineStore.updateLocalText(clientMsgId, text);
        if (e2e == null || row == null || !"out".equals(row.direction())) {
            return 0;
        }
        long roomId = row.roomId();
        long sentAt = row.sentAt();
        List<Map<String, Object>> envs = new ArrayList<>();
        for (Long uid : roomMemberIds(roomId)) {
            if (uid == identity.userId()) {
                continue;
            }
            PublicKey pk = peerE2eKey(uid);
            if (pk == null) {
                continue;
            }
            Map<String, Object> env = buildEnvelope(e2e, pk, uid, clientMsgId, sentAt, text);
            if (env == null) {
                continue;
            }
            envs.add(env);
            offlineStore.savePending(new OfflineStore.OutboxEnvelope(0, clientMsgId, roomId, uid,
                    E2E_ALGO, (String) env.get("iv"), (String) env.get("wrapped_key"),
                    (String) env.get("signature"), (String) env.get("ciphertext"), sentAt, "pending", 0));
        }
        if (!envs.isEmpty()) {
            asyncPostStore(roomId, clientMsgId, sentAt, envs);
        }
        return envs.size();
    }

    /**
     * Áp dụng THU HỒI tin nhắn / tệp cục bộ:
     * - Cập nhật SQLite: status = 'recalled', plaintext = ''
     * - Nếu là file (bắt đầu bằng "file:"): đánh dấu file meta là 'recalled', hủy/gỡ transfer
     *   và xóa blob tương ứng trên Tracker nếu có.
     */
    public void applyLocalRecall(String clientMsgId) {
        if (clientMsgId == null || clientMsgId.isBlank()) {
            return;
        }
        OfflineStore os = offlineStore;
        if (os != null) {
            os.updateLocalRecalled(clientMsgId);
        }
        String fileId = null;
        if (clientMsgId.startsWith("file:")) {
            fileId = clientMsgId.substring("file:".length());
        }
        LocalFileStore fs = fileStore;
        if (fs != null && fileId != null) {
            try {
                LocalFileStore.Meta meta = fs.readMeta(fileId);
                if (meta != null) {
                    fs.writeMeta(new LocalFileStore.Meta(meta.fileId(), meta.roomId(), meta.peerUserId(),
                            meta.name(), meta.mime(), meta.size(), meta.sha256(), meta.chunkSize(),
                            meta.chunks(), "recalled", meta.direction(), System.currentTimeMillis()));
                }
            } catch (Exception e) {
                System.err.println("[file-recall] lỗi cập nhật meta file: " + e.getMessage());
            }
            SentFileV2 sf = sentFilesV2.remove(fileId);
            if (sf != null) {
                sf.close();
                if (sf.blobId != null) {
                    asyncDeleteBlob(sf.blobId);
                }
            }
        }
    }

    private void asyncDeleteBlob(String blobId) {
        if (blobId == null || blobId.isBlank()) return;
        try {
            sendExecutor().execute(() -> {
                try {
                    deleteJson(serverUrl + "/api/blob/" + blobId);
                } catch (Exception e) {
                    System.err.println("[blob-delete] xóa blob thất bại: " + e.getMessage());
                }
            });
        } catch (Exception ignored) {}
    }

    private Map<String, Object> buildEnvelope(E2eKeystore.Material mine, PublicKey recipientPub,
                                              long recipientId, String clientMsgId, long sentAt, String text) {
        try {
            SecretKey aes = CryptoBox.newAes();
            if (!(CryptoBox.encryptAes(aes, text.getBytes(StandardCharsets.UTF_8)) instanceof CryptoBox.Result.Ok enc)) {
                return null;
            }
            byte[] ct = enc.data();
            if (!(CryptoBox.wrapOaep(recipientPub, aes.getEncoded()) instanceof CryptoBox.Result.Ok wr)) {
                return null;
            }
            byte[] canonical = canonical(clientMsgId, recipientId, sentAt, ct);
            if (!(CryptoBox.signPss(mine.privateKey(), canonical) instanceof CryptoBox.Result.Ok sg)) {
                return null;
            }
            Map<String, Object> env = new LinkedHashMap<>();
            env.put("recipient_id", recipientId);
            env.put("algo", E2E_ALGO);
            env.put("iv", CryptoBox.b64(Arrays.copyOf(ct, CryptoBox.IV_BYTES)));
            env.put("wrapped_key", CryptoBox.b64(wr.data()));
            env.put("signature", CryptoBox.b64(sg.data()));
            env.put("ciphertext", CryptoBox.b64(ct));
            return env;
        } catch (Exception e) {
            return null;
        }
    }

    /** Dữ liệu canonical để ký/kiểm chữ ký: "clientMsgId|recipientId|sentAtSec|" ++ ciphertext. Chuẩn hóa theo giây để tránh lệch mili-giây khi lưu DATETIME MySQL. */
    private static byte[] canonical(String clientMsgId, long recipientId, long sentAtMs, byte[] ciphertext) {
        long sec = sentAtMs > 0 ? (sentAtMs / 1000L) : 0L;
        byte[] prefix = (clientMsgId + "|" + recipientId + "|" + sec + "|").getBytes(StandardCharsets.UTF_8);
        byte[] out = new byte[prefix.length + ciphertext.length];
        System.arraycopy(prefix, 0, out, 0, prefix.length);
        System.arraycopy(ciphertext, 0, out, prefix.length, ciphertext.length);
        return out;
    }

    private boolean postStore(long roomId, String clientMsgId, long sentAt, List<Map<String, Object>> envs) {
        return postStore(roomId, clientMsgId, sentAt, envs, "text", "text");
    }

    private boolean postStore(long roomId, String clientMsgId, long sentAt,
                              List<Map<String, Object>> envs, String type, String contentType) {
        try {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("room_id", roomId);
            body.put("client_msg_id", clientMsgId);
            body.put("type", type);
            body.put("content_type", contentType);
            body.put("sent_at", sentAt);
            body.put("envelopes", envs);
            HttpResponse<String> r = postJson(serverUrl + "/api/offline/store", Json.write(body));
            if (r.statusCode() == 200) {
                for (Map<String, Object> e : envs) {
                    offlineStore.setState(clientMsgId, ((Number) e.get("recipient_id")).longValue(), "stored");
                }
                return true;
            }
            System.err.println("[e2e] store thất bại: " + r.statusCode() + " " + r.body());
            return false;
        } catch (Exception e) {
            System.err.println("[e2e] store lỗi: " + e.getMessage());
            return false;
        }
    }

    /** Gửi lại toàn bộ phong bì đang chờ trong outbox (khi có mạng trở lại). */
    public synchronized int retryPending() {
        if (e2e == null) {
            return 0;
        }
        Map<String, List<OfflineStore.OutboxEnvelope>> byMsg = new LinkedHashMap<>();
        for (OfflineStore.OutboxEnvelope e : offlineStore.pending(500)) {
            byMsg.computeIfAbsent(e.clientMsgId(), k -> new ArrayList<>()).add(e);
        }
        int sent = 0;
        for (Map.Entry<String, List<OfflineStore.OutboxEnvelope>> en : byMsg.entrySet()) {
            List<OfflineStore.OutboxEnvelope> list = en.getValue();
            List<Map<String, Object>> envs = new ArrayList<>();
            for (OfflineStore.OutboxEnvelope e : list) {
                Map<String, Object> mp = new LinkedHashMap<>();
                mp.put("recipient_id", e.recipientId());
                mp.put("algo", e.algo());
                mp.put("iv", e.ivB64());
                mp.put("wrapped_key", e.wrappedKeyB64());
                mp.put("signature", e.signatureB64());
                mp.put("ciphertext", e.ciphertextB64());
                envs.add(mp);
            }
            String cid = en.getKey();
            boolean isFile = cid != null && (cid.startsWith("file:") || cid.startsWith("file-") || cid.startsWith("file_"));
            String type = isFile ? "file" : "text";
            String contentType = isFile ? MediaRef.CONTENT_TYPE : "text";
            if (postStore(list.get(0).roomId(), cid, list.get(0).sentAt(), envs, type, contentType)) {
                sent += list.size();
            }
        }
        return sent;
    }

    /**
     * Người dùng bấm "Gửi lại" một tin cụ thể: xoá cờ cạn lượt rồi thử lại ngay
     * (mesh + hộp thư). Vẫn giữ trong outbox nếu chưa có ACK.
     */
    public synchronized void retryMessage(String clientMsgId) {
        if (clientMsgId == null || clientMsgId.isBlank()) {
            return;
        }
        PendingSend o = pendingSends.get(clientMsgId);
        if (o != null) {
            o.exhausted = false;
            o.attempts = 0;
            o.nextAt = 0L;
            if (o.meshFrame != null) {
                peerBroadcast(o.roomId, o.meshFrame);
            }
        }
        if (e2e != null && serverReachable && resendOutboxFor(clientMsgId)) {
            markSent(clientMsgId);
            return;
        }
        long roomId = o != null ? o.roomId : 0L;
        if (roomId == 0L) {
            OfflineStore.LocalMsg lm = offlineStore.localMsg(clientMsgId);
            if (lm != null) {
                roomId = lm.roomId();
            }
        }
        notifyUi(Map.of("type", "send_state", "roomId", roomId, "clientId", clientMsgId,
                "state", "stored", "retryable", o == null));
    }

    /**
     * Thời gian chờ trước lần thử lại kế tiếp (ms): 1,2,4,8,15,30 giây, kèm jitter ±20%
     * (tất định theo {@code jitterSeed} để kiểm thử được).
     */
    static long retryDelayMs(int attempts, long jitterSeed) {
        long[] base = {1000L, 2000L, 4000L, 8000L, 15000L, 30000L};
        int i = Math.max(0, Math.min(base.length - 1, attempts));
        long b = base[i];
        long span = b / 5;
        long off = span == 0 ? 0 : Math.floorMod(jitterSeed, 2 * span + 1) - span;
        return b + off;
    }

    /** Bắt đầu vòng thử lại (1 giây/lần) nếu chưa có. */
    private void ensureRetryScheduler() {
        if (retryScheduler != null) {
            return;
        }
        synchronized (this) {
            if (retryScheduler != null) {
                return;
            }
            retryScheduler = Executors.newSingleThreadScheduledExecutor((r) -> {
                Thread t = new Thread(r, "peer-retry");
                t.setDaemon(true);
                return t;
            });
            retryScheduler.scheduleWithFixedDelay(this::retryTick, 1000, 1000, TimeUnit.MILLISECONDS);
        }
    }

    /**
     * Chạy một tác vụ CHẶN (HTTP tới Tracker) ở luồng nền thay vì luồng sự kiện WebSocket.
     * Dùng cho các lệnh UI như `unlock`/`offline_pull`/`retry`/`delivery`: những việc này có
     * thể gọi Tracker với timeout 15 giây và lặp nhiều lần; nếu chạy ngay trên luồng UI thì
     * Peer Core không kịp trả `pong`/`send_state`, khiến UI báo "Mất kết nối" và tin kẹt
     * "Đang chờ" dù mạng bình thường.
     *
     * @param tag  nhãn để log lỗi (KHÔNG chứa dữ liệu nhạy cảm)
     * @param task việc cần chạy nền
     */
    public void runAsync(String tag, Runnable task) {
        asyncExecutor().execute(() -> {
            try {
                task.run();
            } catch (Exception e) {
                System.err.println("[peer-async] " + tag + " lỗi: " + e.getMessage());
            }
        });
    }

    /** Executor nền dùng chung (daemon "peer-async"), tạo lười khi cần lần đầu. */
    private ScheduledExecutorService asyncExecutor() {
        ScheduledExecutorService ex = asyncScheduler;
        if (ex == null) {
            synchronized (this) {
                if (asyncScheduler == null) {
                    asyncScheduler = Executors.newSingleThreadScheduledExecutor((r) -> {
                        Thread t = new Thread(r, "peer-async");
                        t.setDaemon(true);
                        return t;
                    });
                }
                ex = asyncScheduler;
            }
        }
        return ex;
    }

    /**
     * Kết luận Tracker có dùng được không (hàm thuần, dễ kiểm thử): đúng nếu kênh WS còn mở, hoặc
     * có bất kỳ tương tác Tracker nào thành công trong {@code deadMs} gần đây.
     */
    static boolean trackerReachable(boolean wsOpen, long lastOkAt, long now, long deadMs) {
        if (wsOpen) {
            return true;
        }
        return lastOkAt > 0 && now - lastOkAt <= deadMs;
    }

    /** Ghi nhận một tương tác Tracker thành công (HTTP nhận phản hồi hoặc WS mở) và cập nhật cờ. */
    public void noteTrackerOk() {
        lastTrackerOkAt = System.currentTimeMillis();
        recomputeServerReachable();
    }

    /** Bắt đầu canh nhịp kết nối Tracker (chỉ chạy 1 lần). */
    private void ensureTrackerWatchdog() {
        if (trackerWatchStarted) {
            return;
        }
        synchronized (this) {
            if (trackerWatchStarted) {
                return;
            }
            trackerWatchStarted = true;
            asyncExecutor().scheduleWithFixedDelay(this::recomputeServerReachable, TRACKER_WATCH_MS,
                    TRACKER_WATCH_MS, TimeUnit.MILLISECONDS);
        }
    }

    /**
     * Tính lại {@link #serverReachable} = WS còn mở HOẶC có tương tác Tracker thành công gần đây.
     * Khi cờ đổi thì đẩy frame {@code server_state} cho UI. Chạy từ luồng nền nên không chặn UI.
     */
    private void recomputeServerReachable() {
        boolean ok = trackerReachable(isSignalingOpen(), lastTrackerOkAt, System.currentTimeMillis(),
                TRACKER_DEAD_MS);
        if (ok != serverReachable) {
            serverReachable = ok;
            notifyUi(serverStateFrame(ok));
        }
    }

    /** Kênh WS signaling tới Tracker có đang mở (đã auth_ok) không. */
    private boolean isSignalingOpen() {
        WsSignaling s = signaling;
        return s != null && s.isOpen();
    }

    /** Đăng ký một tin đi chưa ACK để thử lại theo backoff. */
    private void trackOutbound(String clientId, long roomId, Map<String, Object> meshFrame) {
        if (clientId == null || clientId.isBlank()) {
            return;
        }
        PendingSend o = new PendingSend(clientId, roomId, meshFrame);
        o.nextAt = System.currentTimeMillis() + retryDelayMs(0, clientId.hashCode());
        pendingSends.put(clientId, o);
        ensureRetryScheduler();
    }

    /** Đánh dấu tin đi đã có ACK: ghi "sent" vào lịch sử cục bộ và báo UI. */
    private void markSent(String clientMsgId) {
        if (clientMsgId == null || clientMsgId.isBlank()) {
            return;
        }
        offlineStore.setLocalStatus(clientMsgId, "sent");
        PendingSend o = pendingSends.remove(clientMsgId);
        long roomId = o != null ? o.roomId : 0L;
        if (roomId == 0L) {
            OfflineStore.LocalMsg lm = offlineStore.localMsg(clientMsgId);
            if (lm != null) {
                roomId = lm.roomId();
            }
        }
        notifyUi(Map.of("type", "send_state", "roomId", roomId, "clientId", clientMsgId, "state", "sent"));
        System.out.println("[peer-send] send_state sent id=" + shortId(clientMsgId) + " room=" + roomId);
    }

    /** Gắn cờ "Gửi lại" khi một tin đã cạn số lần thử (vẫn giữ trong outbox). */
    private void markRetryable(PendingSend o) {
        notifyUi(Map.of("type", "send_state", "roomId", o.roomId, "clientId", o.clientId,
                "state", "stored", "retryable", true));
    }

    private void retryTick() {
        try {
            long now = System.currentTimeMillis();
            for (PendingSend o : pendingSends.values()) {
                // Tin đã "cạn lượt": nếu Tracker vẫn/đã kết nối được và đã chờ đủ lâu thì tự thử lại
                // (không bắt người dùng bấm "Gửi lại") — tránh kẹt "Đang chờ" sau khi mạng hồi phục.
                if (o.exhausted) {
                    if (shouldRearm(serverReachable, o.exhaustedAt, now)) {
                        o.exhausted = false;
                        o.attempts = 0;
                        o.nextAt = now;
                        System.out.println("[peer-retry] re-arm id=" + shortId(o.clientId) + " room=" + o.roomId);
                    } else {
                        continue;
                    }
                }
                if (now < o.nextAt) {
                    continue;
                }
                retryOutbound(o, now);
            }
            if (!sentFiles.isEmpty()) {
                sweepSentFiles();
            }
            if (!sentFilesV2.isEmpty()) {
                sweepSentFilesV2(now);
            }
            // Dọn vé hết hạn (không chặn vòng nền).
            fileTokens.sweep(now);
            // Kéo hộp thư định kỳ khi Tracker kết nối được: tin người khác gửi qua hộp thư
            // sẽ hiện ngay (không cần reload UI) kể cả khi kênh mesh đang đứt ngầm.
            int tick = ++retryTicks;
            LocalFileStore fs = fileStore;
            if (fs != null && tick % 60 == 0) {
                fs.sweep(now, FileTransferConfig.RESUME_TTL_MS);
            }
            if (e2e != null && serverReachable && tick % PULL_EVERY_TICKS == 0) {
                pullOffline();
            }
        } catch (Exception ignored) {
            // vòng nền: không để lỗi làm chết scheduler
        }
    }

    private void retryOutbound(PendingSend o, long now) {
        if (o.meshFrame != null) {
            peerBroadcast(o.roomId, o.meshFrame);
        }
        if (e2e != null && serverReachable && resendOutboxFor(o.clientId)) {
            // Hộp thư đã nhận (có ACK) → thành "Đã gửi", thôi thử lại.
            System.out.println("[peer-retry] acked id=" + shortId(o.clientId) + " room=" + o.roomId);
            markSent(o.clientId);
            return;
        }
        o.attempts++;
        o.nextAt = now + retryDelayMs(o.attempts, o.clientId.hashCode() * 31L + o.attempts);
        if (o.attempts >= MAX_SEND_ATTEMPTS) {
            o.exhausted = true;
            o.exhaustedAt = now;
            System.out.println("[peer-retry] exhausted id=" + shortId(o.clientId) + " room=" + o.roomId
                    + " attempts=" + o.attempts);
            markRetryable(o);
        }
    }

    /** Mã rút gọn của clientId để ghi log chẩn đoán (không phải nội dung tin). */
    private static String shortId(String s) {
        return s == null ? "-" : Integer.toHexString(s.hashCode());
    }

    /** Tin đã "cạn lượt" nên được tự thử lại chưa (Tracker kết nối được và đã chờ đủ lâu). */
    static boolean shouldRearm(boolean serverReachable, long exhaustedAt, long now) {
        return serverReachable && now - exhaustedAt >= REARM_AFTER_MS;
    }

    /** Gửi lại các phong bì còn chờ của một tin đi; trả true nếu hộp thư nhận (có ACK). */
    private boolean resendOutboxFor(String clientMsgId) {
        List<OfflineStore.OutboxEnvelope> list = new ArrayList<>();
        for (OfflineStore.OutboxEnvelope e : offlineStore.pending(500)) {
            if (e.clientMsgId().equals(clientMsgId)) {
                list.add(e);
            }
        }
        if (list.isEmpty()) {
            return false;
        }
        List<Map<String, Object>> envs = new ArrayList<>();
        for (OfflineStore.OutboxEnvelope e : list) {
            Map<String, Object> mp = new LinkedHashMap<>();
            mp.put("recipient_id", e.recipientId());
            mp.put("algo", e.algo());
            mp.put("iv", e.ivB64());
            mp.put("wrapped_key", e.wrappedKeyB64());
            mp.put("signature", e.signatureB64());
            mp.put("ciphertext", e.ciphertextB64());
            envs.add(mp);
        }
        return postStore(list.get(0).roomId(), clientMsgId, list.get(0).sentAt(), envs);
    }

    /** Thử lại ngay tất cả tin đang chờ (gọi khi Tracker kết nối lại).
     *  Re-arm cả tin đã "cạn lượt" để không kẹt "Đang chờ" sau khi mạng hồi phục. */
    private void retryAllNow() {
        long now = System.currentTimeMillis();
        for (PendingSend o : pendingSends.values()) {
            boolean wasExhausted = o.exhausted;
            o.exhausted = false;
            o.attempts = 0;
            o.nextAt = now;
            if (wasExhausted) {
                System.out.println("[peer-retry] re-arm (reconnect) id=" + shortId(o.clientId) + " room=" + o.roomId);
            }
        }
    }

    /** Đánh dấu phong bì đã giao (khi nhận xác nhận live) để dừng thử lại. */
    public synchronized void markDelivered(String clientMsgId, long recipientId) {
        offlineStore.setState(clientMsgId, recipientId, "acked");
    }

    public List<OfflineStore.LocalMsg> localHistory(long roomId, int limit) {
        return offlineStore.history(roomId, limit);
    }

    /** Trang lịch sử cũ hơn con trỏ (mới nhất trước) cho phân trang kéo lên. */
    public List<OfflineStore.LocalMsg> localHistoryBefore(long roomId, long beforeSentAt, int limit) {
        return offlineStore.historyBefore(roomId, beforeSentAt, limit);
    }

    /** Còn tin cũ hơn mốc con trỏ không? */
    public boolean hasMoreHistoryBefore(long roomId, long beforeSentAt) {
        return offlineStore.hasMoreBefore(roomId, beforeSentAt);
    }

    /** Khoá E2E đã mở (đã unlock) chưa — dùng để báo trạng thái gửi cho UI. */
    public boolean unlocked() {
        return e2e != null;
    }

    /**
     * Kéo hộp thư server, giải mã từng phong bì, kiểm chữ ký người gửi, lưu cục bộ,
     * đẩy frame "offline_message" tới UI rồi ack xóa khỏi server.
     */
    public synchronized int pullOffline() {
        E2eKeystore.Material mine = e2e;
        if (mine == null) {
            return 0;
        }
        int total = 0;
        long after = 0;
        for (int guard = 0; guard < 100; guard++) {
            JsonNode root;
            try {
                HttpResponse<String> r = postJson(serverUrl + "/api/offline/pull",
                        Json.write(Map.of("after", after)));
                if (r.statusCode() != 200) {
                    break;
                }
                root = Json.tree(r.body());
            } catch (Exception e) {
                System.err.println("[e2e] pull lỗi: " + e.getMessage());
                break;
            }
            JsonNode msgs = root.path("messages");
            mailboxHint = root.path("mailbox_hint").asInt(mailboxHint);
            if (!msgs.isArray() || msgs.isEmpty()) {
                break;
            }
            List<Long> ids = new ArrayList<>();
            for (JsonNode m : msgs) {
                long id = m.path("id").asLong();
                if (id > after) {
                    after = id;
                }
                ids.add(id);
                Map<String, Object> frame = decodeEnvelope(mine, m, id);
                if (frame == null) {
                    continue;
                }
                @SuppressWarnings("unchecked")
                Map<String, Object> msg = (Map<String, Object>) frame.get("message");
                if (MediaRef.CONTENT_TYPE.equals(msg.get("contentType"))) {
                    MediaRef ref = MediaRef.parse((String) msg.get("text"));
                    if (ref != null) {
                        long roomId = ((Number) msg.get("roomId")).longValue();
                        long senderId = ((Number) msg.get("senderId")).longValue();
                        long sentAt = ((Number) msg.get("sentAt")).longValue();
                        offlineStore.saveLocal(new OfflineStore.LocalMsg(
                                (String) msg.get("clientMsgId"), roomId, senderId, "file",
                                ref.toJson(), sentAt, "in", "delivered"));
                        LocalFileStore fs = fileStore;
                        if (fs != null && Files.exists(fs.data(ref.fileId()))) {
                            int chunks = FileChunks.count(ref.size(), FileTransferConfig.CHUNK_SIZE);
                            notifyUi(receivedFileFrame(ref, roomId, senderId, ref.sha256(), chunks));
                        } else {
                            enqueueBlobDownload(ref, roomId, senderId);
                        }
                    }
                    total++;
                    continue;
                }
                offlineStore.saveLocal(new OfflineStore.LocalMsg(
                        (String) msg.get("clientMsgId"), ((Number) msg.get("roomId")).longValue(),
                        ((Number) msg.get("senderId")).longValue(), (String) msg.get("contentType"),
                        (String) msg.get("text"), ((Number) msg.get("sentAt")).longValue(), "in", "delivered"));
                notifyUi(frame);
                total++;
            }
            if (!ids.isEmpty()) {
                ackServer(ids);
            }
            if (!root.path("has_more").asBoolean(false)) {
                break;
            }
        }
        return total;
    }

    /** Giải mã + xác thực một phong bì từ hộp thư; trả frame "offline_message" hoặc null. */
    private Map<String, Object> decodeEnvelope(E2eKeystore.Material mine, JsonNode m, long serverId) {
        try {
            long senderId = m.path("sender_id").asLong();
            long roomId = m.path("room_id").asLong();
            String clientMsgId = m.path("client_msg_id").asText("");
            String contentType = m.path("content_type").asText("text");
            long sentAt = m.path("sent_at").asLong();
            byte[] ct = CryptoBox.unb64(m.path("ciphertext").asText());
            byte[] wrapped = CryptoBox.unb64(m.path("wrapped_key").asText());
            byte[] sig = CryptoBox.unb64(m.path("signature").asText());
            PublicKey senderPub = peerE2eKey(senderId);
            if (senderPub == null) {
                System.err.println("[e2e] thiếu public key người gửi " + senderId);
                return null;
            }
            byte[] canonical = canonical(clientMsgId, identity.userId(), sentAt, ct);
            byte[] canonicalRaw = (clientMsgId + "|" + identity.userId() + "|" + sentAt + "|").getBytes(StandardCharsets.UTF_8);
            byte[] rawBytes = new byte[canonicalRaw.length + ct.length];
            System.arraycopy(canonicalRaw, 0, rawBytes, 0, canonicalRaw.length);
            System.arraycopy(ct, 0, rawBytes, canonicalRaw.length, ct.length);

            boolean sigOk = CryptoBox.verifyPss(senderPub, canonical, sig)
                    || CryptoBox.verifyPss(senderPub, rawBytes, sig);
            if (!sigOk) {
                System.err.println("[e2e] chữ ký không hợp lệ: " + clientMsgId);
                return null;
            }
            if (!(CryptoBox.unwrapOaep(mine.privateKey(), wrapped) instanceof CryptoBox.Result.Ok u)) {
                return null;
            }
            SecretKey aes = CryptoBox.aesFromBytes(u.data());
            if (!(CryptoBox.decryptAes(aes, ct) instanceof CryptoBox.Result.Ok d)) {
                return null;
            }
            String text = new String(d.data(), StandardCharsets.UTF_8);
            Map<String, Object> msg = new LinkedHashMap<>();
            msg.put("clientMsgId", clientMsgId);
            msg.put("roomId", roomId);
            msg.put("senderId", senderId);
            msg.put("contentType", contentType);
            msg.put("text", text);
            msg.put("sentAt", sentAt);
            msg.put("offline", true);
            Map<String, Object> frame = new LinkedHashMap<>();
            frame.put("type", "offline_message");
            frame.put("serverId", serverId);
            frame.put("message", msg);
            return frame;
        } catch (Exception e) {
            System.err.println("[e2e] giải mã phong bì lỗi: " + e.getMessage());
            return null;
        }
    }

    private void ackServer(List<Long> ids) {
        try {
            postJson(serverUrl + "/api/offline/ack", Json.write(Map.of("ids", ids)));
        } catch (Exception e) {
            System.err.println("[e2e] ack lỗi: " + e.getMessage());
        }
    }

    private HttpResponse<String> postJson(String url, String json) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(15))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json, StandardCharsets.UTF_8));
        String tok = authToken;
        if (tok != null) {
            b.header("Authorization", "Bearer " + tok);
        }
        HttpResponse<String> r = HTTP.send(b.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        // Nhận được phản hồi HTTP (kể cả 4xx) nghĩa là đường tới Tracker còn thông → cờ "Tracker
        // dùng được" không phụ thuộc riêng kênh WS (vốn hay đứt/nối lại mà HTTP không hề hấn).
        noteTrackerOk();
        return r;
    }

    private HttpResponse<String> deleteJson(String url) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(15))
                .DELETE();
        String tok = authToken;
        if (tok != null) {
            b.header("Authorization", "Bearer " + tok);
        }
        HttpResponse<String> r = HTTP.send(b.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        noteTrackerOk();
        return r;
    }

    private HttpResponse<String> getJson(String url) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(15))
                .GET();
        String tok = authToken;
        if (tok != null) {
            b.header("Authorization", "Bearer " + tok);
        }
        HttpResponse<String> r = HTTP.send(b.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        noteTrackerOk();
        return r;
    }

    // ---------- UI nội bộ (React qua WS local) ----------

    public void registerUi(Channel ch) {
        uiClients.add(ch);
        // Gửi ngay trạng thái kết nối Tracker hiện tại cho client vừa gắn (tránh UI hiểu nhầm
        // là mất mạng cho tới khi có frame server_state kế tiếp).
        ch.writeAndFlush(new TextWebSocketFrame(Json.write(serverStateFrame(serverReachable))));
    }

    public void unregisterUi(Channel ch) {
        uiClients.remove(ch);
    }

    public int notifyUi(Map<String, Object> frame) {
        String json = Json.write(frame);
        int active = 0;
        for (Channel c : uiClients) {
            if (c.isActive()) {
                c.writeAndFlush(new TextWebSocketFrame(json));
                active++;
            }
        }
        if (frame != null && "call".equals(frame.get("type"))) {
            Map<String, Object> dbg = CallDebug.summary(frame);
            dbg.put("activeUiClients", active);
            if (active == 0) {
                dbg.put("canhBao", "KHONG_CO_UI_NAO_DANG_NOI");
            }
            CallDebug.log("core-chuyen-ui", dbg);
        }
        return active;
    }

    /**
     * Core bên gọi nhận ack end-to-end từ Core bên nhận (LỖI B). Xác thực tối thiểu: peer gửi ack
     * phải là thành viên của phòng và ack phải mang {@code callId}; nếu không thì bỏ qua an toàn.
     * Sau đó chuyển thành frame {@code call_state} cho UI: {@code acked} (đã tới ≥1 UI) hoặc
     * {@code ack_no_ui} (Core nhận đã nhận nhưng không có UI nào đang nối).
     */
    void handleCallAck(Map<String, Object> m, long from) {
        Object rv = m.get("roomId");
        long roomId = rv instanceof Number n ? n.longValue() : 0L;
        Map<Long, PeerEntry> room = roomId > 0 ? roomPeers.get(roomId) : null;
        if (room == null || !room.containsKey(from)) {
            return;
        }
        Object cid = m.get("callId");
        if (cid == null) {
            return;
        }
        int uiCount = m.get("uiCount") instanceof Number un ? un.intValue() : 0;
        Map<String, Object> st = new ConcurrentHashMap<>();
        st.put("type", "call_state");
        st.put("callId", cid);
        st.put("roomId", roomId);
        st.put("state", uiCount > 0 ? "acked" : "ack_no_ui");
        st.put("uiCount", uiCount);
        st.put("ts", System.currentTimeMillis());
        notifyUi(st);
        Map<String, Object> dbg = CallDebug.summary(m);
        dbg.put("ack", uiCount > 0 ? "acked" : "ack_no_ui");
        dbg.put("uiCount", uiCount);
        CallDebug.log("core-ack-nhan", dbg);
    }

    /** Tracker có kết nối được (đã auth WS thành công) không. */
    public boolean serverReachable() {
        return serverReachable;
    }

    /** WS signaling báo đổi trạng thái kết nối Tracker. KHÔNG kết luận mất Tracker chỉ vì WS đứt:
     * chỉ cần HTTP vẫn thông gần đây thì Tracker vẫn dùng được (tin vẫn vào hộp thư). Vì vậy chỉ
     * ghi nhận "vừa có phản hồi" khi WS mở, rồi tính lại cờ theo {@link #TRACKER_DEAD_MS}; luôn đẩy
     * frame để UI cập nhật cả mức "thời gian thực bị gián đoạn" (WS đứt nhưng HTTP còn). */
    public void onSignalingConnectivity(boolean connected) {
        if (connected) {
            lastTrackerOkAt = System.currentTimeMillis();
        }
        ensureTrackerWatchdog();
        recomputeServerReachable();
        notifyUi(serverStateFrame(serverReachable));
    }

    /**
     * Dựng frame {@code server_state} kèm lý do (không nhạy cảm) để UI hiển thị vì sao mất kết nối:
     * địa chỉ Tracker (host:port), trạng thái kênh WS, số lần nối lại, lần cuối nhận pong, lỗi cuối.
     */
    private Map<String, Object> serverStateFrame(boolean connected) {
        Map<String, Object> frame = new java.util.LinkedHashMap<>();
        frame.put("type", "server_state");
        frame.put("connected", connected);
        frame.put("realtime", isSignalingOpen());
        frame.put("http", lastTrackerOkAt);
        WsSignaling sig = signaling;
        if (sig != null) {
            frame.putAll(sig.status());
        }
        return frame;
    }

    /**
     * Tracker kết nối được trở lại: tự động gửi lại outbox đang chờ rồi kéo hộp thư.
     * No-op nếu khoá E2E chưa mở (sẽ chạy lại khi người dùng mở khoá).
     */
    public void onServerReachable() {
        noteTrackerOk();
        retryAllNow();
        try {
            retryPending();
        } catch (Exception e) {
            System.err.println("[e2e] retryPending lỗi: " + e.getMessage());
        }
        try {
            pullOffline();
        } catch (Exception e) {
            System.err.println("[e2e] pullOffline lỗi: " + e.getMessage());
        }
    }

    // ---------- signaling từ server ----------

    public void onPeerAddress(long roomId, List<Map<String, Object>> peers) {
        Map<Long, PeerEntry> room = roomPeers.computeIfAbsent(roomId, k -> new ConcurrentHashMap<>());
        Set<Long> present = new java.util.HashSet<>();
        for (Map<String, Object> p : peers) {
            if (!(p.get("userId") instanceof Number n)) {
                continue;
            }
            long uid = n.longValue();
            if (uid == identity.userId()) {
                continue;
            }
            String ip = String.valueOf(p.get("ip"));
            int port = ((Number) p.getOrDefault("port", 0)).intValue();
            Object pk = p.get("pubkey");
            String pubKey = pk == null ? "" : pk.toString();
            int udpPort = p.get("udpPort") instanceof Number un ? un.intValue() : 0;
            String udpPublicIp = p.get("udpPublicIp") == null ? "" : p.get("udpPublicIp").toString();
            int udpPublicPort = p.get("udpPublicPort") instanceof Number upn ? upn.intValue() : 0;
            room.put(uid, new PeerEntry(uid, String.valueOf(p.get("username")), ip, port, pubKey,
                    udpPort, udpPublicIp, udpPublicPort));
            if (!pubKey.isBlank()) {
                idPubByUser.put(uid, pubKey);
            }
            if (udpPort > 0) {
                udpPeers.computeIfAbsent(uid, (k) -> new UdpState());
            }
            present.add(uid);
        }
        // Tracker đã bỏ peer (hết heartbeat/offline): gỡ khỏi phòng và đóng link cũ.
        room.keySet().removeIf(uid -> uid != identity.userId() && !present.contains(uid));
        for (Long uid : new java.util.ArrayList<>(linksByUserId.keySet())) {
            if (uid != identity.userId() && !isKnownPeer(uid)) {
                PeerLink l = linksByUserId.remove(uid);
                if (l != null) {
                    l.close();
                }
                udpPeers.remove(uid);
            }
        }
        refreshRoomLinks();
    }

    /** Tracker báo online/offline của một thành viên; chuyển tiếp cho UI React cập nhật. */
    public void onPresence(long userId, boolean online, String username) {
        Map<String, Object> frame = new java.util.LinkedHashMap<>();
        frame.put("type", "presence");
        frame.put("userId", userId);
        frame.put("online", online);
        if (username != null && !username.isBlank()) {
            frame.put("username", username);
        }
        notifyUi(frame);
    }

    private boolean isKnownPeer(long userId) {
        for (Map<Long, PeerEntry> room : roomPeers.values()) {
            if (room.containsKey(userId)) {
                return true;
            }
        }
        return false;
    }

    public void attachSignaling(WsSignaling s) {
        this.signaling = s;
    }

    public String serverUrl() {
        return serverUrl;
    }

    private static String str(Map<String, Object> m, String k) {
        Object v = m.get(k);
        return v == null ? null : v.toString();
    }
}