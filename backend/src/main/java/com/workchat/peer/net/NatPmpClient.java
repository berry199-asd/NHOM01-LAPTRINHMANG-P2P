package com.workchat.peer.net;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * NAT-PMP client tối giản (RFC 6886) dùng JDK thuần: gửi yêu cầu ánh xạ cổng tới
 * gateway mặc định ở UDP 5351. Hỗ trợ Map UDP (opcode 1) và Map TCP (opcode 2).
 *
 * <p>Bổ trợ cho UPnP IGD: nhiều router nhỏ/Apple AirPort/một số modem hỗ trợ NAT-PMP
 * nhưng không hỗ trợ UPnP đầy đủ. Đây là kênh mở cổng "tốt nhất có thể", không bắt buộc.
 *
 * <p>Các hàm mã hoá/giải mã gói được tách thuần để kiểm thử không cần mạng.
 */
public final class NatPmpClient {
    /** Cổng UDP chuẩn của dịch vụ NAT-PMP. */
    public static final int SERVER_PORT = 5351;
    private static final byte VERSION = 0;

    public enum Protocol {
        UDP, TCP
    }

    /** Kết quả một lần ánh xạ. {@code externalPort > 0} khi thành công. */
    public record Mapping(boolean ok, int internalPort, int externalPort, int lifetimeSeconds, String error) {
        static Mapping fail(int internalPort, String error) {
            return new Mapping(false, internalPort, 0, 0, error);
        }
    }

    private NatPmpClient() {
    }

    /** Gói Map request 12 byte (hàm thuần để kiểm thử). */
    public static byte[] mapRequest(Protocol proto, int internalPort, int suggestedExternalPort, int lifetimeSeconds) {
        ByteBuffer b = ByteBuffer.allocate(12);
        b.put(VERSION);
        b.put((byte) (proto == Protocol.UDP ? 1 : 2));
        b.putShort((short) 0);
        b.putShort((short) internalPort);
        b.putShort((short) suggestedExternalPort);
        b.putInt(lifetimeSeconds);
        return b.array();
    }

    /** Giải mã gói Map response 16 byte (hàm thuần để kiểm thử). */
    public static Mapping parseResponse(byte[] resp, int len, Protocol proto) {
        if (resp == null || len < 16) {
            return Mapping.fail(0, "short");
        }
        int version = resp[0] & 0xff;
        int op = resp[1] & 0xff;
        int expected = (proto == Protocol.UDP ? 1 : 2) | 0x80;
        if (version != VERSION || op != expected) {
            return Mapping.fail(0, "bad_opcode");
        }
        int result = u16(resp, 2);
        int internalPort = u16(resp, 8);
        int externalPort = u16(resp, 10);
        int lifetime = (int) u32(resp, 12);
        if (result != 0) {
            return new Mapping(false, internalPort, externalPort, lifetime, "result=" + result);
        }
        return new Mapping(true, internalPort, externalPort, lifetime, "");
    }

    /**
     * Gửi yêu cầu ánh xạ tới {@code gateway}:5351 (thử tối đa 2 lần, RFC 6886 khuyến nghị
     * gửi lại khi mất gói). Trả về {@link Mapping}; thất bại thì {@code ok=false}.
     */
    public static Mapping map(InetAddress gateway, Protocol proto, int internalPort,
                              int suggestedExternalPort, int lifetimeSeconds, int timeoutMs) {
        if (gateway == null) {
            return Mapping.fail(internalPort, "no_gateway");
        }
        byte[] req = mapRequest(proto, internalPort, suggestedExternalPort, lifetimeSeconds);
        for (int attempt = 0; attempt < 2; attempt++) {
            try (DatagramSocket s = new DatagramSocket()) {
                s.setSoTimeout(timeoutMs);
                s.send(new DatagramPacket(req, req.length, gateway, SERVER_PORT));
                byte[] buf = new byte[32];
                DatagramPacket resp = new DatagramPacket(buf, buf.length);
                s.receive(resp);
                return parseResponse(resp.getData(), resp.getLength(), proto);
            } catch (Exception e) {
                if (attempt == 1) {
                    return Mapping.fail(internalPort, e.getClass().getSimpleName());
                }
            }
        }
        return Mapping.fail(internalPort, "retry_exhausted");
    }

