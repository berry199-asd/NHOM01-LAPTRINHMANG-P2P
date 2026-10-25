/**
 * Tạo chuỗi xem trước (dòng nhỏ dưới tên hội thoại) từ TIN CUỐI đã được giải mã
 * ở phía client (qua Peer Core). KHÔNG dùng trường content của server vì server
 * chỉ lưu metadata (content NULL) cho phòng thật.
 *
 * Tin metadata chưa giải mã → trả chuỗi rỗng (không vẽ). ENCRYPTED_PREVIEW chỉ
 * dùng khi giải mã thất bại thật sự (undecryptable).
 */

export interface PreviewFile {
  name?: string
  isImage?: boolean
  isVideo?: boolean
  mime?: string
}

export interface PreviewCall {
  type: "voice" | "video"
  dir: "out" | "in"
  duration: number
  outcome:
    | "completed"
    | "missed"
    | "rejected"
    | "cancelled"
    | "no-answer"
    | "ongoing"
    | "unreachable"
    | "busy"
}

export interface PreviewMessage {
  text?: string | null
  fromMe?: boolean
  senderId?: number
  senderName?: string
  status?: "sent" | "delivered" | "seen" | "sending" | "stored" | "failed"
  /** Tin chỉ có metadata server, chưa giải mã được → KHÔNG hiển thị nội dung. */
  undecryptable?: boolean
  recalled?: boolean
  file?: PreviewFile
  voice?: unknown
  like?: boolean
  kind?: string
  call?: PreviewCall
}

export const DECRYPTING_HINT = "Đang giải mã…"
export const UNDECRYPTABLE_HINT = "Tin cũ — không giải mã được bằng khóa hiện tại"
export const ENCRYPTED_PREVIEW = "🔒 Tin nhắn mã hóa"

export function messageContentDisplay(
  msg: { text?: string | null; decrypted?: boolean; undecryptable?: boolean },
  e2eUnlocked = true,
): string {
  if (msg.text && !msg.undecryptable) return msg.text
  if (!e2eUnlocked) return ENCRYPTED_PREVIEW
  if (msg.undecryptable) return UNDECRYPTABLE_HINT
  return DECRYPTING_HINT
}
export const SENDING_HINT = "Đang gửi…"
export const FAILED_PREVIEW = "Gửi lỗi"

function oneLine(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim()
}

/** Rút gọn tên người gửi: lấy từ cuối nếu tên quá dài. */
export function shortSenderName(name: string | undefined | null): string {
  const trimmed = oneLine(name)
  if (!trimmed) return "Thành viên"
  if (trimmed.length <= 18) return trimmed
  const parts = trimmed.split(" ")
  const last = parts[parts.length - 1]
  if (last && last.length < trimmed.length) return last
  return trimmed.slice(0, 18)
}

export function callPreviewText(call: PreviewCall | undefined): string {
  if (!call) return ""
  const kindName = call.type === "video" ? "video" : "thoại"
  switch (call.outcome) {
    case "completed": {
      const s = Math.max(0, Math.round(call.duration || 0))
      const label = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
      return `Cuộc gọi ${kindName} · ${label}`
    }
    case "ongoing":
      return "Cuộc gọi đang diễn ra"
    case "missed":
    case "no-answer":
      return call.dir === "in" ? "Cuộc gọi nhỡ" : "Không có người trả lời"
    case "unreachable":
      return call.dir === "in" ? "Cuộc gọi nhỡ" : "Không kết nối được"
    case "rejected":
      return call.dir === "in" ? "Bạn đã từ chối" : "Cuộc gọi bị từ chối"
    case "busy":
      return call.dir === "in" ? "Bạn đang bận" : "Đối phương đang bận"
    case "cancelled":
    default:
      return "Đã huỷ cuộc gọi"
  }
}

/** Biểu tượng cho dòng xem trước khi tin cuối là cuộc gọi. */
export function callPreviewIcon(call: PreviewCall | undefined): string {
  if (!call) return ""
  if (call.outcome === "missed" || call.outcome === "no-answer") return "📵"
  if (call.outcome === "unreachable") return "📵"
  return call.type === "video" ? "📹" : "📞"
}

/** Tin cuối là cuộc gọi NHỠ ở phía người nhận (để tô đỏ + đánh dấu chưa đọc). */
export function isMissedCallPreview(call: PreviewCall | undefined): boolean {
  if (!call) return false
  return (
    call.dir === "in" &&
    (call.outcome === "missed" ||
      call.outcome === "no-answer" ||
      call.outcome === "unreachable")
  )
}

function isImageFile(file: PreviewFile | undefined): boolean {
  if (!file) return false
  if (file.isImage) return true
  return /^image\//i.test(file.mime ?? "")
}

/**
 * Chuỗi xem trước cho tin cuối. "Bạn" được xác định bằng senderId của tin so
 * với meId (fallback cờ fromMe) — KHÔNG so theo tên hiển thị.
 */
export function previewLastMessage(
  last: PreviewMessage | undefined | null,
  meId: number,
  nameOf?: (m: PreviewMessage) => string | undefined,
): string {
  if (!last) return ""

  const mine =
    meId > 0 && last.senderId !== undefined
      ? last.senderId === meId
      : !!last.fromMe
  const name = shortSenderName(nameOf?.(last) ?? last.senderName)
  const who = mine ? "Bạn" : name

  if (last.status === "failed") return FAILED_PREVIEW
  // Chỉ hiện 🔒 khi giải mã THẤT BẠI thật sự (sai khoá/hỏng dữ liệu).
  if (last.undecryptable) return ENCRYPTED_PREVIEW
  if (last.recalled) {
    return mine
      ? "Bạn đã thu hồi một tin nhắn"
      : `${name} đã thu hồi một tin nhắn`
  }
  if (last.kind === "call") return callPreviewText(last.call)
  if (last.text && last.text.startsWith('{"kind":"like"')) {
    try {
      const p = JSON.parse(last.text)
      if (p.kind === "like" && p.emoji) {
        const head = `${who}: ${p.emoji}`
        return last.status === "sending" ? `${head} · ${SENDING_HINT}` : head
      }
    } catch {}
  }
  if (last.voice) return `${who}: Đã gửi một tin nhắn thoại`
  if (last.file) {
    return `${who}: ${
      isImageFile(last.file) ? "Đã gửi một ảnh" : "Đã gửi một tệp"
    }`
  }
  const body = oneLine(last.text)
  // Tin metadata chưa giải mã: KHÔNG bịa nội dung, để trống (không vẽ tin).
  if (!body) return ""
  const head = `${who}: ${body}`
  return last.status === "sending" ? `${head} · ${SENDING_HINT}` : head
}
