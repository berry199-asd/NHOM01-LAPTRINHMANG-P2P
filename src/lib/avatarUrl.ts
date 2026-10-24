/**
 * HÀM DUY NHẤT chuẩn hoá URL ảnh đại diện cho TOÀN BỘ app.
 *
 * Mọi chỗ hiển thị ảnh người (danh sách hội thoại, danh sách bạn, tiêu đề phòng,
 * hồ sơ, màn hình gọi, thẻ gọi trong dòng tin nhắn) đều đi qua `resolveAvatarUrl`
 * — không chỗ nào tự ghép host/cổng riêng.
 *
 * Vì sao phải chuẩn hoá: người dùng mở app bằng chứng chỉ tự ký ở
 * `https://<IP>:8443`; mọi URL ảnh trỏ sang origin khác (ví dụ `http://<IP>:9090`
 * hoặc `http://localhost:9090`) sẽ bị chặn (mixed-content / cross-origin) nên màn
 * hình gọi rơi về chữ viết tắt. Cách an toàn: ảnh chỉ được đi theo **đường dẫn
 * tương đối cùng origin** để Vite proxy (`/api` → Tracker) xử lý.
 *
 * Quy tắc:
 *  - `data:` / `blob:`: nội dung nhúng, giữ nguyên (không phụ thuộc host).
 *  - URL tuyệt đối trỏ tới Tracker (`localhost:9090`/`127.0.0.1:9090`) hoặc có
 *    pathname bắt đầu bằng `/api/`: bỏ host+cổng, trả về `path + query + hash`.
 *  - URL tương đối (`/api/...`, `/uploads/...`): giữ nguyên.
 *  - Ảnh ngoài hợp lệ (CDN): giữ nguyên.
 */
const LOCAL_API_HOSTS = ["localhost:9090", "127.0.0.1:9090"]

export function resolveAvatarUrl(src?: string | null): string {
  const s = (src ?? "").trim()
  if (!s) return ""
  if (/^(data:|blob:)/i.test(s)) return s
  const absolute = /^https?:\/\//i.test(s)
  const protoRelative = s.startsWith("//")
  if (absolute || protoRelative) {
    try {
      const u = new URL(absolute ? s : `https:${s}`)
      const isLanHost =
        /^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(
          u.hostname,
        )
      if (
        LOCAL_API_HOSTS.includes(u.host) ||
        u.port === "9090" ||
        u.pathname.startsWith("/api/") ||
        u.pathname.startsWith("/uploads/") ||
        isLanHost
      ) {
        return `${u.pathname}${u.search}${u.hash}`
      }
    } catch {
      return s
    }
  }
  return s
}

/** Không chứa host/cổng cứng (localhost, 127.0.0.1, IP:...) — dùng cho test/giám sát. */
export function isRelativeAvatarUrl(src: string): boolean {
  return !/^https?:\/\//i.test(src) && !src.startsWith("//")
}
