/**
 * View-model thuần (không phụ thuộc DOM/React) cho màn hình cuộc gọi.
 *
 * Tách riêng để kiểm thử và để giao diện (CallOverlay) chỉ việc vẽ. KHÔNG chứa
 * logic báo hiệu/WebRTC/E2E — chỉ nhãn trạng thái, bố cục lưới, nhãn nút và
 * quyết định hiển thị ảnh đại diện.
 */

import { resolveAvatarUrl } from "./avatarUrl.ts"

export type CallKindView = "voice" | "video"
export type CallDir = "out" | "in"
export type CallVisualState =
  | "calling"
  | "connecting"
  | "in-call"
  | "ended"
  | "failed"

/** Gợi ý chất lượng mạng để vẽ biểu tượng + dải "đang kết nối lại". */
export type CallNetHint = "good" | "weak" | "down"

/** Một người hiển thị trên màn hình gọi (bản thân hoặc người khác). */
export interface CallPerson {
  /** id người dùng (0 hoặc bất kỳ cho bản thân ở chế độ xem trước). */
  userId: number
  name: string
  initials: string
  /** URL ảnh (data-URI hoặc URL). Rỗng/không có = dùng chữ viết tắt. */
  avatar?: string
  /** Màu nền cho chữ viết tắt khi không có ảnh. */
  color: string
  isSelf?: boolean
  muted?: boolean
  speaking?: boolean
}

export const INCOMING_AUTO_CLOSE_MS = 30_000

/* -------------------------------------------------------------------------- */
/* Ảnh đại diện                                                                */
/* -------------------------------------------------------------------------- */

export interface AvatarInput {
  src?: string | null
  /** true khi ảnh đã lỗi tải (onError) → quay về chữ viết tắt. */
  errored?: boolean
}

export type AvatarView =
  | { kind: "image"; src: string }
  | { kind: "initials" }

/**
 * Alias API cũ của màn hình gọi: MỌI chuẩn hoá URL ảnh đều đi qua 1 hàm duy nhất
 * là `resolveAvatarUrl` (`src/lib/avatarUrl.ts`) — không còn ghép host/cổng ở đâu.
 */
export function sameOriginMediaSrc(src?: string | null): string {
  return resolveAvatarUrl(src)
}

/**
 * Quyết định hiển thị ảnh hay chữ viết tắt:
 *  - có `src` (khác rỗng) và chưa lỗi tải → ảnh (đã chuẩn hoá về cùng origin)
 *  - ngược lại (không ảnh / ảnh rỗng / ảnh lỗi) → chữ viết tắt + màu nền
 */
export function resolveAvatarView(input: AvatarInput): AvatarView {
  const src = sameOriginMediaSrc(input.src)
  if (src && !input.errored) return { kind: "image", src }
  return { kind: "initials" }
}

/** Bảng màu chữ viết tắt (khớp bảng màu đang dùng trong Home). */
const AVATAR_PALETTE = [
  "#0ea5e9",
  "#f59e0b",
  "#10b981",
  "#8b5cf6",
  "#ef4444",
  "#14b8a6",
  "#6366f1",
  "#ec4899",
]

/** Màu nền ổn định theo tên (dùng cho ảnh chữ viết tắt). */
export function colorForName(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i += 1)
    h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length]
}

/** Chữ viết tắt từ tên (tối đa 2 ký tự). */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .slice(0, 2)
    .join("")
}

/**
 * Tên hiển thị ưu tiên họ tên (display_name) → tên → username → dự phòng.
 * Dùng thống nhất cho mọi nhãn trên màn hình gọi để KHÔNG lộ username khi đã có họ tên.
 */
export function displayNameOf(
  parts: { displayName?: string; name?: string; username?: string },
  fallback = "Người dùng",
): string {
  for (const raw of [parts.displayName, parts.name, parts.username]) {
    const v = (raw ?? "").trim()
    if (v) return v
  }
  return fallback
}

/**
 * Dữ liệu một người lấy từ store (thành viên hội thoại / danh sách bạn / payload báo hiệu).
 * Các nguồn được hợp nhất theo `id` trước khi dựng danh sách hiển thị.
 */
export interface CallRosterEntry {
  id: number
  displayName?: string
  username?: string
  avatar?: string
}

export interface CallRosterInput {
  self: CallRosterEntry & { muted?: boolean }
  others: CallRosterEntry[]
}

/**
 * Dựng danh sách người hiển thị trên màn hình gọi từ dữ liệu store (bản thân đứng đầu).
 * Nhờ lấy ảnh + họ tên từ store theo userId, cả hai phía (gọi và nhận) đều hiển thị
 * đúng ảnh đại diện và họ tên, không phụ thuộc payload báo hiệu (vốn không mang ảnh).
 */
export function buildCallRoster(input: CallRosterInput): CallPerson[] {
  const toPerson = (
    e: CallRosterEntry,
    isSelf: boolean,
    muted?: boolean,
  ): CallPerson => {
    const name = displayNameOf(e, isSelf ? "Tôi" : "Người dùng")
    const person: CallPerson = {
      userId: e.id,
      name,
      initials: initialsOf(name),
      avatar: (e.avatar ?? "").trim() || undefined,
      color: colorForName(name),
    }
    if (isSelf) {
      person.isSelf = true
      person.muted = muted ?? false
    }
    return person
  }
  const self = toPerson(input.self, true, input.self.muted)
  const others = input.others
    .filter((o) => o.id !== input.self.id)
    .map((o) => toPerson(o, false))
  return [self, ...others]
}

/* -------------------------------------------------------------------------- */
/* Đồng hồ & trạng thái                                                        */
/* -------------------------------------------------------------------------- */

