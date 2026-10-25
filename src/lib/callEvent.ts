/**
 * View-model THUẦN (không phụ thuộc DOM/React) cho THẺ CUỘC GỌI trong dòng tin nhắn.
 *
 * Tách riêng để kiểm thử và để component `CallEventCard` chỉ việc vẽ. KHÔNG chứa
 * logic báo hiệu/WebRTC/E2E — chỉ trạng thái hiển thị, câu chữ theo phía người xem,
 * định dạng thời lượng/giờ và các phép hợp nhất/chống trùng sự kiện.
 *
 * Nguồn dữ liệu DUY NHẤT cho một cuộc gọi là một `CallEvent`: thời lượng, giờ bắt
 * đầu, giờ kết thúc được đo/chốt MỘT LẦN và các phía chỉ ĐỌC LẠI (xem docs/QUYET_DINH.md).
 */

import { formatCallDuration } from "./callView.ts"

export type CallMedia = "voice" | "video"

/** Trạng thái cuộc gọi (khách quan, không phụ thuộc phía người xem). */
export type CallOutcome =
  | "completed" // đã kết nối rồi kết thúc
  | "missed" // đổ chuông nhưng bên nhận không nghe máy
  | "rejected" // bên nhận chủ động từ chối
  | "cancelled" // bên gọi hủy trước khi bên kia nghe
  | "no-answer" // hết thời gian đổ chuông (tương đương "nhỡ")
  | "ongoing" // đang diễn ra
  | "unreachable" // không thiết lập được đường tới bên nhận (chưa đổ chuông)
  | "busy" // đối phương đang bận

export type CallSide = "caller" | "callee"

/** Tông màu thẻ (component ánh xạ sang màu thực tế theo theme sáng/tối). */
export type CallTone = "green" | "teal" | "red" | "neutral" | "ongoing"

export type CallIcon = "phone" | "video" | "phone-missed"

/** Kiểu màu của thẻ — component dùng để chọn class/inline style theo theme. */
export interface CallToneStyle {
  /** Nền thẻ. */
  bg: string
  /** Viền mảnh. */
  border: string
  /** Nền vòng tròn biểu tượng. */
  iconBg: string
  /** Màu biểu tượng bên trong vòng. */
  iconFg: string
  /** Màu chữ tiêu đề. */
  titleColor: string
  /** Chấm nhấp nháy (đang diễn ra). */
  dot: string
}

/**
 * Bảng màu theo tông: dùng màu nền bán trong suốt (hue) + biến theme của dự án
 * (`var(--surface)`, `var(--text)`, `var(--muted)`, `var(--error)`) nên TỰ CHUYỂN
 * SANG giữa theme sáng/tối mà không cần lớp CSS riêng.
 */
export const CALL_TONES: Record<CallTone, CallToneStyle> = {
  green: {
    bg: "rgba(34,197,94,0.14)",
    border: "rgba(34,197,94,0.38)",
    iconBg: "#22c55e",
    iconFg: "#ffffff",
    titleColor: "var(--text)",
    dot: "#22c55e",
  },
  teal: {
    bg: "rgba(20,184,166,0.14)",
    border: "rgba(20,184,166,0.4)",
    iconBg: "#14b8a6",
    iconFg: "#ffffff",
    titleColor: "var(--text)",
    dot: "#14b8a6",
  },
  red: {
    bg: "rgba(239,68,68,0.14)",
    border: "rgba(239,68,68,0.4)",
    iconBg: "#ef4444",
    iconFg: "#ffffff",
    titleColor: "var(--error)",
    dot: "#ef4444",
  },
  neutral: {
    bg: "var(--surface)",
    border: "var(--border)",
    iconBg: "#64748b",
    iconFg: "#ffffff",
    titleColor: "var(--text)",
    dot: "#64748b",
  },
  ongoing: {
    bg: "var(--surface)",
    border: "#22c55e",
    iconBg: "#22c55e",
    iconFg: "#ffffff",
    titleColor: "var(--text)",
    dot: "#22c55e",
  },
}

