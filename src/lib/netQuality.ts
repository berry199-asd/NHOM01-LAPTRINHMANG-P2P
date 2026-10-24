/**
 * Chất lượng mạng hiển thị cho người dùng, suy ra từ các nguồn độc lập:
 *  - trình duyệt còn mạng (`navigator.onLine`)
 *  - WebSocket tới Peer Core cục bộ còn mở (không có nó thì không thể gửi)
 *  - Tracker có dùng được (`serverConnected`, từ frame `server_state`) và riêng kênh WS
 *    thời gian thực tới Tracker còn mở (`realtime`)
 *  - kết quả `ping/pong` tới Peer Core
 *
 * "Mất kết nối" = không gửi/nhận được gì: đứt tới Peer Core (không có pong), HOẶC cả HTTP lẫn
 *                 WS tới Tracker đều thất bại liên tục (Peer Core chốt sau ngưỡng 10–15 s).
 * "Mạng yếu"    = vẫn gửi được (mesh/outbox chờ) nhưng Tracker chỉ còn HTTP (kênh WS đứt),
 *                 hoặc kênh cục bộ chậm, hoặc trình duyệt báo offline.
 * "Tốt"         = mọi thứ bình thường.
 *
 * Chất lượng đo theo từng lần "dò" (ping/pong) chứ không theo "thời điểm nhận pong gần
 * nhất": nhờ vậy kết quả không nhấp nháy giữa các nhịp, và chỉ cần vài lần ping tốt liên
 * tiếp là trở lại "Tốt" (banner tự tắt trong vài giây sau khi mạng ổn định).
 *
 * Lưu ý quan trọng: tin nhắn KHÔNG đi qua mạng của trình duyệt mà qua Peer Core (kết nối
 * cục bộ 127.0.0.1). Vì vậy `navigator.onLine === false` **một mình không đủ** để kết luận
 * "Mất kết nối": chỉ cần Peer Core còn sống và còn tới được Tracker thì tin vẫn gửi được
 * (ví dụ Tracker chạy cùng máy, hoặc máy còn đường mạng khác). "Mất kết nối" chỉ dành cho
 * khi KHÔNG liên lạc được Peer Core hoặc Peer Core không phản hồi (`pong`).
 */
export type NetQuality = "good" | "weak" | "down"

/** RTT của pong (ms) vượt ngưỡng → coi là mạng yếu. */
export const NET_WEAK_PING_MS = 1500
/** Không nhận được pong trong ngưỡng (ms) → coi như mất kết nối tới Peer Core. */
export const NET_DEAD_PING_MS = 8000
/** Nhịp gửi ping (ms). */
export const NET_PING_INTERVAL_MS = 3000
/** Số lần ping/pong tốt liên tiếp để trở lại "Tốt" (tránh nhấp nháy). */
export const NET_GOOD_STREAK = 2

/** Kết quả một lần dò: `ok=false` = hết hạn chờ pong; `slow` = RTT vượt ngưỡng. */
export interface NetProbe {
  ok: boolean
  slow: boolean
}

/** Mẫu trạng thái tại một thời điểm. */
export interface NetSample {
  browserOnline: boolean
  peerConnected: boolean
  /**
   * Tracker có dùng được (HTTP hoặc WS thành công gần đây) — từ frame `server_state`.
   * `false` chỉ sau khi CẢ HTTP lẫn WS đều thất bại liên tục quá ngưỡng (Peer Core chốt).
   */
  serverConnected: boolean
  /**
   * Riêng kênh WS thời gian thực tới Tracker còn mở. `false` khi WS đứt nhưng HTTP vẫn thông
   * → chỉ bị gián đoạn thời gian thực, không phải mất kết nối. `undefined` = coi như còn.
   */
  realtime?: boolean
  /** Kết quả lần dò gần nhất; `null` = chưa dò lần nào. */
  probe: NetProbe | null
}

export interface NetState {
  quality: NetQuality
  /** Số lần ping/pong tốt liên tiếp (đếm để áp dụng trễ khi nâng lên "Tốt"). */
  goodStreak: number
}

export const INITIAL_NET_STATE: NetState = { quality: "weak", goodStreak: 0 }

/** Chất lượng tức thời chỉ từ một mẫu (không áp dụng trễ). */
export function netQuality(input: NetSample): NetQuality {
  // "Mất kết nối" = KHÔNG gửi/ nhận được gì: đứt tới Peer Core (hoặc Peer Core không phản hồi
  // `pong`), HOẶC cả HTTP lẫn WS tới Tracker đều thất bại liên tục (Peer Core đã chốt sau ngưỡng).
  // Chỉ WS đứt mà HTTP vẫn thông → "Mạng yếu" (gián đoạn thời gian thực, tin vẫn vào hộp thư).
  if (!input.peerConnected) return "down"
  if (input.probe != null && !input.probe.ok) return "down"
  if (!input.serverConnected) return "down"
  if (input.realtime === false) return "weak"
  if (!input.browserOnline) return "weak"
  if (input.probe == null) return "weak"
  return input.probe.slow ? "weak" : "good"
}

/**
 * Máy trạng thái có trễ: "Mất kết nối"/"Mạng yếu" áp dụng ngay, nhưng nâng lên "Tốt" chỉ
 * khi có {@link NET_GOOD_STREAK} lần ping/pong tốt liên tiếp. Nhờ đó banner "Mạng yếu"
 * không kẹt lại sau khi mạng ổn định mà tự tắt sau vài giây, đồng thời không nhấp nháy.
 */
export function netReduce(prev: NetState, sample: NetSample): NetState {
  const inst = netQuality(sample)
  if (inst === "good") {
    const goodStreak = prev.goodStreak + 1
    if (goodStreak >= NET_GOOD_STREAK) {
      return { quality: "good", goodStreak }
    }
    // Chưa đủ chuỗi tốt: nâng dần lên "Mạng yếu" nhưng không tụt xuống "Mất kết nối".
    return { quality: prev.quality === "good" ? "good" : "weak", goodStreak }
  }
  return { quality: inst, goodStreak: 0 }
}

export function netQualityLabel(q: NetQuality): string {
  switch (q) {
    case "good":
      return "Tốt"
    case "weak":
      return "Mạng yếu"
    default:
      return "Mất kết nối"
  }
}

/** Màu chấm trạng thái (khớp bảng màu đang dùng trong Home). */
export function netQualityColor(q: NetQuality): string {
  switch (q) {
    case "good":
      return "#22c55e"
    case "weak":
      return "#f59e0b"
    default:
      return "#ef4444"
  }
}
