# Kiểm chứng data-plane P2P bằng Wireshark

Bộ công cụ thu thập và phân tích gói tin cho các tính năng ở giai đoạn 5–6:
đục lỗ UDP + STUN + mã hóa đầu-cuối + failover Relay qua Tracker.

## 1. Bản đồ giao thức & cổng

| Thành phần | Giao thức | Cổng | Ghi chú |
|---|---|---|---|
| Tracker REST/WS | TCP | `9090` | control-plane: auth, `peer_address`, Relay `signal` |
| Heartbeat peer → Tracker | UDP | `9091` (`PEER_HEARTBEAT_PORT`) | payload `userId:secret` |
| STUN | UDP | `19302` (Google) hoặc STUN tự dựng | Binding Request/Response, XOR-MAPPED-ADDRESS |
| Đục lỗ UDP / keepalive / dữ liệu | UDP | do OS cấp (`--udp 0`) hoặc cố định (`--udp <port>`) | gói đầu 1 byte = loại |
| Mesh TCP peer↔peer | TCP | `--port` (mặc định 48310) | bắt tay RSA/AES rồi AES-GCM |

### Định dạng gói UDP (byte đầu là loại)

```
[type:1][senderUserId:8][payload...]
```

| type | nghĩa | payload |
|---|---|---|
| `0x01` | PUNCH | rỗng |
| `0x02` | PUNCH_ACK | rỗng |
| `0x03` | KEEPALIVE | rỗng |
| `0x10` | DATA | ciphertext AES-GCM (IV 12B + bản mã + tag 16B) |

⇒ Gói punch/keepalive có tổng độ dài UDP = 8 (header UDP) + 9 = **17 byte** → lọc `udp.length==17`.

### Định dạng frame TCP mesh

```
[length:4][AES-GCM( JSON frame )]     # plaintext chỉ có ở bắt tay (hello/hello_ack/session có chữ ký Ed25519)
```

## 2. Bật UDP khi chạy peer

```powershell
# từ thư mục backend
.\run-peer.ps1 -Token <JWT> -Port 48310 -Api 48410 -Ui 48001 -Udp 0 -Stun stun.l.google.com:19302
```

- `-Udp 0` : OS cấp cổng UDP ngẫu nhiên (bật data-plane UDP + đục lỗ).
- `--relay-only 1` (hoặc `PEER_RELAY_ONLY=1`): ép bỏ qua kênh trực tiếp, mọi frame đi qua Relay Tracker.

## 3. Kịch bản kiểm chứng

Chuẩn bị: MySQL + Tracker 9090 + 2 PeerCore (2 user đã kết bạn, cùng phòng).

1. **Thu gói**: `.\tools\wireshark\capture-peer.ps1 -Seconds 120`
   (chạy PowerShell **Run as administrator**; xem interface bằng `-ListOnly`).
2. Trong lúc thu, thực hiện lần lượt:
   - **a) Đục lỗ UDP:** hai peer khởi động với `--udp`. Chờ ~1–5s.
   - `A gửi tin`: POST `http://127.0.0.1:<apiA>/send` `{roomId, text, clientId}` → đi qua UDP.
   - **b.** Kiểm tra Relay: chạy lại 1 peer với `--udp off --relay-only 1`, gửi tin.
3. Dừng thu (Ctrl+C), rồi phân tích:

```powershell
.\analyze-peer.ps1 -Pcap ..\..\captures\peer.pcapng -Plaintext "<nội dung tin đã gửi>"
```

## 4. Filter Wireshark nhanh

```
stun
udp && !stun && udp.port!=9091
udp.length==17
udp.length>17
tcp.port==9090 && websocket
tcp.port==9090 && websocket && data
frame contains "noi dung tin nhan cua ban"
```

## 5. Kết quả kỳ vọng

- **STUN**: có Binding Request (client → server) và Binding Response chứa `XOR-MAPPED-ADDRESS` = địa chỉ công khai của peer.
- **Đục lỗ UDP**: các gói 17 byte đi hai chiều giữa hai peer (PUNCH/PUNCH_ACK/KEEPALIVE) ngay cả khi cả hai sau NAT.
- **Dữ liệu**: gói UDP `0x10` to hơn 17 byte; phần payload trông ngẫu nhiên (không đọc được).
- **Relay**: frame WebSocket `signal` trên `9090`; wrapper JSON có `data.relay` là **chuỗi base64** (ciphertext), Tracker chỉ chuyển tiếp mù.
- **Bảo mật**: `frame contains "<nội dung>"` = 0 → plaintext không lộ trên dây.

## 6. Bản đồ yêu cầu → bằng chứng

| Yêu cầu | Bằng chứng trên capture |
|---|---|
| Đục lỗ NAT + Relay | gói 17 byte hai chiều; frame WS `signal` khi bật relay-only |
| Chia khối + SHA-256 | (dùng test `peer-file-e2e.mjs`) |
| HashMap đồng thời + hàng đợi heartbeat | UDP `9091` đều đặn, TTL 10s |
| RSA + AES + chữ ký | bắt tay TCP có `hello`/`session`; sau đó toàn bộ là ciphertext |
| STUN | Binding Request/Response + XOR-MAPPED-ADDRESS |
| Wireshark | chính bộ script này |

## 7. Khi không cài được Wireshark

`tshark`/`dumpcap` nằm trong gói Wireshark. Nếu môi trường không cho cài:
- Dùng **fake STUN server** trong test (`peer-stun-e2e.mjs`) để xác nhận logic STUN offline.
- Relay/đục lỗ đã được chứng minh bằng test tự động: `peer-udp-punch-e2e.mjs`, `peer-udp-chat-e2e.mjs`, `peer-relay-e2e.mjs`.