/** mm:ss, hoặc h:mm:ss khi từ 1 giờ trở lên. Luôn tabular-nums ở phía giao diện. */
export function formatCallDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const two = (n: number) => String(n).padStart(2, "0")
  return h > 0 ? `${h}:${two(m)}:${two(ss)}` : `${m}:${two(ss)}`
}

export interface CallStatusInput {
  state: CallVisualState
  dir: CallDir
  dur: number
  reason?: string
  finalDur?: number
  /** Mạng yếu trong lúc đang gọi → hiển thị "Đang kết nối lại…". */
  reconnecting?: boolean
  /**
   * Bên gọi đã nhận ack end-to-end chưa (Core bên nhận đã đẩy lời mời xuống UI):
   * `false` → "Đang kết nối…", `true`/bỏ trống → "Đang đổ chuông…".
   */
  acked?: boolean
}

/**
 * Nhãn trạng thái ngắn (một từ/cụm) hiển thị dưới tên:
 * Đang đổ chuông / Cuộc gọi đến / Đang kết nối… / Đã kết nối / Đang kết nối lại…
 */
export function callStatusWord(i: CallStatusInput): string {
  switch (i.state) {
    case "calling":
      if (i.dir === "out" && i.acked === false) return "Đang kết nối…"
      return i.dir === "out" ? "Đang đổ chuông…" : "Cuộc gọi đến…"
    case "connecting":
      return "Đang kết nối…"
    case "in-call":
      return i.reconnecting ? "Đang kết nối lại…" : "Đã kết nối"
    case "failed":
      return i.reason ?? "Mất kết nối"
    case "ended":
    default:
      return i.reason ?? "Cuộc gọi đã kết thúc"
  }
}

/** Đồng hồ hiển thị lớn: chỉ khi đang gọi (hoặc thời lượng cuối sau khi kết thúc). */
export function callClockText(i: CallStatusInput): string {
  if (i.state === "in-call") return formatCallDuration(i.dur)
  if (i.state === "ended" || i.state === "failed") {
    if (i.finalDur && i.finalDur > 0) return formatCallDuration(i.finalDur)
    if (i.state === "failed" && i.dur > 0) return formatCallDuration(i.dur)
  }
  return ""
}

/** Có phải đang đổ chuông (hiện vòng sóng lan tỏa quanh ảnh). */
export function isRinging(state: CallVisualState): boolean {
  return state === "calling" || state === "connecting"
}

/* -------------------------------------------------------------------------- */
/* Bố cục (lưới nhóm)                                                          */
/* -------------------------------------------------------------------------- */

/** Số cột lưới cho cuộc gọi nhóm theo số người (đã gồm bản thân). */
export function groupGridColumns(count: number): number {
  const n = Math.max(1, Math.floor(count || 1))
  if (n <= 1) return 1
  if (n === 2) return 2
  if (n <= 4) return 2
  if (n <= 9) return 3
  return 4
}

/** "single" = một ảnh lớn ở giữa; "grid" = lưới nhiều người. */
export function callLayout(input: {
  isGroup?: boolean
  count: number
}): "single" | "grid" {
  if (input.isGroup) return "grid"
  return input.count > 1 ? "grid" : "single"
}

/* -------------------------------------------------------------------------- */
/* Nhãn nút điều khiển                                                         */
/* -------------------------------------------------------------------------- */

export function micToggleLabel(muted: boolean): string {
  return muted ? "Bật micro" : "Tắt micro"
}

export function micAriaLabel(muted: boolean): string {
  return muted ? "Bật micro (M)" : "Tắt micro (M)"
}

export function cameraToggleLabel(off: boolean): string {
  return off ? "Bật camera" : "Tắt camera"
}

export function endButtonLabel(i: {
  state: CallVisualState
  dir: CallDir
}): string {
  if (i.state === "calling" && i.dir === "in") return "Từ chối"
  if (i.state === "calling" || i.state === "connecting") return "Huỷ cuộc gọi"
  return "Kết thúc cuộc gọi"
}

/** Chỉ hiện hộp thoại cuộc gọi đến khi đang đổ chuông chiều vào. */
export function isIncomingRing(i: {
  state: CallVisualState
  dir: CallDir
}): boolean {
  return i.state === "calling" && i.dir === "in"
}

/* -------------------------------------------------------------------------- */
/* Người đang nói & chất lượng mạng                                            */
/* -------------------------------------------------------------------------- */

/** id người có mức âm lượng cao nhất vượt ngưỡng, hoặc null. */
export function pickActiveSpeaker(
  levels: Record<number, number>,
  threshold = 0.08,
): number | null {
  let best: number | null = null
  let bestV = threshold
  for (const key of Object.keys(levels)) {
    const id = Number(key)
    const v = levels[id] ?? 0
    if (v > bestV) {
      bestV = v
      best = id
    }
  }
  return best
}

/** Tỉ lệ phát sáng 0..1 quanh ảnh theo mức âm lượng. */
export function glowScale(level: number, muted = false): number {
  if (muted) return 0
  const v = Math.max(0, Math.min(1, level || 0))
  return Math.round(v * 100) / 100
}

export function netHintLabel(hint: CallNetHint): string {
  switch (hint) {
    case "good":
      return "Kết nối tốt"
    case "weak":
      return "Mạng yếu"
    default:
      return "Mất kết nối"
  }
}

/** Hiện dải "Đang kết nối lại…" khi đang gọi mà mạng không tốt. */
export function isReconnecting(
  state: CallVisualState,
  hint: CallNetHint,
): boolean {
  return state === "in-call" && hint !== "good"
}

/** "N người trong cuộc gọi" (đã tính bản thân). */
export function participantCountLabel(total: number): string {
  const n = Math.max(1, Math.floor(total || 1))
  return `${n} người trong cuộc gọi`
}
