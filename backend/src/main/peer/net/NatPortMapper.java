package com.workchat.peer.net;

import java.net.InetAddress;
import java.util.List;

/**
 * Điều phối mở cổng tự động cho Peer Core: thử UPnP IGD trước, không được thì NAT-PMP.
 * Luôn chạy nền và "tốt nhất có thể" — thất bại không ảnh hưởng STUN/đục lỗ/Relay.
 *
 * <p>Bật/tắt qua biến môi trường {@code PEER_NAT_MAPPING} (mặc định bật; "0"/"off"/"false" để tắt).
 */
public final class NatPortMapper {
    /** Thông báo kết quả cho Peer Core. */
    public interface Listener {
        void onMapped(int udpPort, int externalPort, String externalIp, String method);

        void onFailed(String reason);
    }

    /** Kết quả một lần thử mở cổng. */
    public record Result(boolean ok, String method, int udpPort, int udpExternalPort,
                         String externalIp, String detail) {
    }

    private NatPortMapper() {
    }

    /** Có bật mở cổng tự động không (mặc định bật). */
    public static boolean enabled() {
        String v = System.getenv("PEER_NAT_MAPPING");
        if (v == null || v.isBlank()) {
            return true;
        }
        String t = v.trim().toLowerCase(java.util.Locale.ROOT);
        return !(t.equals("0") || t.equals("off") || t.equals("false") || t.equals("none"));
    }

    /** Chạy mở cổng trên luồng nền rồi gọi {@code listener} (không ném ra ngoài). */
    public static void startAsync(int udpPort, int tcpPort, Listener listener) {
        Thread t = new Thread(() -> {
            if (!enabled()) {
                if (listener != null) {
                    listener.onFailed("disabled");
                }
                return;
            }
            Result r = map(udpPort, tcpPort);
            if (listener == null) {
                return;
            }
            if (r.ok()) {
                listener.onMapped(r.udpPort(), r.udpExternalPort(), r.externalIp(), r.method());
            } else {
                listener.onFailed(r.detail());
            }
        }, "nat-map");
        t.setDaemon(true);
        t.start();
    }

    /** Thử UPnP rồi NAT-PMP cho cổng UDP (và TCP nếu &gt; 0). */
    public static Result map(int udpPort, int tcpPort) {
        List<UpnpPortMapper.Service> services = UpnpPortMapper.discover(2200);
        InetAddress responder = services.isEmpty() ? null : services.get(0).responder();
        String upnpDetail = "not_found";
        if (!services.isEmpty()) {
            String client = UpnpPortMapper.localAddressFor(services.get(0).responder());
            UpnpPortMapper.MapResult best = null;
            UpnpPortMapper.Service used = null;
            for (UpnpPortMapper.Service s : services) {
                UpnpPortMapper.MapResult m =
                        UpnpPortMapper.addMapping(s, "UDP", udpPort, client, "WorkChat-P2P", 0);
                if (m.ok()) {
                    best = m;
                    used = s;
                    break;
                }
                upnpDetail = m.error();
            }
            if (best != null && best.ok()) {
                if (tcpPort > 0) {
                    UpnpPortMapper.addMapping(used, "TCP", tcpPort, client, "WorkChat-P2P", 0);
                }
                return new Result(true, "upnp", udpPort, best.externalPort(), best.externalIp(), "");
            }
            if (best == null) {
                upnpDetail = "no_service";
            }
        }

        InetAddress gw = NatPmpClient.defaultGateway();
        if (gw == null) {
            gw = responder;
        }
        if (gw != null) {
            NatPmpClient.Mapping m =
                    NatPmpClient.map(gw, NatPmpClient.Protocol.UDP, udpPort, udpPort, 0, 900);
            if (m.ok()) {
                if (tcpPort > 0) {
                    NatPmpClient.map(gw, NatPmpClient.Protocol.TCP, tcpPort, tcpPort, 0, 900);
                }
                return new Result(true, "natpmp", udpPort, m.externalPort(), "", "");
            }
            return new Result(false, "", udpPort, 0, "", "upnp=" + upnpDetail + ";natpmp=" + m.error());
        }
        return new Result(false, "", udpPort, 0, "", "upnp=" + upnpDetail + ";natpmp=no_gateway");
    }
}
