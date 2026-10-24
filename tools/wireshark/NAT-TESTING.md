# Kiểm thử NAT / STUN / đục lỗ UDP (mục 6)

Tài liệu này mô tả cách chứng minh **STUN + UDP hole punching + failover Relay** hoạt động
qua NAT thật, thay vì chỉ loopback.

## 1. Kết quả đã kiểm chứng trên máy phát triển

Chạy `peer-stun-real.mjs` (peer `--udp 0 --stun stun.l.google.com:19302`), đọc `/state.udp`:

```
publicIp   = 171.243.48.150     <- địa chỉ công khai do Google STUN trả về
port       = 55404              <- cổng UDP nội bộ đã bind
publicPort = 13107              <- cổng mà STUN quan sát sau NAT
```

`port != publicPort` → chứng minh có **NAT đang dịch cổng**, và client STUN của peer
parse đúng `XOR-MAPPED-ADDRESS`.

> Lưu ý: có NAT nghĩa là hole punching *có thể* thành công nếu NAT không đối xứng
> (cone). Với **symmetric NAT** hai peer không thể đục lỗ trực tiếp → hệ thống tự
> chuyển sang **Relay** qua Tracker (payload vẫn mã hóa AES-GCM).

## 2. Bộ biến thể STUN

| Biến thể | Ý nghĩa |
|---|---|
| `--stun off` / `none` | tắt STUN (chỉ dùng địa chỉ local) |
| `--stun <host:port>` | dùng STUN tùy chọn (mặc định `stun.l.google.com:19302`) |
| `STUN_SERVER` (env của test) | đổi server cho `peer-stun-real.mjs` |

## 3. Quy trình test 2 máy thật (WAN khác mạng)

Chuẩn bị: một máy làm **Tracker + DB** có địa chỉ công khai/đã NAT port (HTTP 9090,
WS 9090, heartbeat UDP 9091). Hai máy client ở **hai mạng khác nhau**.

Trên mỗi máy client:

```powershell
# 1) Lấy token (đăng nhập)
$login = Invoke-RestMethod -Method Post -Uri "http://<tracker>:9090/api/login" `
  -ContentType application/json -Body (@{email="a@x.dev";password="secret123"} | ConvertTo-Json)

# 2) Chạy peer có UDP + STUN thật
.\backend\run-peer.ps1 -Token $login.token -Ip 0.0.0.0 -Port 48310 -Api 48410 `
  -Ui 48001 -Udp 0 -Stun "stun.l.google.com:19302" -Server "http://<tracker>:9090"
```

Kỳ vọng sau vài giây:

```powershell
Invoke-RestMethod http://127.0.0.1:48410/state | ConvertTo-Json -Depth 5
# udp.publicIp / udp.publicPort khác rỗng
# rooms[].peers[].udpReachable = true  (nếu đục lỗ thành công)
# rooms[].peers[].udpPublicPort = số cổng công khai của peer còn lại
```

- Nếu `udpReachable = true` → chat/file đi thẳng **UDP P2P**.
- Nếu sau cửa sổ ~5 giây vẫn `udpReachable = false` → tự chuyển **Relay** (badge UI hiện *Relay*).

Kiểm tra nhanh chế độ Relay (bỏ qua kênh trực tiếp):

```powershell
.\backend\run-peer.ps1 -Token $login.token -Udp off ... -RelayOnly 1
# hoặc
.\backend\run-peer-auto.ps1 -Email a@x.dev -Password secret123 -RelayOnly
```

## 4. Tường lửa (quan trọng khi test WAN)

- Cho phép UDP vào/ra trên máy client (Windows Defender Firewall → Inbound/Outbound).
- Tracker phải mở **TCP 9090** (HTTP+WS) và **UDP 9091** (heartbeat), và STUN cần UDP ra Internet.
- Nếu hai peer ở sau **symmetric NAT** hoặc firewall chặn UDP: đục lỗ sẽ thất bại
  → kiểm tra badge chuyển sang **Relay** (đúng thiết kế failover 3–5 giây).

## 5. Kiểm chứng bằng Wireshark

Dùng `capture-peer.ps1` / `analyze-peer.ps1` (xem `README.md`), hoặc lọc trong Wireshark:

- `stun` — quá trình dò địa chỉ công khai.
- `udp && !stun && udp.port!=9091` — gói đục lỗ + dữ liệu P2P (không phải plaintext).
- `tcp.port==9090 && websocket` — Relay (control-plane), payload là base64 ciphertext.

Khi `udpReachable = true` sẽ thấy gói `udp.length==17` (punch/keepalive) giữa **hai cổng
UDP công khai của hai peer** (bằng chứng đục lỗ xuyên NAT). Khi Relay, thấy frame WS chứa
`rbytes`/`relay` thay vì gói UDP giữa hai peer.