export interface CallEvent {
  media: CallMedia
  outcome: CallOutcome
  /** Thời lượng đàm thoại (giây) = từ lúc bên kia chấp nhận đến lúc kết thúc. */
  durationSec: number
  /** epoch ms — lúc bấm gọi (nguồn duy nhất). Thiếu = sự kiện cũ. */
  startedAt?: number
  /** epoch ms — lúc kết thúc. */
  endedAt?: number
  /** id người bắt đầu cuộc gọi. Thiếu (sự kiện cũ) thì dựa vào `mine`. */
  starterId?: number
  /** Dự phòng khi thiếu `starterId`: có phải do CHÍNH người xem bắt đầu không. */
  mine?: boolean
  /** Số người tham gia (đã gồm bản thân). > 2 = gọi nhóm. */
  participants?: number
  /** id cuộc gọi để chống trùng. */
  callId?: string
  /** id các thành viên (cho thẻ nhóm) — CHỈ ID, ảnh tra theo id lúc hiển thị. */
  groupIds?: number[]
}

/* -------------------------------------------------------------------------- */
/* Định dạng thời lượng & thời gian                                            */
/* -------------------------------------------------------------------------- */

/** Số giây hợp lệ và > 0 (dùng để quyết định có hiện thời lượng hay không). */
export function hasDuration(sec: number | undefined | null): boolean {
  return typeof sec === "number" && Number.isFinite(sec) && sec > 0
}

