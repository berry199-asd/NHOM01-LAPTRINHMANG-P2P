/**
 * Log chẩn đoán luồng cuộc gọi (LỖI A/B) — MẶC ĐỊNH TẮT.
 *
 * Bật bằng cách mở console trên trình duyệt:
 *   localStorage.setItem("wc_call_debug", "1")   // rồi tải lại trang
 *   localStorage.removeItem("wc_call_debug")     // tắt
 *
 * Không bao giờ ghi SDP/ICE/nội dung/token: mọi hàm ở đây chỉ nhận các trường
 * định danh (signal, callId, roomId, userId, hướng, quyết định). Dùng
 * {@link summarizeCallPayload} để lọc payload trước khi ghi.
 */

const KEY = "wc_call_debug"

export function callDebugEnabled(): boolean {
  try {
    if (typeof localStorage === "undefined") return false
    const v = localStorage.getItem(KEY)
    return v === "1" || v === "true" || v === "on"
  } catch {
    return false
  }
}

/** Ghi một dòng log chẩn đoán (không làm gì khi cờ tắt). */
export function callDebug(stage: string, data?: Record<string, unknown>): void {
  if (!callDebugEnabled()) return
  try {
    console.log(`[call] ${stage}`, { ts: Date.now(), ...(data ?? {}) })
  } catch {
    /* log không được làm hỏng luồng gọi */
  }
}

/** Payload tín hiệu gửi lên Peer Core (đã lọc trường — xem {@link summarizeCallPayload}). */
export interface CallPayloadLike {
  signal?: string
  callId?: string
  roomId?: number
  kind?: string
  to?: number
  sdp?: string
  sdpType?: string
  candidate?: unknown
}

/** Rút gọn payload tín hiệu về các trường định danh; BỎ sdp/candidate (nhạy cảm). */
export function summarizeCallPayload(p: CallPayloadLike): {
  signal?: string
  callId?: string
  roomId?: number
  kind?: string
  to?: number
  hasSdp: boolean
  hasCandidate: boolean
} {
  return {
    signal: p.signal,
    callId: p.callId,
    roomId: p.roomId,
    kind: p.kind,
    to: p.to,
    hasSdp: typeof p.sdp === "string" && p.sdp.length > 0,
    hasCandidate: p.candidate !== undefined && p.candidate !== null,
  }
}
