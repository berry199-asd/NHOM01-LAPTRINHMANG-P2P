package com.workchat.peer.net;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.MulticastSocket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Mở cổng tự động qua UPnP IGD (SSDP + SOAP), JDK thuần — không cần thư viện ngoài.
 *
 * <p>Luồng: M-SEARCH multicast → đọc LOCATION của thiết bị IGD → tải mô tả thiết bị →
 * tìm service WANIPConnection/WANPPPConnection → gọi {@code AddPortMapping}. Đây là
 * kênh "tốt nhất có thể": router không hỗ trợ UPnP sẽ thất bại êm và fallback sang NAT-PMP.
 */
public final class UpnpPortMapper {
    public static final String SSDP_ADDR = "239.255.255.250";
    public static final int SSDP_PORT = 1900;
    private static final String[] DISCOVER_ST = {
            "urn:schemas-upnp-org:device:InternetGatewayDevice:1",
            "urn:schemas-upnp-org:service:WANIPConnection:1",
            "urn:schemas-upnp-org:service:WANPPPConnection:1",
            "upnp:rootdevice",
    };
    private static final String[] SERVICE_PREFERENCE = {
            "urn:schemas-upnp-org:service:WANIPConnection:2",
            "urn:schemas-upnp-org:service:WANIPConnection:1",
            "urn:schemas-upnp-org:service:WANPPPConnection:1",
    };

    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(2))
            .build();

    /** Service điều khiển cổng trên IGD. */
    public record Service(String serviceType, String controlUrl, InetAddress responder) {
    }

    /** Kết quả mở cổng qua UPnP. */
    public record MapResult(boolean ok, int externalPort, String externalIp, String error) {
    }

    private UpnpPortMapper() {
    }

    // ---------- Hàm thuần (kiểm thử không cần mạng) ----------

    /** Tạo bản tin M-SEARCH cho một Search Target. */
    public static byte[] msSearch(String st) {
        String msg = "M-SEARCH * HTTP/1.1\r\n"
                + "HOST: " + SSDP_ADDR + ":" + SSDP_PORT + "\r\n"
                + "MAN: \"ssdp:discover\"\r\n"
                + "MX: 2\r\n"
                + "ST: " + st + "\r\n"
                + "\r\n";
        return msg.getBytes(StandardCharsets.US_ASCII);
    }

    /** Lấy giá trị header {@code LOCATION} từ phản hồi SSDP (không phân biệt hoa thường). */
    public static String locationFromResponse(String response) {
        if (response == null) {
            return null;
        }
        for (String line : response.split("\\r?\\n")) {
            int c = line.indexOf(':');
            if (c > 0 && line.substring(0, c).trim().equalsIgnoreCase("LOCATION")) {
                return line.substring(c + 1).trim();
            }
        }
        return null;
    }

    /** Lấy nội dung thẻ XML đầu tiên {@code <tag>...</tag>} (bỏ namespace tiền tố). */
    public static String extractTag(String xml, String tag) {
        if (xml == null) {
            return null;
        }
        Matcher m = Pattern.compile("<(?:\\w+:)?" + Pattern.quote(tag) + ">(.*?)</(?:\\w+:)?"
                + Pattern.quote(tag) + ">", Pattern.DOTALL | Pattern.CASE_INSENSITIVE).matcher(xml);
        return m.find() ? m.group(1).trim() : null;
    }

    /**
     * Tìm service điều khiển cổng WAN trong mô tả thiết bị. Ưu tiên WANIPConnection rồi
     * WANPPPConnection. Trả về {@code null} nếu không có.
     */
    public static Service parseService(String xml, String locationUrl) {
        if (xml == null) {
            return null;
        }
        String urlBase = extractTag(xml, "URLBase");
        String base = (urlBase != null && !urlBase.isBlank()) ? urlBase : locationUrl;
        Map<String, String> byType = new LinkedHashMap<>();
        Matcher blocks = Pattern.compile("<service>(.*?)</service>", Pattern.DOTALL | Pattern.CASE_INSENSITIVE).matcher(xml);
        while (blocks.find()) {
            String block = blocks.group(1);
            String st = extractTag(block, "serviceType");
            String cu = extractTag(block, "controlURL");
            if (st != null && cu != null && !cu.isBlank()) {
                byType.putIfAbsent(st, resolve(base, cu));
            }
        }
        for (String pref : SERVICE_PREFERENCE) {
            for (Map.Entry<String, String> e : byType.entrySet()) {
                if (e.getKey().startsWith(pref)) {
                    return new Service(e.getKey(), e.getValue(), null);
                }
            }
        }
        return null;
    }

    /** Ghép URL tương đối vào base (fault-tolerant). */
    public static String resolve(String base, String relative) {
        String rel = relative.trim();
        if (rel.startsWith("http://") || rel.startsWith("https://")) {
            return rel;
        }
        try {
            URI b = URI.create(base.trim());
            return b.resolve(rel).toString();
        } catch (Exception e) {
            return rel;
        }
    }

    /** SOAP action header: {@code "serviceType#action"}. */
    public static String soapAction(String serviceType, String action) {
        return "\"" + serviceType + "#" + action + "\"";
    }

    /** Thân SOAP {@code AddPortMapping}. */
    public static String addPortMappingBody(String serviceType, int externalPort, String protocol,
                                            int internalPort, String internalClient, String description,
                                            int leaseSeconds) {
        return envelope(serviceType, "AddPortMapping",
                "<NewRemoteHost></NewRemoteHost>"
                        + "<NewExternalPort>" + externalPort + "</NewExternalPort>"
                        + "<NewProtocol>" + protocol + "</NewProtocol>"
                        + "<NewInternalPort>" + internalPort + "</NewInternalPort>"
                        + "<NewInternalClient>" + xmlEscape(internalClient) + "</NewInternalClient>"
                        + "<NewEnabled>1</NewEnabled>"
                        + "<NewPortMappingDescription>" + xmlEscape(description) + "</NewPortMappingDescription>"
                        + "<NewLeaseDuration>" + leaseSeconds + "</NewLeaseDuration>");
    }

    /** Thân SOAP {@code DeletePortMapping}. */
    public static String deletePortMappingBody(String serviceType, int externalPort, String protocol) {
        return envelope(serviceType, "DeletePortMapping",
                "<NewRemoteHost></NewRemoteHost>"
                        + "<NewExternalPort>" + externalPort + "</NewExternalPort>"
                        + "<NewProtocol>" + protocol + "</NewProtocol>");
    }

    /** Thân SOAP {@code GetExternalIPAddress}. */
    public static String externalIpBody(String serviceType) {
        return envelope(serviceType, "GetExternalIPAddress", "");
    }

    /** Phản hồi SOAP có phải lỗi không (IGD trả HTTP 200 kèm {@code <errorCode>} hoặc SOAP Fault). */
    public static boolean isSoapFault(String body) {
        if (body == null) {
            return true;
        }
        String lower = body.toLowerCase(java.util.Locale.ROOT);
        return lower.contains("<errorcode>") || lower.contains(":fault") || lower.contains("<upnperror");
    }

    private static String envelope(String serviceType, String action, String inner) {
        return "<?xml version=\"1.0\"?>"
                + "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" "
                + "s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">"
                + "<s:Body>"
                + "<u:" + action + " xmlns:u=\"" + serviceType + "\">" + inner + "</u:" + action + ">"
                + "</s:Body></s:Envelope>";
    }

    private static String xmlEscape(String s) {
        if (s == null) {
            return "";
        }
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace("\"", "&quot;").replace("'", "&apos;");
    }

    // ---------- Phần cần mạng ----------

    /** Dò thiết bị IGD: trả danh sách service điều khiển cổng (đã khử trùng theo controlURL). */
    public static List<Service> discover(int timeoutMs) {
        Map<String, InetAddress> locations = new LinkedHashMap<>();
        try (MulticastSocket sock = new MulticastSocket()) {
            sock.setTimeToLive(2);
            sock.setSoTimeout(400);
            InetAddress group = InetAddress.getByName(SSDP_ADDR);
            for (String st : DISCOVER_ST) {
                byte[] msg = msSearch(st);
                sock.send(new DatagramPacket(msg, msg.length, group, SSDP_PORT));
            }
            long end = System.currentTimeMillis() + Math.max(600, timeoutMs);
            while (System.currentTimeMillis() < end) {
                byte[] buf = new byte[4096];
                DatagramPacket resp = new DatagramPacket(buf, buf.length);
                try {
                    sock.receive(resp);
                } catch (java.net.SocketTimeoutException e) {
                    continue;
                } catch (Exception e) {
                    break;
                }
                String text = new String(resp.getData(), 0, resp.getLength(), StandardCharsets.UTF_8);
                String loc = locationFromResponse(text);
                if (loc != null && !loc.isBlank()) {
                    locations.putIfAbsent(loc, resp.getAddress());
                }
            }
        } catch (Exception e) {
            return List.of();
        }

        List<Service> services = new ArrayList<>();
        for (Map.Entry<String, InetAddress> e : locations.entrySet()) {
            Service s = parseService(fetch(e.getKey()), e.getKey());
            if (s != null) {
                services.add(new Service(s.serviceType(), s.controlUrl(), e.getValue()));
            }
        }
        return services;
    }

    private static String fetch(String url) {
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(2))
                    .GET().build();
            HttpResponse<String> r = HTTP.send(req, HttpResponse.BodyHandlers.ofString());
            return r.statusCode() == 200 ? r.body() : null;
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Gọi AddPortMapping. Trả về externalPort khi thành công, ngược lại -1 kèm lý do.
     */
    public static MapResult addMapping(Service service, String protocol, int internalPort,
                                       String internalClient, String description, int leaseSeconds) {
        try {
            String body = post(service, "AddPortMapping",
                    addPortMappingBody(service.serviceType(), internalPort, protocol, internalPort,
                            internalClient, description, leaseSeconds));
            if (body == null) {
                return new MapResult(false, 0, "", "no_response");
            }
            if (isSoapFault(body)) {
                return new MapResult(false, 0, "", "soap_fault");
            }
            return new MapResult(true, internalPort, externalIp(service), "");
        } catch (Exception e) {
            return new MapResult(false, 0, "", e.getClass().getSimpleName());
        }
    }

    /** Lấy địa chỉ IP công khai theo IGD (rỗng nếu không lấy được). */
    public static String externalIp(Service service) {
        try {
            String body = post(service, "GetExternalIPAddress", externalIpBody(service.serviceType()));
            if (body == null || isSoapFault(body)) {
                return "";
            }
            String ip = extractTag(body, "NewExternalIPAddress");
            return ip == null ? "" : ip;
        } catch (Exception e) {
            return "";
        }
    }

    /** Gọi DeletePortMapping (dọn dẹp khi tắt). */
    public static boolean deleteMapping(Service service, String protocol, int externalPort) {
        try {
            String body = post(service, "DeletePortMapping",
                    deletePortMappingBody(service.serviceType(), externalPort, protocol));
            return body != null && !isSoapFault(body);
        } catch (Exception e) {
            return false;
        }
    }

    private static String post(Service service, String action, String body) {
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(service.controlUrl()))
                    .timeout(Duration.ofSeconds(3))
                    .header("Content-Type", "text/xml; charset=\"utf-8\"")
                    .header("SOAPAction", soapAction(service.serviceType(), action))
                    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                    .build();
            HttpResponse<String> r = HTTP.send(req, HttpResponse.BodyHandlers.ofString());
            return r.statusCode() == 200 ? r.body() : null;
        } catch (Exception e) {
            return null;
        }
    }

    /** Địa chỉ IP nội bộ dùng để tới {@code target} (thường là gateway). */
    public static String localAddressFor(InetAddress target) {
        try (DatagramSocket s = new DatagramSocket()) {
            s.connect(target, 9);
            return s.getLocalAddress().getHostAddress();
        } catch (Exception e) {
            try {
                return InetAddress.getLocalHost().getHostAddress();
            } catch (Exception e2) {
                return "";
            }
        }
    }

    /** Chuyển host:port thành {@link InetSocketAddress} an toàn (dùng khi cần). */
    public static InetSocketAddress addr(String host, int port) {
        return new InetSocketAddress(host, port);
    }
}