/** Thời lượng dạng chữ: "12 giây", "45 phút 12 giây", "1 giờ 5 phút 12 giây". */
export function formatDurationWords(sec: number | undefined | null): string {
  const total = Math.max(0, Math.floor(Number(sec) || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const parts: string[] = []
  if (h > 0) parts.push(`${h} giờ`)
  if (m > 0) parts.push(`${m} phút`)
  if (s > 0 || parts.length === 0) parts.push(`${s} giây`)
  return parts.join(" ")
}

const two = (n: number) => String(n).padStart(2, "0")

/** "HH:MM" theo giờ địa phương (khớp now()/formatClock của khung chat). */
export function formatCallClock(ts?: number): string {
  if (!ts || !Number.isFinite(ts)) return ""
  const d = new Date(ts)
  return `${two(d.getHours())}:${two(d.getMinutes())}`
}

/** "HH:MM DD/MM/YYYY" theo giờ địa phương (cho tooltip). */
export function formatDateTimeVN(ts?: number): string {
  if (!ts || !Number.isFinite(ts)) return ""
  const d = new Date(ts)
  return `${two(d.getHours())}:${two(d.getMinutes())} ${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()}`
}

/* -------------------------------------------------------------------------- */
/* Phía & loại cuộc gọi                                                        */
/* -------------------------------------------------------------------------- */

export function isGroupCall(event: CallEvent): boolean {
  return (event.participants ?? 0) > 2
}

/** Phía người xem so với người bắt đầu (dự phòng theo `mine` cho sự kiện cũ). */
export function sideForViewer(event: CallEvent, viewerId: number): CallSide {
  if (typeof event.starterId === "number" && event.starterId > 0)
    return event.starterId === viewerId ? "caller" : "callee"
  return event.mine ? "caller" : "callee"
}

function kindName(media: CallMedia): string {
  return media === "video" ? "video" : "thoại"
}

/** Tiêu đề ngắn cho dải viên thuốc / xem trước danh sách. */
export function callEventShortTitle(event: CallEvent): string {
  if (isGroupCall(event)) return `Cuộc gọi nhóm · ${event.participants} người`
  return `Cuộc gọi ${kindName(event.media)}`
}

/* -------------------------------------------------------------------------- */
/* View-model của thẻ                                                          */
/* -------------------------------------------------------------------------- */

export interface CallEventView {
  side: CallSide
  isGroup: boolean
  tone: CallTone
  icon: CallIcon
  title: string
  /** Dòng phụ: "Thời lượng 0:37" | "Nhấn để gọi lại" | "" */
  subtitle: string
  /** Hiện thời lượng dưới dạng "Thời lượng …". */
  showDuration: boolean
  /** Hiện gợi ý "Nhấn để gọi lại". */
  showHint: boolean
  /** Thời lượng đã định dạng ("0:37") hoặc "" khi thiếu/không tính. */
  durationText: string
  /** Bấm thẻ để gọi lại được. */
  canCallBack: boolean
  /** Đang diễn ra (thời lượng chạy theo thời gian thực). */
  isOngoing: boolean
  /** Hiện nút "Tham gia". */
  showJoin: boolean
  ariaLabel: string
  tooltip: string
}

/** Giá trị dùng chung cho cả hai phía (đảm bảo nhất quán). */
export interface CallEventConsistency {
  durationSec: number
  durationText: string
  startedAt?: number
  endedAt?: number
}

export function callEventConsistency(event: CallEvent): CallEventConsistency {
  const durationSec = hasDuration(event.durationSec)
    ? Math.floor(event.durationSec)
    : 0
  return {
    durationSec,
    durationText: formatCallDuration(durationSec),
    startedAt: event.startedAt,
    endedAt: event.endedAt,
  }
}

/** Có phải cuộc gọi nhỡ ở phía người xem (để tô đỏ + đánh dấu chưa đọc). */
export function isMissedForViewer(event: CallEvent, side: CallSide): boolean {
  return (
    side === "callee" &&
    (event.outcome === "missed" ||
      event.outcome === "no-answer" ||
      event.outcome === "unreachable")
  )
}

export interface CallEventViewOpts {
  /** thời lượng đang chạy (giây) khi outcome = ongoing. */
  liveSec?: number
  /** có ảnh đại diện nhóm để vẽ chồng ảnh. */
  hasGroupAvatars?: boolean
  /** cho phép "Tham gia" (nhóm hoặc tham gia lại). */
  canJoin?: boolean
}

export function callEventView(
  event: CallEvent,
  side: CallSide,
  opts: CallEventViewOpts = {},
): CallEventView {
  const group = isGroupCall(event)
  const cons = callEventConsistency(event)
  const dur = hasDuration(event.durationSec)
  const kind = kindName(event.media)

  let tone: CallTone = "neutral"
  let icon: CallIcon = event.media === "video" ? "video" : "phone"
  let title = callEventShortTitle(event)
  let subtitle = ""
  let showDuration = false
  let showHint = false
  let canCallBack = true
  let isOngoing = false
  let showJoin = false

  switch (event.outcome) {
    case "completed":
      tone = event.media === "video" ? "teal" : "green"
      icon = event.media === "video" ? "video" : "phone"
      title = callEventShortTitle(event)
      showDuration = dur
      subtitle = dur ? `Thời lượng ${cons.durationText}` : ""
      break

    case "missed":
    case "no-answer":
      icon = "phone-missed"
      if (side === "callee") {
        tone = "red"
        title = "Cuộc gọi nhỡ"
        subtitle = "Nhấn để gọi lại"
        showHint = true
      } else {
        tone = "neutral"
        title = "Không có người trả lời"
        subtitle = "Nhấn để gọi lại"
        showHint = true
      }
      break

    case "unreachable":
      icon = "phone-missed"
      if (side === "callee") {
        tone = "red"
        title = "Cuộc gọi nhỡ"
      } else {
        tone = "neutral"
        title = "Không kết nối được"
        subtitle = "Nhấn để gọi lại"
        showHint = true
      }
      break

    case "rejected":
      if (side === "callee") {
        tone = "neutral"
        icon = "phone"
        title = "Bạn đã từ chối"
      } else {
        tone = "red"
        icon = "phone-missed"
        title = "Cuộc gọi bị từ chối"
      }
      break

    case "busy":
      if (side === "callee") {
        tone = "neutral"
        icon = "phone"
        title = "Bạn đang bận"
      } else {
        tone = "red"
        icon = "phone-missed"
        title = "Đối phương đang bận"
        subtitle = "Nhấn để gọi lại"
        showHint = true
      }
      break

    case "cancelled":
      tone = "neutral"
      icon = event.media === "video" ? "video" : "phone"
      title = "Đã huỷ cuộc gọi"
      subtitle = "Nhấn để gọi lại"
      showHint = true
      break

    case "ongoing": {
      isOngoing = true
      tone = "ongoing"
      icon = event.media === "video" ? "video" : "phone"
      title = "Cuộc gọi đang diễn ra"
      showDuration = true
      const live = Math.max(0, Math.floor(opts.liveSec ?? event.durationSec ?? 0))
      subtitle = formatCallDuration(live)
      showJoin = opts.canJoin === true
      canCallBack = false
      break
    }
  }

  const ariaLabel = `${title}. ${subtitle}`.trim()
  const tooltip = callEventTooltip(event, { group, durationSec: cons.durationSec })

  return {
    side,
    isGroup: group,
    tone,
    icon,
    title,
    subtitle,
    showDuration,
    showHint,
    durationText: dur ? cons.durationText : "",
    canCallBack,
    isOngoing,
    showJoin,
    ariaLabel,
    tooltip,
  }
}

/** Tooltip: ngày giờ đầy đủ + giờ kết thúc + thời lượng dạng chữ. */
export function callEventTooltip(
  event: CallEvent,
  opts: { group?: boolean; durationSec?: number } = {},
): string {
  const parts: string[] = []
  const group = opts.group ?? isGroupCall(event)
  parts.push(group ? "Cuộc gọi nhóm" : `Cuộc gọi ${kindName(event.media)}`)
  if (event.startedAt) parts.push(`Bắt đầu ${formatDateTimeVN(event.startedAt)}`)
  if (event.endedAt) parts.push(`Kết thúc ${formatCallClock(event.endedAt)}`)
  const sec = opts.durationSec ?? (hasDuration(event.durationSec) ? event.durationSec : 0)
  if (sec > 0) parts.push(`Thời lượng ${formatDurationWords(sec)}`)
  return parts.join(" · ")
}

/* -------------------------------------------------------------------------- */
/* Dải viên thuốc & xem trước danh sách                                        */
/* -------------------------------------------------------------------------- */

/** Dải viên thuốc một dòng: "Cuộc gọi video · 12:05 · 14:20" (ẩn phần thiếu). */
export function callEventPillText(event: CallEvent): string {
  const bits = [callEventShortTitle(event)]
  if (hasDuration(event.durationSec))
    bits.push(formatCallDuration(Math.floor(event.durationSec)))
  const clock = formatCallClock(event.startedAt)
  if (clock) bits.push(clock)
  return bits.join(" · ")
}

/** Dòng xem trước ở danh sách hội thoại (theo phía người xem). */
export function callEventPreviewText(event: CallEvent, side: CallSide): string {
  switch (event.outcome) {
    case "completed":
      return callEventShortTitle(event) +
        (hasDuration(event.durationSec)
          ? ` · ${formatCallDuration(Math.floor(event.durationSec))}`
          : "")
    case "ongoing":
      return "Cuộc gọi đang diễn ra"
    case "missed":
    case "no-answer":
      return side === "callee" ? "Cuộc gọi nhỡ" : "Không có người trả lời"
    case "unreachable":
      return side === "callee" ? "Cuộc gọi nhỡ" : "Không kết nối được"
    case "rejected":
      return side === "callee" ? "Bạn đã từ chối" : "Cuộc gọi bị từ chối"
    case "busy":
      return side === "callee" ? "Bạn đang bận" : "Đối phương đang bận"
    case "cancelled":
    default:
      return "Đã huỷ cuộc gọi"
  }
}

/* -------------------------------------------------------------------------- */
/* Chống trùng sự kiện                                                         */
/* -------------------------------------------------------------------------- */

/** Khoá duy nhất của sự kiện: ưu tiên callId, dự phòng tổ hợp trường ổn định. */
export function callEventKey(event: CallEvent): string {
  if (event.callId) return `id:${event.callId}`
  return `k:${event.starterId ?? 0}:${event.startedAt ?? 0}:${event.media}:${event.outcome}`
}

/**
 * Thêm sự kiện vào map khoá→sự kiện nếu chưa tồn tại. Trả về true nếu THỰC SỰ thêm
 * (không trùng) — dùng để chống tạo trùng giữa hai phía hoặc khi gửi lại.
 */
export function upsertCallEvent(
  store: Map<string, CallEvent>,
  event: CallEvent,
): boolean {
  const key = callEventKey(event)
  if (store.has(key)) return false
  store.set(key, event)
  return true
}

/** Loại bỏ sự kiện trùng khoá (giữ sự kiện xuất hiện đầu). */
export function dedupeCallEvents(events: CallEvent[]): CallEvent[] {
  const store = new Map<string, CallEvent>()
  for (const e of events) upsertCallEvent(store, e)
  return [...store.values()]
}

/* -------------------------------------------------------------------------- */
/* Cầu nối với dữ liệu tin nhắn hiện có                                        */
/* -------------------------------------------------------------------------- */

/** Trường `call` trên Message (gồm cả giá trị mới thêm, đều tuỳ chọn). */
export interface MessageCallData {
  type?: "voice" | "video"
  dir?: "out" | "in"
  duration?: number
  outcome?: string
  startedAt?: number
  endedAt?: number
  starterId?: number
  participants?: number
  callId?: string
  /** Chỉ id các thành viên; KHÔNG chép ảnh vào payload (ảnh tra theo id lúc vẽ). */
  groupIds?: number[]
}

const OUTCOMES: CallOutcome[] = [
  "completed",
  "missed",
  "rejected",
  "cancelled",
  "no-answer",
  "ongoing",
  "unreachable",
  "busy",
]

function normalizeOutcome(raw?: string): CallOutcome {
  return (OUTCOMES as string[]).includes(raw ?? "")
    ? (raw as CallOutcome)
    : "completed"
}

/** Chuyển `Message.call` (kể cả bản cũ thiếu trường) sang `CallEvent` an toàn. */
export function callEventFromMessage(
  call: MessageCallData | undefined,
  currentUserId?: number,
): CallEvent {
  const isMine =
    typeof currentUserId === "number" &&
    currentUserId > 0 &&
    Number.isFinite(call?.starterId)
      ? call!.starterId === currentUserId
      : call?.dir === "out"
  return {
    media: call?.type === "video" ? "video" : "voice",
    outcome: normalizeOutcome(call?.outcome),
    durationSec: hasDuration(call?.duration) ? Math.floor(call!.duration!) : 0,
    startedAt: Number.isFinite(call?.startedAt) ? call!.startedAt : undefined,
    endedAt: Number.isFinite(call?.endedAt) ? call!.endedAt : undefined,
    starterId: Number.isFinite(call?.starterId) ? call!.starterId : undefined,
    mine: isMine,
    participants: Number.isFinite(call?.participants) ? call!.participants : undefined,
    callId: call?.callId,
    groupIds: Array.isArray(call?.groupIds)
      ? call!.groupIds!.filter((v) => Number.isFinite(v) && v > 0)
      : undefined,
  }
}

/** Sự kiện cũ thiếu giờ bắt đầu/thời lượng → hiển thị dạng gọn (viên thuốc). */
export function isLegacyCallEvent(event: CallEvent): boolean {
  return !event.startedAt && !hasDuration(event.durationSec)
}