    private static int u16(byte[] b, int off) {
        return ((b[off] & 0xff) << 8) | (b[off + 1] & 0xff);
    }

    private static long u32(byte[] b, int off) {
        return ((long) (b[off] & 0xff) << 24) | ((b[off + 1] & 0xff) << 16)
                | ((b[off + 2] & 0xff) << 8) | (b[off + 3] & 0xff);
    }

    // ---------- Dò gateway mặc định (theo nền tảng, chỉ dùng khi UPnP không cho IP) ----------

    /** Dò gateway mặc định theo OS (Windows {@code route print}; Unix {@code netstat -rn}/{@code ip route}). */
    public static InetAddress defaultGateway() {
        InetAddress g = parseWindowsRoute(run("route", "print"));
        if (g != null) {
            return g;
        }
        g = parseUnixRoute(run("netstat", "-rn"));
        if (g != null) {
            return g;
        }
        return parseIpRoute(run("ip", "route"));
    }

    /** Phân tích đầu ra {@code route print} của Windows: dòng "0.0.0.0 0.0.0.0 <gw> ..." (hàm thuần). */
    public static InetAddress parseWindowsRoute(String out) {
        if (out == null) {
            return null;
        }
        for (String line : out.split("\\r?\\n")) {
            String t = line.trim();
            String[] parts = t.split("\\s+");
            if (parts.length >= 3 && "0.0.0.0".equals(parts[0]) && "0.0.0.0".equals(parts[1])) {
                InetAddress a = address(parts[2]);
                if (a != null) {
                    return a;
                }
            }
        }
        return null;
    }

    /** Phân tích {@code netstat -rn}: dòng bắt đầu bằng "default" hoặc "0.0.0.0" (hàm thuần). */
    public static InetAddress parseUnixRoute(String out) {
        if (out == null) {
            return null;
        }
        for (String line : out.split("\\r?\\n")) {
            String t = line.trim();
            String[] parts = t.split("\\s+");
            if (parts.length >= 2 && ("default".equals(parts[0]) || "0.0.0.0".equals(parts[0]))) {
                InetAddress a = address(parts[1]);
                if (a != null) {
                    return a;
                }
            }
        }
        return null;
    }

    /** Phân tích {@code ip route}: dòng "default via <gw> ..." (hàm thuần). */
    public static InetAddress parseIpRoute(String out) {
        if (out == null) {
            return null;
        }
        for (String line : out.split("\\r?\\n")) {
            String[] parts = line.trim().split("\\s+");
            if (parts.length >= 3 && "default".equals(parts[0]) && "via".equals(parts[1])) {
                InetAddress a = address(parts[2]);
                if (a != null) {
                    return a;
                }
            }
        }
        return null;
    }

    private static InetAddress address(String s) {
        if (s == null || s.isBlank() || "On-link".equalsIgnoreCase(s) || "0.0.0.0".equals(s)) {
            return null;
        }
        try {
            return InetAddress.getByName(s);
        } catch (Exception e) {
            return null;
        }
    }

    private static String run(String... cmd) {
        try {
            Process p = new ProcessBuilder(cmd).redirectErrorStream(true).start();
            List<String> lines = new ArrayList<>();
            try (BufferedReader r = new BufferedReader(
                    new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                int max = 400;
                while ((line = r.readLine()) != null && lines.size() < max) {
                    lines.add(line);
                }
            }
            if (!p.waitFor(3, TimeUnit.SECONDS)) {
                p.destroyForcibly();
            }
            return String.join("\n", lines);
        } catch (Exception e) {
            return null;
        }
    }
}
