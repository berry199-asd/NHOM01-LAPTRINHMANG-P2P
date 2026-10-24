/**
 * Module thuần xử lý quyết định trạng thái cuộc gọi (không phụ thuộc React/DOM).
 * Dùng chung cho Home.tsx, CallOverlay và các bài test tự động (npm test).
 */

export interface LocalCallState {
  state: "idle" | "calling" | "connecting" | "in-call" | "ended"
  callId?: string
  roomId?: number
  callerId?: number
  targetUserId?: number
  dir?: "in" | "out"
}

export interface InviteFrame {
  signal: string
  callId: string
  roomId: number
  fromUserId?: number
  fromUsername?: string
  kind?: "voice" | "video"
  callerName?: string
}

export type InviteDecision =
  | { action: "ring"; callId: string; roomId: number }
  | { action: "ignore"; reason: string }
  | { action: "reject"; reason: "busy" | string; callId: string; roomId: number }
  | { action: "glare_keep"; reason: string }
  | { action: "glare_accept"; reason: string; callId: string; roomId: number }

/** So sánh hai userId theo chuỗi tất định. */
export function compareUserIds(a: string | number, b: string | number): number {
  const sa = String(a)
  const sb = String(b)
  if (sa < sb) return -1
  if (sa > sb) return 1
  return 0
}

/**
 * Kiểm tra xem người dùng có thể bắt đầu cuộc gọi mới không.
 * Nếu trạng thái cục bộ khác rảnh (đang gọi, đổ chuông, kết nối, đàm thoại) thì KHÔNG được gọi.
 */
export function canStartCall(local: LocalCallState | null | undefined): {
  allowed: boolean
  reason?: string
} {
  if (local && local.state !== "idle" && local.state !== "ended") {
    return { allowed: false, reason: "Đang có cuộc gọi" }
  }
  return { allowed: true }
}

/**
 * Ra quyết định xử lý khi nhận khung invite từ mạng.
 *
 * Quy tắc:
 * 1. Khung thiếu callId hoặc roomId -> bỏ qua (ignore).
 * 2. Đang có cuộc gọi cùng callId đang đổ chuông -> bỏ qua (idempotent duplicate).
 * 3. Rảnh (null, idle, ended) -> hiện chuông (ring).
 * 4. Glare: Đang gọi đi (calling, dir: out) cho cùng phòng hoặc cùng người:
 *    - Bên có userId nhỏ hơn (so sánh chuỗi) giữ cuộc gọi của mình (glare_keep).
 *    - Bên có userId lớn hơn hủy cuộc gọi đi và nhận chuông cuộc gọi đến (glare_accept).
 * 5. Đang bận (calling, connecting, in-call ở phòng khác hoặc không phải glare) -> từ chối (reject, reason: busy).
 */
export function decideOnInvite(
  local: LocalCallState | null | undefined,
  frame: InviteFrame,
  myUserId: number | string,
): InviteDecision {
  if (!frame || !frame.callId || frame.roomId === undefined) {
    return { action: "ignore", reason: "invalid_frame" }
  }

  // Idempotent: nhận lại đúng invite cho cuộc gọi hiện tại
  if (local && local.callId === frame.callId) {
    return { action: "ignore", reason: "duplicate_invite" }
  }

  // Rảnh: đón nhận cuộc gọi
  if (!local || local.state === "idle" || local.state === "ended") {
    return { action: "ring", callId: frame.callId, roomId: frame.roomId }
  }

  // Xử lý Glare: cả hai cùng gọi nhau gần như đồng thời
  const isOutgoingCalling = local.dir === "out" && local.state === "calling"
  const isSameRoom = Number(local.roomId) === Number(frame.roomId)
  const isSameTargetUser =
    Boolean(frame.fromUserId && local.targetUserId && Number(local.targetUserId) === Number(frame.fromUserId))

  if (isOutgoingCalling && (isSameRoom || isSameTargetUser)) {
    const fromId = frame.fromUserId !== undefined ? frame.fromUserId : 0
    const cmp = compareUserIds(myUserId, fromId)
    if (cmp < 0) {
      // Bên có ID nhỏ hơn: GIỮ cuộc gọi đi của mình
      return { action: "glare_keep", reason: "glare_smaller_user_id_keeps" }
    } else if (cmp > 0) {
      // Bên có ID lớn hơn: NHƯỜNG cuộc gọi, hủy gọi đi và nhận chuông đến
      return {
        action: "glare_accept",
        reason: "glare_larger_user_id_yields",
        callId: frame.callId,
        roomId: frame.roomId,
      }
    } else {
      // Trùng ID (hiếm gặp): so sánh theo callId
      if (String(local.callId) < String(frame.callId)) {
        return { action: "glare_keep", reason: "glare_smaller_call_id_keeps" }
      }
      return {
        action: "glare_accept",
        reason: "glare_larger_call_id_yields",
        callId: frame.callId,
        roomId: frame.roomId,
      }
    }
  }

  // Đang bận ở cuộc gọi khác (1-1 hoặc nhóm) -> báo bận
  return {
    action: "reject",
    reason: "busy",
    callId: frame.callId,
    roomId: frame.roomId,
  }
}
