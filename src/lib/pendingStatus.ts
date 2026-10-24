import type { MessageStatus } from "./messageStatus.ts"

/**
 * Trạng thái gửi do Peer Core báo về ({@code send_state}) chỉ áp được cho tin đã có
 * trong state. Vì frame có thể tới TRƯỚC lúc tin (optimistic) được chèn vào state,
 * trạng thái chưa khớp được giữ tạm ở đây rồi hợp nhất ngay khi tin xuất hiện —
 * nhờ vậy nhãn "Đang chờ"/"Đã gửi" cập nhật tức thì, không trễ một nhịp.
 */
export interface StatusPatch {
  status: MessageStatus
  retryable?: boolean
}

/** Tối thiểu những gì cần để lưu tạm/áp trạng thái (dùng được với Map thật). */
export interface StatusBuffer {
  get(key: string): StatusPatch | undefined
  set(key: string, value: StatusPatch): unknown
  delete(key: string): unknown
  has(key: string): boolean
  size: number
}

/** Khoá theo phòng + clientMsgId do trình duyệt sinh (không chứa nội dung tin). */
export function pendingKey(roomId: number, clientId: string): string {
  return `${roomId}:${clientId}`
}

/** Trạng thái thô từ frame {@code send_state} của Peer Core → nhãn UI. */
export function sendStateToStatus(state: unknown): MessageStatus {
  if (state === "sent") return "sent"
  if (state === "failed") return "failed"
  return "stored"
}

/** Lưu tạm trạng thái cho tin chưa có trong state. Bỏ qua nếu thiếu clientId. */
export function rememberPending(
  buf: StatusBuffer,
  roomId: number,
  clientId: string | undefined,
  patch: StatusPatch,
): void {
  if (!clientId) return
  buf.set(pendingKey(roomId, clientId), patch)
}

/** Lấy (và xoá) trạng thái đã lưu tạm cho một tin cụ thể. */
export function consumePending(
  buf: StatusBuffer,
  roomId: number | undefined,
  clientId: string | undefined,
): StatusPatch | undefined {
  if (roomId === undefined || !clientId) return undefined
  const key = pendingKey(roomId, clientId)
  const patch = buf.get(key)
  if (patch) buf.delete(key)
  return patch
}

/**
 * Hợp nhất trạng thái đã lưu tạm vào tin mới chèn (nếu có). Trả về chính object cũ
 * khi không có gì để đổi (giữ tham chiếu ổn định cho React).
 */
export function mergePendingStatus<T extends { status?: MessageStatus; retryable?: boolean }>(
  buf: StatusBuffer,
  roomId: number | undefined,
  msg: T & { clientId?: string },
): T {
  const patch = consumePending(buf, roomId, msg.clientId)
  if (!patch) return msg
  return applyStatusPatch(msg, patch)
}

/** Áp một trạng thái lên tin; không tạo object mới nếu không thay đổi. */
export function applyStatusPatch<T extends { status?: MessageStatus; retryable?: boolean }>(
  msg: T,
  patch: StatusPatch,
): T {
  if (msg.status === patch.status && !!msg.retryable === !!patch.retryable) return msg
  return { ...msg, status: patch.status, retryable: patch.retryable }
}
