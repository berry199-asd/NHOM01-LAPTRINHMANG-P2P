/**
 * Quy tắc "một cuộc gọi tại một thời điểm" (LỖI A) — hàm THUẦN, không phụ thuộc DOM/React.
 *
 * Trước đây chỉ chặn khi máy đang THỰC SỰ trong cuộc gọi (`state === "in-call"`), nên:
 *  - nhận lời mời MỚI trong lúc đang đổ chuông/kết nối thì lời mời mới ĐÈ trạng thái cũ;
 *  - hai bên cùng gọi nhau (glare) thì mỗi bên tự huỷ cuộc gọi đi của mình.
 *
 * Bộ quy tắc dùng ở đây:
 *  1. Bấm gọi: chỉ cho phép khi máy đang RẢNH (không chuông, không kết nối, không đang gọi).
 *  2. Nhận `invite` trùng `callId` đang xử lý → bỏ qua (idempotent).
 *  3. Nhận `invite` khác `callId` khi đang bận → `reject` và GIỮ NGUYÊN trạng thái hiện tại.
 *  4. Glare (ta đang gọi đúng người vừa gọi ta): bên có userId NHỎ HƠN thắng.
 *     Bên lớn huỷ cuộc gọi đi của mình rồi nhận cuộc gọi đến; bên nhỏ giữ cuộc gọi đi.
 *  5. Mọi nhánh kết thúc đều phải dọn sạch trạng thái (làm ở lớp gọi, không ở đây).
 */

/** Trạng thái cục bộ đã quy về 3 nhóm có nghĩa cho việc chặn. */
export type CallLocalPhase = "ringing" | "connecting" | "in-call"

export interface LocalCallView {
  callId: string
  /** Chiều của cuộc gọi đang giữ ở máy này. */
  dir: "in" | "out"
  phase: CallLocalPhase
  roomId?: number
  /** Cuộc gọi đi: userId của (những) người đang được gọi. */
  peerIds?: number[]
}

export interface CallGate {
  ok: boolean
  reason?: string
}

/** Quy tắc 1: rảnh mới được bắt đầu cuộc gọi mới. */
export function canStartCall(local: LocalCallView | null | undefined): CallGate {
  if (!local || !local.callId) return { ok: true }
  return { ok: false, reason: "Đang có cuộc gọi khác" }
}

/**
 * Lý do người dùng nhìn thấy khi Peer Core báo KHÔNG gửi được khung cuộc gọi
 * (lỗi phía Core bên gọi, không phải phía người nhận). Trả `null` nếu mã lỗi
 * không liên quan tới cuộc gọi (thì để nguyên như cũ).
 */
export function callErrorReason(
  code: string | undefined,
  detail?: string,
): { reason: string; endCall: boolean } | null {
  switch (code) {
    case "bad_call":
      return {
        reason: `Không gửi được lời mời: ${detail || "khung cuộc gọi không hợp lệ"}`,
        endCall: true,
      }
    case "not_bound":
      return {
        reason: "Peer Core chưa gắn tài khoản — không gửi được lời mời",
        endCall: true,
      }
    case "NO_PEERS_ONLINE":
      return {
        reason: "Không có ai trong phòng đang trực tuyến",
        endCall: true,
      }
    default:
      return null
  }
}

export type InviteDecision =
  /** Hiện chuông cuộc gọi đến (máy đang rảnh). */
  | "ring"
  /** Trùng cuộc gọi đang xử lý → bỏ qua. */
  | "dup"
  /** Đang bận → gửi `reject`, giữ nguyên trạng thái hiện tại. */
  | "busy"
  /** Glare và ta thắng → bỏ qua lời mời đến, giữ cuộc gọi đi của mình. */
  | "glare-keep"
  /** Glare và ta thua → huỷ cuộc gọi đi của mình rồi hiện chuông cuộc gọi đến. */
  | "glare-yield"

/**
 * Hành động thuần cho một khung `call_state` đến (BƯỚC 3/4) ở BÊN GỌI:
 *  - `"ack"`: lời mời đã thực sự tới UI người nhận → bật `acked` + bắt đầu đếm 45 giây.
 *  - `"unreachable"`: `no_route` (không có link) hoặc `ack_no_ui` (tới Core nhưng không có UI)
 *    → kết thúc NGAY với outcome `"unreachable"` (KHÔNG đổ chuông 45 giây).
 *  - `"ignore"`: khung không liên quan tới cuộc gọi ĐI đang chờ (`pending`/`sent`/lạ/khác callId/
 *    đã acked/không phải cuộc gọi đi) — giữ nguyên UI. Nhờ vậy frame lạ của bản Core/UI mới
 *    không phá bản cũ.
 */
export type CallStateAction = "ack" | "unreachable" | "ignore"

export interface CallStateInput {
  /** callId trên khung `call_state` của Core. */
  frameCallId?: string
  /** state trên khung (`pending|sent|acked|no_route|ack_no_ui|…`). */
  frameState?: string
  /** callId của cuộc gọi ĐI hiện tại ở máy ta (nếu có). */
  currentCallId?: string
  /** Chiều cuộc gọi hiện tại. */
  currentDir?: "in" | "out"
  /** Trạng thái hiện tại của cuộc gọi đi (thường `calling`/`connecting`). */
  currentState?: string
  /** Đã nhận ack trước đó chưa. */
  currentAcked?: boolean
}

export function callStateAction(input: CallStateInput): CallStateAction {
  const {
    frameCallId,
    frameState,
    currentCallId,
    currentDir,
    currentState,
    currentAcked,
  } = input
  // Chỉ áp dụng cho cuộc gọi ĐI của ta, đúng callId, và CHƯA kết nối.
  if (currentDir !== "out") return "ignore"
  if (!frameCallId || !currentCallId || currentCallId !== frameCallId) return "ignore"
  if (currentState !== "calling" && currentState !== "connecting") return "ignore"
  if (frameState === "acked") return currentAcked ? "ignore" : "ack"
  if (frameState === "no_route" || frameState === "ack_no_ui") {
    return currentAcked ? "ignore" : "unreachable"
  }
  return "ignore"
}

export interface InviteFrame {
  callId?: string
  signal?: string
  roomId?: number
  fromUserId?: number
}

/**
 * Quy tắc 2-4 cho một khung `invite` đến. `myId` dùng cho quy tắc glare
 * (phải KHỚP với {@link shouldInitiateOffer}: bên id nhỏ hơn chủ động offer).
 */
export function decideOnInvite(
  local: LocalCallView | null | undefined,
  frame: InviteFrame,
  myId: number,
): InviteDecision {
  if (!frame.callId) return "ring"
  if (!local || !local.callId) return "ring"
  if (local.callId === frame.callId) return "dup"
  if (local.phase === "in-call") return "busy"

  const parsedFrom = frame.callId?.startsWith("c")
    ? Number.parseInt(frame.callId.slice(1).split("-")[0], 10)
    : 0
  const from = (frame.fromUserId && frame.fromUserId > 0) ? frame.fromUserId : (parsedFrom > 0 ? parsedFrom : 0)
  const isSameRoom = local.roomId !== undefined && frame.roomId !== undefined && Number(local.roomId) === Number(frame.roomId)
  const callingThem =
    local.dir === "out" &&
    ((from > 0 && (local.peerIds ?? []).includes(from)) || isSameRoom)
  if (callingThem && myId > 0 && from > 0) {
    return myId < from ? "glare-keep" : "glare-yield"
  }
  // Đang chuông/đang kết nối với người khác: bận, không được thay thế trạng thái.
  return "busy"
}
