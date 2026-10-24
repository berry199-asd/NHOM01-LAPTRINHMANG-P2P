package com.workchat.peer.net;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.security.SecureRandom;

/**
 * STUN client tối giản (RFC 5389) dùng JDK thuần: gửi Binding Request qua một
 * DatagramSocket rồi đọc địa chỉ công khai (XOR-MAPPED-ADDRESS) do máy chủ STUN trả về.
 * Nhờ đó Peer biết được địa chỉ IP:port mà Internet nhìn thấy, phục vụ UDP hole punching.
 */
public final class StunClient {
    public record Mapped(String ip, int port) {
    }

    private static final int BINDING_REQUEST = 0x0001;
    private static final int BINDING_SUCCESS = 0x0101;
    private static final int MAGIC = 0x2112A442;
    private static final int ATTR_XOR_MAPPED = 0x0020;
    private static final int ATTR_MAPPED = 0x0001;
    private static final SecureRandom RNG = new SecureRandom();

    private StunClient() {
    }

    /** Tạo Binding Request mới với transaction id ngẫu nhiên; trả về {request, txn}. */
    public static byte[] bindingRequest(byte[] txn) {
        byte[] req = new byte[20];
        req[1] = (byte) BINDING_REQUEST;
        req[4] = 0x21;
        req[5] = 0x12;
        req[6] = (byte) 0xA4;
        req[7] = 0x42;
        System.arraycopy(txn, 0, req, 8, 12);
        return req;
    }

    /** Sinh transaction id ngẫu nhiên 12 byte. */
    public static byte[] newTxn() {
        byte[] txn = new byte[12];
        RNG.nextBytes(txn);
        return txn;
    }

    /**
     * Dò địa chỉ cực ngoài (reflexive) qua máy chủ STUN host:port.
     * Trả về null nếu không có phản hồi sau vài lần thử.
     * LƯU Ý: hàm này tự đọc socket, chỉ dùng khi KHÔNG có luồng khác cùng đọc.
     */
    public static Mapped discover(DatagramSocket socket, String host, int port, int timeoutMs) {
        for (int attempt = 0; attempt < 3; attempt++) {
            try {
                byte[] txn = newTxn();
                byte[] req = bindingRequest(txn);
                socket.send(new DatagramPacket(req, req.length, InetAddress.getByName(host), port));
                socket.setSoTimeout(timeoutMs);
                byte[] buf = new byte[512];
                DatagramPacket resp = new DatagramPacket(buf, buf.length);
                socket.receive(resp);
                Mapped m = parse(resp.getData(), resp.getLength(), txn);
                if (m != null) {
                    return m;
                }
            } catch (Exception e) {
                // thử lại
            }
        }
        return null;
    }

    public static Mapped parse(byte[] b, int len, byte[] txn) {
        if (len < 20) {
            return null;
        }
        int type = ((b[0] & 0xff) << 8) | (b[1] & 0xff);
        if (type != BINDING_SUCCESS) {
            return null;
        }
        if (!(b[4] == 0x21 && b[5] == 0x12 && b[6] == (byte) 0xA4 && b[7] == 0x42)) {
            return null;
        }
        for (int i = 0; i < 12; i++) {
            if (b[8 + i] != txn[i]) {
                return null;
            }
        }
        int msgLen = ((b[2] & 0xff) << 8) | (b[3] & 0xff);
        int end = Math.min(len, 20 + msgLen);
        int p = 20;
        while (p + 4 <= end) {
            int aType = ((b[p] & 0xff) << 8) | (b[p + 1] & 0xff);
            int aLen = ((b[p + 2] & 0xff) << 8) | (b[p + 3] & 0xff);
            int v = p + 4;
            if ((aType == ATTR_XOR_MAPPED || aType == ATTR_MAPPED) && v + 8 <= end) {
                int xPort = ((b[v + 2] & 0xff) << 8) | (b[v + 3] & 0xff);
                long addr = 0;
                for (int i = 0; i < 4; i++) {
                    addr = (addr << 8) | (b[v + 4 + i] & 0xff);
                }
                int mappedPort = xPort;
                if (aType == ATTR_XOR_MAPPED) {
                    mappedPort ^= (MAGIC >> 16);
                    addr ^= (MAGIC & 0xffffffffL);
                }
                String ip = ((addr >> 24) & 0xff) + "." + ((addr >> 16) & 0xff) + "."
                        + ((addr >> 8) & 0xff) + "." + (addr & 0xff);
                return new Mapped(ip, mappedPort);
            }
            p = v + aLen + ((4 - (aLen % 4)) % 4);
        }
        return null;
    }
}
