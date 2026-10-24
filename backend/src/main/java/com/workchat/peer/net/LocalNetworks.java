package com.workchat.peer.net;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.List;
import java.util.Locale;

/**
 * Phân loại đường vận chuyển tới một peer: {@code lan | zerotier | public}.
 *
 * <p>ZeroTier tạo một giao diện mạng ảo (Windows: "ZeroTier One [..]", Linux: {@code zt..}).
 * Nếu IP peer nằm trong dải của giao diện ZeroTier thì coi là {@code zerotier}; nằm trong
 * dải của giao diện cục bộ khác (hoặc thuộc dải riêng tư) là {@code lan}; còn lại là
 * {@code public}. Chỉ đọc cấu hình giao diện, không cần quyền đặc biệt.
 */
public final class LocalNetworks {

    /** Một dải mạng cục bộ; {@code cidr} dạng {@code "a.b.c.d/prefix"}. */
    public record Iface(String cidr, boolean zeroTier) {
    }

    private LocalNetworks() {
    }

    /** Quét giao diện IPv4 đang hoạt động (bỏ loopback/down). Không ném lỗi ra ngoài. */
    public static List<Iface> scan() {
        List<Iface> out = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> e = NetworkInterface.getNetworkInterfaces();
            while (e != null && e.hasMoreElements()) {
                NetworkInterface ni = e.nextElement();
                if (!ni.isUp() || ni.isLoopback()) {
                    continue;
                }
                boolean zt = isZeroTier(ni);
                for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                    InetAddress addr = ia.getAddress();
                    if (addr instanceof Inet4Address) {
                        out.add(new Iface(cidr(addr.getHostAddress(), ia.getNetworkPrefixLength()), zt));
                    }
                }
            }
        } catch (Exception ignored) {
            // Thiếu quyền / không có giao diện: trả về những gì thu thập được.
        }
        return out;
    }

    /** Phân loại IP peer: {@code "zerotier"} | {@code "lan"} | {@code "public"}. */
    public static String classify(String ip, List<Iface> ifaces) {
        if (ip == null || ip.isBlank()) {
            return "lan";
        }
        if (ifaces != null) {
            for (Iface i : ifaces) {
                if (contains(i.cidr(), ip)) {
                    return i.zeroTier() ? "zerotier" : "lan";
                }
            }
        }
        return isPrivate(ip) ? "lan" : "public";
    }

    /** Giao diện này có phải của ZeroTier không (theo tên hiển thị hoặc tên thiết bị). */
    static boolean isZeroTier(NetworkInterface ni) {
        String name = ni.getName() == null ? "" : ni.getName().toLowerCase(Locale.ROOT);
        String disp = ni.getDisplayName() == null ? "" : ni.getDisplayName().toLowerCase(Locale.ROOT);
        return disp.contains("zerotier") || disp.contains("zero tier") || name.startsWith("zt");
    }

    /** IP thuộc dải riêng tư/loopback/link-local/CGNAT? (dùng khi không khớp giao diện nào). */
    public static boolean isPrivate(String ip) {
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
        return a == 100 && b >= 64 && b <= 127;
    }

    private static String cidr(String ip, short prefix) {
        int p = prefix < 0 ? 32 : Math.min(32, prefix);
        return ip + "/" + p;
    }

    /** IP có nằm trong CIDR {@code "a.b.c.d/prefix"} không. */
    static boolean contains(String cidr, String ip) {
        if (cidr == null || ip == null) {
            return false;
        }
        int slash = cidr.indexOf('/');
        if (slash <= 0) {
            return false;
        }
        long net = ipToLong(cidr.substring(0, slash));
        long host = ipToLong(ip);
        if (net < 0 || host < 0) {
            return false;
        }
        int prefix;
        try {
            prefix = Integer.parseInt(cidr.substring(slash + 1).trim());
        } catch (NumberFormatException e) {
            return false;
        }
        if (prefix <= 0) {
            return prefix == 0;
        }
        if (prefix > 32) {
            prefix = 32;
        }
        long mask = prefix == 32 ? 0xFFFFFFFFL : (0xFFFFFFFFL << (32 - prefix)) & 0xFFFFFFFFL;
        return (net & mask) == (host & mask);
    }

    private static long ipToLong(String ip) {
        String[] p = ip.trim().split("\\.");
        if (p.length != 4) {
            return -1;
        }
        long v = 0;
        for (String s : p) {
            int o;
            try {
                o = Integer.parseInt(s);
            } catch (NumberFormatException e) {
                return -1;
            }
            if (o < 0 || o > 255) {
                return -1;
            }
            v = (v << 8) | o;
        }
        return v;
    }
}
