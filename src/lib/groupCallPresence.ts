/**
 * "Cuộc gọi nhóm đang diễn ra" nhìn từ BÊN NGOÀI — module THUẦN (không React/DOM).
 *
 * Vì sao cần: trước đây thẻ "Tham gia" chỉ hiện khi máy đã ở trong cuộc gọi, nên người
 * vừa rời (hoặc người chưa vào) không biết cuộc gọi nhóm vẫn đang tiếp diễn và không thể
 * vào lại. Người đang trong cuộc gọi nhóm phát tín hiệu `presence` định kỳ; mọi thành viên
 * còn lại trong phòng ghi nhận thành một bản ghi có HẠN DÙNG. Hết hạn (không còn ai phát
 * nhịp nữa) thì thẻ tự biến mất.
 *
 * Bản ghi chỉ chứa định danh (callId, roomId, userId…) — không có SDP/ICE/nội dung.
 */

import type { CallKind } from "./peer.ts"

/** Nhịp phát `presence` của người đang trong cuộc gọi nhóm (ms). */
export const GROUP_CALL_PRESENCE_INTERVAL_MS = 4000
/**
 * Hạn dùng của một bản ghi presence (ms). Lớn hơn nhịp phát ~3 lần để chịu được
 * mất gói/lag ngắn mà thẻ vẫn không nhấp nháy.
 */
export const GROUP_CALL_PRESENCE_TTL_MS = 15000

/** Một cuộc gọi nhóm đang diễn ra mà máy này KHÔNG ở trong. */
export interface OngoingGroupCall {
  callId: string
  /** id phòng thật (khớp `Conversation.realId`). */
  roomId: number
  /** id hội thoại phía UI (đã quy đổi nếu cần). */
  convId: number
  kind: CallKind
  /** epoch ms lúc cuộc gọi bắt đầu (do người gọi phát). */
  startedAt: number
  /** Người khởi tạo — có thể thiếu với bản ghi cũ. */
  callerId?: number
  callerName?: string
  name: string
  avatar?: string
  /** userId của những người đang thật sự trong cuộc gọi (gồm cả người phát). */
  participantIds: number[]
  /** epoch ms — sau mốc này bản ghi coi như hết hiệu lực. */
  expiresAt: number
}

/** Phần dữ liệu tối thiểu của frame `call`/`presence` dùng để cập nhật bản ghi. */
export interface GroupPresenceFrame {
  callId?: string
  roomId?: number
  kind?: CallKind
  startedAt?: number
  callerId?: number
  callerName?: string
  fromUserId?: number
  fromUsername?: string
  participants?: number[]
}

/** Hội thoại tối thiểu để lấy tên/ảnh hiển thị. */
export interface PresenceConversation {
  id: number
  name?: string
  avatar?: string
}

function validIds(raw: number[] | undefined): number[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<number>()
  for (const n of raw) {
    if (Number.isInteger(n) && n > 0) seen.add(n)
  }
  return [...seen]
}

/**
 * Áp một frame `presence` vào bản đồ cuộc gọi nhóm đang diễn ra (key = roomId).
 *
 * - Presence có < 2 người ⇒ cuộc gọi không thể duy trì (quy tắc gọi nhóm cần ≥ 2)
 *   nên xoá bản ghi của phòng đó ngay.
 * - Ngược lại: cập nhật/khởi tạo bản ghi và gia hạn `expiresAt = now + ttlMs`.
 *
 * Hàm thuần: trả về object MỚI khi có thay đổi, hoặc chính `prev` khi bỏ qua frame.
 */
export function applyGroupCallPresence(
  prev: Record<number, OngoingGroupCall>,
  frame: GroupPresenceFrame,
  conv: PresenceConversation | undefined,
  now: number,
  ttlMs: number = GROUP_CALL_PRESENCE_TTL_MS,
): Record<number, OngoingGroupCall> {
  const callId = frame.callId
  const roomId = frame.roomId
  if (!callId || !roomId || roomId <= 0) return prev

  const ids = validIds(frame.participants ?? frame.participantIds)
  if (ids.length < 2) {
    if (!(roomId in prev)) return prev
    const next = { ...prev }
    delete next[roomId]
    return next
  }

  const existing = prev[roomId]
  const sameCall = existing?.callId === callId ? existing : undefined
  const kind: CallKind = frame.kind === "video" ? "video" : sameCall?.kind ?? "voice"
  const startedAt =
    (typeof frame.startedAt === "number" && frame.startedAt > 0
      ? frame.startedAt
      : undefined) ??
    sameCall?.startedAt ??
    now
  const callerId =
    (typeof frame.callerId === "number" && frame.callerId > 0
      ? frame.callerId
      : undefined) ??
    sameCall?.callerId ??
    (typeof frame.fromUserId === "number" && frame.fromUserId > 0
      ? frame.fromUserId
      : undefined)

  const entry: OngoingGroupCall = {
    callId,
    roomId,
    convId: conv?.id ?? sameCall?.convId ?? roomId,
    kind,
    startedAt,
    callerId,
    callerName: frame.callerName ?? frame.fromUsername ?? sameCall?.callerName,
    name: conv?.name || sameCall?.name || "Cuộc gọi nhóm",
    avatar: conv?.avatar ?? sameCall?.avatar,
    participantIds: ids,
    expiresAt: now + ttlMs,
  }
  return { ...prev, [roomId]: entry }
}

/** Xoá các bản ghi đã hết hạn. Trả `prev` nếu không có gì thay đổi. */
export function pruneExpiredGroupCalls(
  prev: Record<number, OngoingGroupCall>,
  now: number,
): Record<number, OngoingGroupCall> {
  let changed = false
  const next: Record<number, OngoingGroupCall> = {}
  for (const [key, entry] of Object.entries(prev)) {
    if (entry.expiresAt > now) next[Number(key)] = entry
    else changed = true
  }
  return changed ? next : prev
}

/** Bản ghi còn hiệu lực của một phòng, hoặc `null`. */
export function ongoingCallForRoom(
  calls: Record<number, OngoingGroupCall>,
  roomId: number | undefined,
  now: number,
): OngoingGroupCall | null {
  if (!roomId) return null
  const entry = calls[roomId]
  if (!entry || entry.expiresAt <= now) return null
  return entry
}
